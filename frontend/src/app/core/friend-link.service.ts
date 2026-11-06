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

/** The invitation in the parameters of a link (`invite` = a code of 10 letters or digits, `friend` = an email or a phone number); null = none. */
function pendingFromParams(params: URLSearchParams): PendingFriend | null {
  const code = (params.get('invite') ?? '').trim().toLowerCase();
  const contact = parseContact(params.get('friend') ?? '');
  return /^[a-z0-9]{10}$/.test(code) ? { code, email: null, phone: null } : contact ? { code: null, ...contact } : null;
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
    const pending = pendingFromParams(params);
    if (pending) this.prefs.set('pendingFriend', pending);
    params.delete('invite');
    params.delete('friend');
    const rest = params.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + location.hash);
  }

  /** The link as text again (to copy it: the welcome page does, before an app is downloaded, so it can be pasted in the app). */
  linkText(pending: PendingFriend): string {
    const query = pending.code ? `invite=${pending.code}` : `friend=${encodeURIComponent(pending.email ?? pending.phone ?? '')}`;
    return `${location.origin}/?${query}`;
  }

  /**
   * Takes what the person pasted (the whole link, only the code, an email address or a phone number) and keeps it as the waiting
   * invitation. false = it is not an invitation. This is how an invitation reaches an app that was installed AFTER the link was
   * opened in the browser (the app has its own storage): the person pastes it on the sign-in page.
   */
  use(text: string): boolean {
    const value = text.trim();
    let pending: PendingFriend | null = null;
    if (/^https?:\/\/|^[\w.-]+\.[a-z]{2,}\/|\?/.test(value)) {
      try {
        pending = pendingFromParams(new URL(/^https?:/i.test(value) ? value : `https://${value}`).searchParams);
      } catch {
        /* not a link */
      }
    } else {
      pending = pendingFromParams(new URLSearchParams({ invite: value })) ?? pendingFromParams(new URLSearchParams({ friend: value }));
    }
    if (pending) this.prefs.set('pendingFriend', pending);
    return pending !== null;
  }

  /** The link is answered (or not wanted). */
  clear(): void {
    this.prefs.set('pendingFriend', null);
  }
}
