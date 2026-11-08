import { Injectable, Injector, inject } from '@angular/core';
import { Router } from '@angular/router';
import type { User } from 'firebase/auth';
import { environment } from '../../environments/environment';
import { ActiveCircleService } from './active-circle.service';
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
  private readonly circle = inject(ActiveCircleService);
  // the Router is fetched when it is needed: the Router itself (through the title strategy) depends on services that
  // use this one, so asking for it here would be a circular dependency and the app would not start
  private readonly injector = inject(Injector);

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const res = await this.send(path, init);
    return (res.status === 204 ? undefined : await res.json()) as T;
  }

  /** `getObject`: a file of the media cache. An ordinary call that answers with the bytes, and the name of the file. */
  async file(path: string): Promise<{ blob: Blob; name: string | null }> {
    const res = await this.send(path);
    const name = /filename\*=UTF-8''([^;]+)/.exec(res.headers.get('Content-Disposition') ?? '')?.[1];
    return { blob: await res.blob(), name: name ? decodeURIComponent(name) : null };
  }

  private async send(path: string, init: RequestInit = {}): Promise<Response> {
    const user = this.auth.user();
    if (!user) throw new ApiError('Not signed in', 401);

    let res = await this.call(path, init, await this.token(user, false));
    if (res.status === 401) {
      // the server did not accept the token: ask for a fresh one once, then give up and sign the person out
      res = await this.call(path, init, await this.token(user, true));
      if (res.status === 401) {
        await this.signOutDeadSession('You were signed out because your login is no longer valid. Please sign in again.');
        throw new ApiError('Signed out', 401);
      }
    }
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new ApiError(body.error ?? `Request failed (${res.status})`, res.status);
    }
    return res;
  }

  private call(path: string, init: RequestInit, token: string): Promise<Response> {
    return fetch(`${environment.apiBase}${path}`, {
      ...init,
      // JSON unless the caller sends something else (a file)
      // every call says which circle the app is in (it is bound to one): the server shows and saves the profile of that circle
      headers: { Authorization: `Bearer ${token}`, 'X-Circle': this.circle.id, 'Content-Type': 'application/json', ...(init.headers as Record<string, string> | undefined) },
    });
  }

  private async token(user: User, refresh: boolean): Promise<string> {
    try {
      return await user.getIdToken(refresh);
    } catch (err) {
      if (!DEAD_SESSION.has((err as { code?: string }).code ?? '')) throw err;
      await this.signOutDeadSession('You were signed out because the connection to sign-in failed. Please sign in again.');
      throw new ApiError('Signed out', 401);
    }
  }

  private async signOutDeadSession(reason: string): Promise<void> {
    await this.auth.forceLogout(reason);
    await this.injector.get(Router).navigateByUrl('/login');
  }
}
