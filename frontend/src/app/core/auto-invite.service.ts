import { Injectable, inject, signal } from '@angular/core';
import { ActiveCircleService, CIRCLE_CHOICES } from './active-circle.service';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { FriendLinkService } from './friend-link.service';
import { FriendsService } from './friends.service';

/**
 * A new account that was made from a friend link answers the link by itself: creating the account is the yes, so the friend
 * request to the person who made the link is sent at once, with nothing to confirm. Anything unusual (another circle, the
 * inviter already asked me, a failure) is left to the page `/friends/join`, which asks as before.
 */
@Injectable({ providedIn: 'root' })
export class AutoInviteService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly link = inject(FriendLinkService);
  private readonly friends = inject(FriendsService);
  private readonly active = inject(ActiveCircleService);

  /** the request is being sent: the link must not be taken to the confirm page meanwhile */
  readonly busy = signal(false);

  /** true = the link is answered (a request was sent, or there was nothing to send); false = the confirm page should handle it */
  async run(): Promise<boolean> {
    const pending = this.link.pending();
    if (!pending) return true;
    const wanted = CIRCLE_CHOICES.find((c) => c.type === pending.circle);
    // a new account has nothing in any circle yet: it starts in the circle the link invites into (no page in between)
    if (wanted && wanted.id !== this.active.id) this.active.choose(wanted.id, '/');
    this.busy.set(true);
    try {
      let target: { name: string | null; email: string | null; phone: string | null };
      if (pending.code) {
        const found = await this.api.request<{ self: boolean; requestId?: string | null; name?: string | null; email?: string | null; phone?: string | null }>(`/invite/lookup/${pending.code}`);
        if (found.self) {
          this.link.clear();
          return true;
        }
        if (found.requestId) return false; // the inviter has already asked me: the confirm page lets me accept that
        target = { name: found.name ?? null, email: found.email ?? null, phone: found.phone ?? null };
      } else {
        target = { name: null, email: pending.email, phone: pending.phone };
        if (target.email && target.email === (this.auth.user()?.email ?? '').toLowerCase()) {
          this.link.clear();
          return true;
        }
      }
      if (!target.email && !target.phone) return false;
      await this.friends.add({
        name: target.name || target.email || target.phone || '',
        email: target.email,
        phone: target.email ? null : target.phone, // the email finds them best; the phone number only when there is no email
        message: null,
      });
      this.link.clear();
      return true;
    } catch {
      return false;
    } finally {
      this.busy.set(false);
    }
  }
}
