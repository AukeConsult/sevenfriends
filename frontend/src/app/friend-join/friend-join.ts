import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { Clearable } from '../core/clearable';
import { Component, computed, inject, signal } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { ActiveCircleService, CIRCLE_CHOICES } from '../core/active-circle.service';
import { FriendLinkService } from '../core/friend-link.service';
import { FriendsService } from '../core/friends.service';
import { NotificationsService } from '../core/notifications.service';
import { Friend, FriendRequest } from '../models';
import { PageBar } from '../page-bar/page-bar';

/** The last 8 digits of a phone number: how numbers are compared (the same rule as the backend). */
const lastDigits = (phone: string | null | undefined): string | null => {
  const digits = (phone ?? '').replace(/\D/g, '');
  return digits.length >= 8 ? digits.slice(-8) : null;
};

/** Who an opened friend link points to. */
interface Target {
  name: string | null;
  email: string | null;
  phone: string | null;
}

/**
 * The page a friend link leads to (after signing in): "Send a friend request to …?". Nothing is sent until the person confirms.
 * The link comes from FriendLinkService (kept in the preferences while signing in); it is cleared when it is answered.
 */
@Component({
  selector: 'app-friend-join',
  imports: [PageBar, RouterLink, Clearable, TranslocoDirective],
  templateUrl: './friend-join.html',
  providers: [provideTranslocoScope('friendJoin')],
})
export class FriendJoin {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly link = inject(FriendLinkService);
  private readonly friends = inject(FriendsService);
  private readonly notifications = inject(NotificationsService);
  private readonly router = inject(Router);
  private readonly active = inject(ActiveCircleService);

  protected readonly loading = signal(true);
  protected readonly target = signal<Target | null>(null);
  /** why nothing can be sent: the link is not valid, it is my own, or this person is already a friend */
  protected readonly problem = signal<string | null>(null);
  /** the friend I already have (when that is the problem) */
  protected readonly existing = signal<Friend | null>(null);
  /** the request this person has ALREADY sent me: it is answered instead of sending one back */
  protected readonly incoming = signal<FriendRequest | null>(null);
  protected readonly error = signal<string | null>(null);
  protected readonly sending = signal(false);
  protected readonly name = signal('');
  protected readonly message = signal('');

  /** what the person is asked about: the name when there is one, otherwise the email or phone number */
  protected readonly label = computed(() => {
    const t = this.target();
    return t ? t.name || t.email || t.phone || 'this person' : '';
  });

  constructor() {
    void this.start();
  }

  private async start(): Promise<void> {
    const pending = this.link.pending();
    if (!pending) {
      await this.router.navigateByUrl('/', { replaceUrl: true });
      return;
    }
    // the link decides the circle, and an app is in one circle only
    const mine = CIRCLE_CHOICES.find((c) => c.id === this.active.id);
    const wanted = CIRCLE_CHOICES.find((c) => c.type === pending.circle);
    if (wanted && mine && wanted.id !== mine.id) {
      return this.finish(tr('friendJoin.thisInvitationIsFor', 'This invitation is for the {{ label }} circle, and this app is in the {{ label2 }} circle. Open the link in an app for {{ label }}.', { label: wanted.label, label2: mine.label }));
    }
    try {
      await this.friends.load(); // to see whether this person is already a friend
    } catch {
      /* the check is skipped; the backend refuses nothing here, so a duplicate can only be seen by the person */
    }

    await this.notifications.refresh(); // the requests that were sent to me (the backend only finds them when I check)

    let target: Target;
    let requestId: string | null = null;
    if (pending.code) {
      try {
        const found = await this.api.request<{ self: boolean; requestId?: string | null } & Target>(`/invite/lookup/${pending.code}`);
        if (found.self) return this.finish(tr('friendJoin.thisIsYourOwn', 'This is your own invite link: send it to your friends.'));
        target = { name: found.name ?? null, email: found.email ?? null, phone: found.phone ?? null };
        requestId = found.requestId ?? null;
      } catch (err: any) {
        return this.finish(err?.status === 404 ? 'This invite link is not valid any more. Ask your friend for a new one.' : (err?.message ?? tr('friendJoin.couldNotOpenThe', 'Could not open the invite link.')));
      }
    } else {
      target = { name: null, email: pending.email, phone: pending.phone };
      const me = this.auth.user();
      const mine = (me?.email ?? '').toLowerCase();
      if ((target.email && target.email === mine) || (target.phone && lastDigits(target.phone) && lastDigits(target.phone) === lastDigits(me?.phoneNumber))) {
        return this.finish(tr('friendJoin.thisIsYourOwn2', 'This is your own link: send it to your friends.'));
      }
    }

    const already = this.friends.friends().find(
      (f) => (target.email && f.email?.toLowerCase() === target.email) || (target.phone && lastDigits(f.phone) && lastDigits(f.phone) === lastDigits(target.phone)),
    );
    if (already) {
      this.existing.set(already);
      return this.finish(tr('friendJoin.isAlreadyOnYour', '{{ alreadyName }} is already on your friend list.', { alreadyName: already.name }));
    }

    // this person has already asked me: show that request (accept it) instead of sending one back
    const asked = this.friends.requests().find((r) => r.id === requestId || (target.email !== null && r.fromEmail?.toLowerCase() === target.email));
    if (asked) this.incoming.set(asked);

    this.target.set(target);
    this.name.set(target.name ?? '');
    this.loading.set(false);
  }

  /** Nothing to send: say why (the link is done with). */
  private finish(problem: string): void {
    this.link.clear();
    this.problem.set(problem);
    this.loading.set(false);
  }

  protected async send(): Promise<void> {
    const target = this.target();
    if (!target || this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      await this.friends.add({
        name: this.name().trim(),
        email: target.email,
        phone: target.email ? null : target.phone, // the email finds them best; the phone number only when there is no email
        message: this.message().trim() || null,
      });
      this.link.clear();
      await this.router.navigateByUrl('/', { replaceUrl: true });
    } catch (err: any) {
      this.error.set(err.message ?? tr('friendJoin.couldNotSendThe', 'Could not send the friend request'));
    } finally {
      this.sending.set(false);
    }
  }

  /** Confirm the request this person sent me: they become my friend (no second request is made). */
  protected async accept(): Promise<void> {
    const request = this.incoming();
    if (!request || this.sending()) return;
    this.sending.set(true);
    this.error.set(null);
    try {
      const result = await this.friends.acceptRequest(request.id);
      this.link.clear(); // answered: the request itself stays on the Home page when there is no seat, the link is done with
      if (result === 'confirmed') {
        await this.router.navigateByUrl('/', { replaceUrl: true });
        return;
      }
      this.error.set(tr('friendJoin.youHaveNoFree', 'You have no free seats. The request from {{ fromName }} stays pending: put a friend on the sleep list or remove one to make room, then confirm it on the Home page.', { fromName: request.fromName }));
    } catch (err: any) {
      this.error.set(err.message ?? tr('friendJoin.couldNotConfirmThe', 'Could not confirm the request'));
    } finally {
      this.sending.set(false);
    }
  }

  protected async notNow(): Promise<void> {
    this.link.clear();
    await this.router.navigateByUrl('/', { replaceUrl: true });
  }
}
