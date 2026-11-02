import { Injectable, signal } from '@angular/core';
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
    const provider = new GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });
    const { user } = await signInWithPopup(auth, provider);
    await this.finishLogin(user);
  }

  async signInWithEmail(email: string, password: string): Promise<void> {
    const { user } = await signInWithEmailAndPassword(auth, email, password);
    await this.finishLogin(user);
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
    if (user) await sendEmailVerification(user, { url: `${location.origin}/profile` });
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

  logout(): Promise<void> {
    return signOut(auth);
  }

  /** Saves the user, and signs out again if that fails so state stays consistent. */
  private async finishLogin(user: User): Promise<void> {
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
