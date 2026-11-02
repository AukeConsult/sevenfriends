import { Injectable, inject } from '@angular/core';
import { environment } from '../../environments/environment';
import { AuthService } from './auth.service';

export class ApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

/** Calls the backend (/api) with the signed-in user's token. */
@Injectable({ providedIn: 'root' })
export class ApiService {
  private readonly auth = inject(AuthService);

  async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const user = this.auth.user();
    if (!user) throw new ApiError('Not signed in', 401);

    const res = await fetch(`${environment.apiBase}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${await user.getIdToken()}`,
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
