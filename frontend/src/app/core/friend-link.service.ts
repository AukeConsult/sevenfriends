import { Injectable, inject } from '@angular/core';
import { PendingFriend, UiPreferencesService } from './ui-preferences';

/** A contact from a link: an email (has an @) or a phone number. null = not usable. */
export function parseContact(value: string): { email: string | null; phone: string | null } | null {
  const trimmed = value.trim();
  if (trimmed.includes('@')) {
    const ok = trimmed.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
    return ok ? { email: trimmed.toLowerCase(), phone: null } : null;
  }
  if (/[^\d\s+()\-.]/.test(trimmed)) return null;
  const digits = trimmed.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 15) return null;
  // a "+" in an address arrives as a space (+47 91... -> " 47 91..."): the number had its country code
  const plus = trimmed.startsWith('+') || /^\s\d/.test(value);
  return { email: null, phone: (plus ? '+' : '') + digits };
}

/**
 * Friend links: `/?invite=<code>` (made on the profile page) or `/?friend=<email or phone number>`.
 * Whoever opens one has to sign in first (or create an account), so the link is kept in the preferences until the person
 * has answered it on the page `/friends/join`: it survives the sign-in (Google, an email link, an SMS code) and a reload.
 */
@Injectable({ providedIn: 'root' })
export class FriendLinkService {
  private readonly prefs = inject(UiPreferencesService);

  /** who the link points to, until it is answered; null = no link waiting */
  readonly pending = this.prefs.value('pendingFriend');

  /** Reads the link from the address (once, at the start of the app, before any redirect drops it) and removes it from the address bar. */
  capture(): void {
    const params = new URLSearchParams(location.search);
    if (!params.has('invite') && !params.has('friend')) return;
    const code = (params.get('invite') ?? '').trim().toLowerCase();
    const contact = parseContact(params.get('friend') ?? '');
    const pending: PendingFriend | null = /^[a-z0-9]{10}$/.test(code)
      ? { code, email: null, phone: null }
      : contact
        ? { code: null, ...contact }
        : null;
    if (pending) this.prefs.set('pendingFriend', pending);
    params.delete('invite');
    params.delete('friend');
    const rest = params.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }

  /** The link is answered (or not wanted). */
  clear(): void {
    this.prefs.set('pendingFriend', null);
  }
}
