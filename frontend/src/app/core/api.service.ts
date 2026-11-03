import { Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/**
 * Errors of Firebase Auth when it cannot give the signed-in person a valid token: the connection to sign-in failed
 * (`network-request-failed`), or the session is dead (expired, the account is gone or disabled). Nothing can be done
 * with such a session, so the person is signed out and asked to sign in again.
 */
const DEAD_SESSION = new Set([
  'auth/network-request-failed',
  'auth/user-token-expired',
  'auth/invalid-user-token',
  'auth/user-disabled',
  'auth/user-not-found',
]);

/** Calls the backend (/api) with the signed-in user's token. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly auth = inject(AuthService);
  // the Router is fetched when it is needed: the Router itself (through the title strategy) depends on services that
  // use this one, so asking for it here would be a circular dependency and the app would not start
  private readonly injector = inject(Injector);

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const user = this.auth.user();
    if (!user) throw new ApiError('Not signed in', 401);

    let token: string;
    try {
      token = await user.getIdToken();
    } catch (err) {
      if (!DEAD_SESSION.has((err as { code?: string }).code ?? '')) throw err;
      await this.auth.forceLogout('You were signed out because the connection to sign-in failed. Please sign in again.');
      await this.injector.get(Router).navigateByUrl('/login');
      throw new ApiError('Signed out', 401);
    }

    const res = await fetch(`${environment.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
    }
    return (res.status === 204 ? undefined : await res.json()) as T;
  }
}
