import { rememberAccount } from './account-registry';
import { Injectable, Injector, inject, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  AuthCredential,
  PhoneAuthProvider,
  applyActionCode,
  linkWithCredential,
  linkWithPopup,
  verifyBeforeUpdateEmail,
  checkActionCode,
  GoogleAuthProvider,
  RecaptchaVerifier,
  User,
  createUserWithEmailAndPassword,
  isSignInWithEmailLink,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithCredential,
  signInWithEmailLink,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { DesktopNoticeService } from './desktop-notice.service';
import { UiPreferencesService } from './ui-preferences';
import { environment } from '../../environments/environment';
import { auth } from './firebase';
import { tr } from './i18n';

/** Where the email is kept between asking for a sign-in link and opening it (same device). */
const EMAIL_KEY = 'sf-email-for-sign-in';
/** the SMS code that was sent from this tab and not entered yet (see AuthService.pendingPhone), and how long it is kept */
const PENDING_PHONE_KEY = 'sf-pending-phone';
const PENDING_PHONE_MS = 5 * 60 * 1000;
/** who signed in last on this browser (an id, nothing else) */
export const LAST_UID_KEY = 'sf-last-uid';
/** the small things kept in this browser about the person using it (see clearLocalSession) */

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly prefs = inject(UiPreferencesService);
  private readonly injector = inject(Injector);
  readonly user = signal<User | null>(null);

  /**
   * Counts up when the proof of the signed-in account changed (email verified, phone confirmed).
   * The Firebase user object is the same one after that, so read this to be told.
   */
  readonly accountVersion = signal(0);

  private verifier: RecaptchaVerifier | null = null;

  /** Why the person was signed out against their will (shown on the login page); null when they were not. */
  readonly signedOutNotice = signal<string | null>(null);

  /** Resolves once Firebase has restored (or not) the previous session. */
  readonly ready = new Promise<void>((resolve) => {
    onAuthStateChanged(
      auth,
      (user) => {
        this.user.set(user);
        resolve();
      },
      () => resolve(), // auth failed to initialise (e.g. bad Firebase config): treat as signed out
    );
    setTimeout(resolve, 4000); // never block the app forever
  });

  async signInWithGoogle(): Promise<void> {
    if (Capacitor.isNativePlatform()) return this.signInWithGoogleNative();
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const { user } = await signInWithPopup(auth, provider);
    await this.finishLogin(user);
  }

  /**
   * In the Android app Google refuses a pop-up in the WebView: the phone's own Google account picker is used (the plugin), and the
   * Google token it returns signs the web session in (capacitor.config.json: skipNativeAuth, so only the web SDK holds the login).
   */
  private async signInWithGoogleNative(): Promise<void> {
    const { user } = await signInWithCredential(auth, await this.nativeGoogleCredential());
    await this.finishLogin(user);
  }

  private async nativeGoogleCredential(): Promise<AuthCredential> {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error(tr('core.googleDidNotGive', 'Google did not give a sign-in token.'));
    return GoogleAuthProvider.credential(idToken, result.credential?.accessToken);
  }

  /**
   * Adds Google to the account that is signed in now (for example one made with a phone number), so both logins reach the same account.
   * Throws `auth/credential-already-in-use` when that Google account already has an account of its own: two accounts are never merged.
   */
  async linkGoogle(): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error(tr('core.notSignedIn', 'You are not signed in.'));
    if (Capacitor.isNativePlatform()) await linkWithCredential(user, await this.nativeGoogleCredential());
    else {
      const provider = new GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await linkWithPopup(user, provider);
    }
    await this.refreshAccount();
    this.user.set(null); // a new object, so the pages that show the email update
    this.user.set(auth.currentUser);
  }

  /**
   * Adds an email address to an account that has none (made with a phone number): Firebase emails a link to the address, and the address
   * becomes the account's email, verified, when the link is opened (`/auth/action`).
   */
  async addEmail(email: string): Promise<void> {
    const user = auth.currentUser;
    if (!user) throw new Error(tr('core.notSignedIn', 'You are not signed in.'));
    await verifyBeforeUpdateEmail(user, email, { url: `${location.origin}/settings/profile`, handleCodeInApp: false });
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    await this.finishLogin(user);
  }

  /** Remove the photo of the sign-in (e.g. the Google photo) from my account, so it no longer shows when I remove my picture. */
  async clearPhoto(): Promise<void> {
    const user = auth.currentUser;
    if (!user?.photoURL) return;
    await updateProfile(user, { photoURL: null });
    this.user.set(null); // a new object, so the pages that show the photo update
    this.user.set(auth.currentUser);
  }

  async registerWithEmail(email: string, password: string, name?: string): Promise<void> {
    const { user } = await createUserWithEmailAndPassword(auth, email, password);
    await sendEmailVerification(user).catch(() => undefined); // friends only find a VERIFIED email: ask to confirm it
    if (name) {
      await updateProfile(user, { displayName: name });
      await user.getIdToken(true); // refresh so the token carries the new name
      this.user.set(auth.currentUser);
    }
    await this.finishLogin(user);
  }

  // ---------------------------------------------------------------- email link (passwordless)

  /** Step 1: email a sign-in link. Opening it brings the user to /login/link. `query` = a waiting friend invitation (`FriendLinkService.query()`): it goes inside the link, so it reaches whichever browser opens it. */
  async sendSignInLink(email: string, query = ''): Promise<void> {
    await sendSignInLinkToEmail(auth, email, { url: `${location.origin}/login/link${query ? `?${query}` : ''}`, handleCodeInApp: true });
    try {
      localStorage.setItem(EMAIL_KEY, email); // so the page the link opens does not have to ask again
    } catch {
      /* storage not available: the page will ask for the email */
    }
  }

  isSignInLink(url: string = location.href): boolean {
    return isSignInWithEmailLink(auth, url);
  }

  rememberedEmail(): string | null {
    try {
      return localStorage.getItem(EMAIL_KEY);
    } catch {
      return null;
    }
  }

  /** Step 2: the link was opened. Opening the link also proves the email, so it counts as verified. */
  async completeSignInLink(email: string, url: string = location.href): Promise<void> {
    const { user } = await signInWithEmailLink(auth, email, url);
    try {
      localStorage.removeItem(EMAIL_KEY);
    } catch {
      /* ignore */
    }
    await this.finishLogin(user);
  }

  // ---------------------------------------------------------------- phone (SMS code)

  /**
   * Step 1: send an SMS code. `container` is the element the invisible reCAPTCHA check lives in.
   * `linking` = the user is already signed in and only wants to verify a phone number.
   * The id of the code that was sent is kept in this tab (sessionStorage), so a page that reloads while the person waits for the text message
   * can show the code field again (see pendingPhone).
   */
  async sendPhoneCode(phone: string, container: HTMLElement, linking = false): Promise<void> {
    this.clearVerifier();
    this.verifier = new RecaptchaVerifier(auth, container, { size: 'invisible' });
    try {
      const id = await new PhoneAuthProvider(auth).verifyPhoneNumber(phone, this.verifier);
      try {
        sessionStorage.setItem(PENDING_PHONE_KEY, JSON.stringify({ id, phone, linking, at: Date.now() }));
      } catch {
        /* no storage: the code still works until the page is reloaded */
      }
      this.pendingId = id;
      this.armPhoneExpiry(PENDING_PHONE_MS);
    } catch (err) {
      this.clearVerifier();
      throw err;
    }
  }

  private pendingId: string | null = null;
  private expiryTimer: ReturnType<typeof setTimeout> | undefined;
  /** counts up when a code that was sent was not entered in time and is forgotten (the page closes its code field and says so) */
  readonly phoneCodeExpired = signal(0);

  private armPhoneExpiry(ms: number): void {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = setTimeout(() => {
      this.cancelPhoneCode();
      this.phoneCodeExpired.update((v) => v + 1);
    }, ms);
  }

  /** The code that was sent to this tab and not entered yet (also after a reload): the number and what it is for; null when there is none or it is too old. */
  pendingPhone(): { phone: string; linking: boolean } | null {
    try {
      const raw = sessionStorage.getItem(PENDING_PHONE_KEY);
      if (!raw) return null;
      const p = JSON.parse(raw) as { id?: string; phone?: string; linking?: boolean; at?: number };
      if (!p.id || !p.phone || typeof p.at !== 'number' || Date.now() - p.at > PENDING_PHONE_MS) {
        this.cancelPhoneCode();
        return null;
      }
      this.pendingId = p.id;
      if (!this.expiryTimer) this.armPhoneExpiry(PENDING_PHONE_MS - (Date.now() - p.at)); // after a reload: the time that is left
      return { phone: p.phone, linking: p.linking === true };
    } catch {
      return null;
    }
  }

  /** Forgets the code that waits to be entered (change the number, or give up). */
  cancelPhoneCode(): void {
    clearTimeout(this.expiryTimer);
    this.expiryTimer = undefined;
    this.pendingId = null;
    this.clearVerifier();
    try {
      sessionStorage.removeItem(PENDING_PHONE_KEY);
    } catch {
      /* no storage */
    }
  }

  /** Step 2: the code from the SMS. Signs in, or (linking) adds the verified number to this account. */
  async confirmPhoneCode(code: string, linking = false): Promise<void> {
    if (!this.pendingId) this.pendingPhone(); // after a reload the id is in the session storage
    if (!this.pendingId) throw new Error(tr('core.askForANew', 'Ask for a new code first.'));
    const credential = PhoneAuthProvider.credential(this.pendingId, code);
    if (linking) {
      const user = auth.currentUser;
      if (!user) throw new Error(tr('core.notSignedIn', 'You are not signed in.'));
      await linkWithCredential(user, credential);
      this.cancelPhoneCode();
      await this.refreshAccount();
    } else {
      const { user } = await signInWithCredential(auth, credential);
      this.cancelPhoneCode();
      await this.finishLogin(user);
    }
  }

  private clearVerifier(): void {
    this.verifier?.clear();
    this.verifier = null;
  }

  // ---------------------------------------------------------------- verifying what the account has

  /** Ask for an email that confirms the address (friends only find a VERIFIED email). */
  async sendVerificationEmail(): Promise<void> {
    const user = auth.currentUser;
    if (user) await sendEmailVerification(user, { url: `${location.origin}/settings/profile` });
  }

  /**
   * Finishes an emailed verification link (the page `/auth/action` opens it): checks the code, applies it, and when somebody is signed in here reloads the account so the
   * verification is kept at once. Answers the address that was verified; throws with Firebase's code (`auth/invalid-action-code`, `auth/expired-action-code`) when the
   * link is used already, has expired or is broken.
   */
  async applyVerificationCode(oobCode: string): Promise<string | null> {
    const info = await checkActionCode(auth, oobCode);
    await applyActionCode(auth, oobCode);
    if (auth.currentUser) await this.refreshAccount().catch(() => undefined); // offline now: the profile page picks it up
    return info.data.email ?? null;
  }

  /** Asks Firebase again whether the email of the account is verified now (the link may have been opened on another device). Answers true or false; throws when it cannot ask. */
  async checkVerified(): Promise<boolean> {
    await this.refreshAccount();
    return auth.currentUser?.emailVerified === true;
  }

  /**
   * The proof of the account may have changed (the email link was opened, a phone number was confirmed):
   * reload the user, get a token that carries the new proof and tell the backend, which then keeps it.
   */
  async refreshAccount(): Promise<void> {
    const user = auth.currentUser;
    if (!user) return;
    await user.reload();
    await user.getIdToken(true);
    await this.syncUser(user);
    this.accountVersion.update((v) => v + 1);
  }

  resetPassword(email: string): Promise<void> {
    return sendPasswordResetEmail(auth, email);
  }

  /** Signs out because the login can no longer be used (see ApiService), and leaves a note for the login page. */
  async forceLogout(reason: string): Promise<void> {
    this.signedOutNotice.set(reason);
    try {
      await signOut(auth);
    } catch {
      /* the local session is dropped even if this fails */
    }
  }

  logout(): Promise<void> {
    return signOut(auth);
  }

  private newAccount = false;
  /** the account that was created by this sign-in and has not made its first key yet: the key store is wiped before that key (see KeysService) */
  private freshUid: string | null = null;

  isFreshAccount(uid: string): boolean {
    return this.freshUid === uid;
  }

  doneFresh(): void {
    this.freshUid = null;
  }

  /**
   * Where to go after signing in: always Home. A brand-new account sees the front page first, with a notice ("Finish setup") that
   * stays until the setup wizard (profile, notifications, key, first friend) is done.
   */
  landingPath(): string {
    if (this.newAccount) this.prefs.set('setup', 'start');
    this.newAccount = false;
    return '/';
  }

  /** when the account of this session was created by this sign-in (milliseconds), 0 = it was not */
  private createdAt = 0;

  /**
   * True once, and only for the first minute, for an account created by this sign-in: only such an account answers a friend link by itself
   * (see AutoInviteService). A link opened later in the same session is asked about on /friends/join like everybody else's.
   */
  takeNewAccount(): boolean {
    const fresh = this.createdAt > 0 && Date.now() - this.createdAt < 60_000;
    this.createdAt = 0;
    return fresh;
  }

  /**
   * A new account, or a different person than the last one who signed in on this browser, starts clean: the local choices (UiPreferences,
   * the desktop notification switch, the small remembered views) and everything in the tab's session storage are cleared. The SAME person
   * signing in again keeps theirs (for example the ready-made messages that live on this device only). The keys of this device are not touched.
   */
  private clearLocalSession(uid: string): void {
    try {
      if (!this.newAccount && localStorage.getItem(LAST_UID_KEY) === uid) return;
      sessionStorage.clear();
    } catch {
      /* no storage: nothing to clear */
    }
    this.prefs.clearAccountChoices();
    this.injector.get(DesktopNoticeService).reset(); // looked up now, not when this service is made: it needs the Router, which needs this service
  }

  /** Saves the user, and signs out again if that fails so state stays consistent. */
  private async finishLogin(user: User): Promise<void> {
    this.signedOutNotice.set(null);
    // the account was created by this very sign-in (any method: Google, password, link, phone)
    this.newAccount = user.metadata.creationTime === user.metadata.lastSignInTime;
    this.createdAt = this.newAccount ? Date.now() : 0;
    this.freshUid = this.newAccount ? user.uid : null;
    // a new account, or somebody else than the last person who signed in here: nothing of the other person's local choices stays
    this.clearLocalSession(user.uid);
    try {
      localStorage.setItem(LAST_UID_KEY, user.uid);
    } catch {
      /* no storage */
    }
    try {
      await this.syncUser(user);
    } catch (err) {
      await signOut(auth);
      throw err;
    }
  }

  /** Saves the signed-in user to the `user-account` collection via the backend. */
  private async syncUser(user: User): Promise<void> {
    const token = await user.getIdToken();
    const res = await fetch(`${environment.apiBase}/users/sync`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      throw new Error(tr('core.userSyncFailed', 'User sync failed ({{ status }})', { status: res.status }));
    }
    // the server says the stamp of this account: this browser remembers it, so the account can be wiped here if it is deleted elsewhere (AccountWatchService)
    const body: unknown = await res.json().catch(() => null);
    const accountId = (body as { accountId?: unknown } | null)?.accountId;
    if (typeof accountId === 'string') rememberAccount(user.uid, accountId);
  }
}
