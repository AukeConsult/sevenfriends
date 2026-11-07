import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import {
  ConfirmationResult,
  GoogleAuthProvider,
  RecaptchaVerifier,
  User,
  createUserWithEmailAndPassword,
  isSignInWithEmailLink,
  linkWithPhoneNumber,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithCredential,
  signInWithEmailLink,
  signInWithPhoneNumber,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { environment } from '../../environments/environment';
import { auth } from './firebase';

/** Where the email is kept between asking for a sign-in link and opening it (same device). */
const EMAIL_KEY = 'sf-email-for-sign-in';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(null);

  /**
   * Counts up when the proof of the signed-in account changed (email verified, phone confirmed).
   * The Firebase user object is the same one after that, so read this to be told.
   */
  readonly accountVersion = signal(0);

  private confirmation: ConfirmationResult | null = null;
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
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    const result = await FirebaseAuthentication.signInWithGoogle();
    const idToken = result.credential?.idToken;
    if (!idToken) throw new Error('Google did not give a sign-in token.');
    const { user } = await signInWithCredential(auth, GoogleAuthProvider.credential(idToken, result.credential?.accessToken));
    await this.finishLogin(user);
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

  /** Step 1: email a sign-in link. Opening it brings the user to /login/link. */
  async sendSignInLink(email: string): Promise<void> {
    await sendSignInLinkToEmail(auth, email, { url: `${location.origin}/login/link`, handleCodeInApp: true });
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
   */
  async sendPhoneCode(phone: string, container: HTMLElement, linking = false): Promise<void> {
    this.clearVerifier();
    this.verifier = new RecaptchaVerifier(auth, container, { size: 'invisible' });
    try {
      this.confirmation =
        linking && auth.currentUser
          ? await linkWithPhoneNumber(auth.currentUser, phone, this.verifier)
          : await signInWithPhoneNumber(auth, phone, this.verifier);
    } catch (err) {
      this.clearVerifier();
      throw err;
    }
  }

  /** Step 2: the code from the SMS. Signs in, or (linking) adds the verified number to this account. */
  async confirmPhoneCode(code: string, linking = false): Promise<void> {
    if (!this.confirmation) throw new Error('Ask for a new code first.');
    const { user } = await this.confirmation.confirm(code);
    this.confirmation = null;
    this.clearVerifier();
    if (linking) await this.refreshAccount();
    else await this.finishLogin(user);
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

  /** Where to go after signing in: a brand-new account fills in its profile first. */
  landingPath(): string {
    const path = this.newAccount ? '/settings/profile' : '/';
    this.newAccount = false;
    return path;
  }

  /** Saves the user, and signs out again if that fails so state stays consistent. */
  private async finishLogin(user: User): Promise<void> {
    this.signedOutNotice.set(null);
    // the account was created by this very sign-in (any method: Google, password, link, phone)
    this.newAccount = user.metadata.creationTime === user.metadata.lastSignInTime;
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
      throw new Error(`User sync failed (${res.status})`);
    }
  }
}
