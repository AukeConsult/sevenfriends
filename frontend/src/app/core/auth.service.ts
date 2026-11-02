import { Injectable, signal } from '@angular/core';
import {
  GoogleAuthProvider,
  User,
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut,
  updateProfile,
} from 'firebase/auth';
import { environment } from '../../environments/environment';
import { auth } from './firebase';

@Injectable({ providedIn: 'root' })
export class AuthService {
  readonly user = signal<User | null>(null);

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
    if (name) {
      await updateProfile(user, { displayName: name });
      await user.getIdToken(true); // refresh so the token carries the new name
      this.user.set(auth.currentUser);
    }
    await this.finishLogin(user);
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
