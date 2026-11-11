import { Injectable, inject } from '@angular/core';
import { CIRCLE_CHOICES } from './active-circle.service';
import { PendingFriend, UiPreferencesService } from './ui-preferences';
import { APP_ORIGIN } from './app-origin';
import { keepLinkPin, parsePinFragment } from './list-pin';

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

/** How each kind of circle is written in an address: /welcome/<route> (and /<route> to go straight in). */
const ROUTE_OF: Record<string, string> = { friends: 'friends', buddies: 'buddy', work: 'work', family: 'family' };

/** A link into a circle: `/welcome/<circle>?<query>`, so the circle is in the address itself. */
export function circleLink(type: string, query: string): string {
  return `${APP_ORIGIN}/welcome/${ROUTE_OF[type] ?? 'friends'}${query ? `?${query}` : ''}`;
}

/** The kind of circle an address names (/welcome/buddy -> buddies); null = none. */
function circleOfPath(path: string): string | null {
  const route = /^\/welcome\/([a-z]+)\/?$/.exec(path.toLowerCase())?.[1];
  return Object.keys(ROUTE_OF).find((type) => ROUTE_OF[type] === route) ?? null;
}

/** The invitation in the parameters of a link (`invite` = a code of 10 letters or digits, `from` = an email or a phone number); null = none. */
function pendingFromParams(params: URLSearchParams, path = ''): PendingFriend | null {
  const code = (params.get('invite') ?? '').trim().toLowerCase();
  const contact = parseContact(params.get('from') ?? params.get('friend') ?? '');  // `friend` is the older name of the parameter
  const wanted = (params.get('circle') ?? '').trim().toLowerCase(); // older links say it here
  const circle = circleOfPath(path) ?? CIRCLE_CHOICES.find((c) => c.type === wanted)?.type ?? null; // the kind of circle the link invites into
  return /^[a-z0-9]{10}$/.test(code) ? { code, email: null, phone: null, circle } : contact ? { code: null, ...contact, circle } : null;
}

/**
 * Friend links: `/welcome/<circle>?invite=<code>` (made on the profile page) or `/welcome/<circle>?from=<email or phone number>`.
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
    if (!params.has('invite') && !params.has('from') && !params.has('friend')) return;
    const pending = pendingFromParams(params, location.pathname);
    if (pending) this.prefs.set('pendingFriend', pending);
    const pin = parsePinFragment(location.hash); // the list of the person who made the link, as it was then: kept on this device only (never in the preferences, which may be synced)
    if (pin) keepLinkPin(pin);
    params.delete('invite');
    params.delete('from');
    params.delete('friend');
    params.delete('circle');
    const rest = params.toString();
    history.replaceState(history.state, '', location.pathname + (rest ? `?${rest}` : '') + (pin ? '' : location.hash));
  }

  /** The link as text again (to copy it: the welcome page does, before an app is downloaded, so it can be pasted in the app). */
  linkText(pending: PendingFriend): string {
    const query = pending.code ? `invite=${pending.code}` : `from=${encodeURIComponent(pending.email ?? pending.phone ?? '')}`;
    return circleLink(pending.circle ?? 'friends', query);
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
        const url = new URL(/^https?:/i.test(value) ? value : `https://${value}`);
        pending = pendingFromParams(url.searchParams, url.pathname);
        const pin = pending ? parsePinFragment(url.hash) : null;
        if (pin) keepLinkPin(pin);
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
