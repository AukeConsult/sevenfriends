import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ActiveCircleService } from '../core/active-circle.service';
import { FriendsService } from '../core/friends.service';
import { InviteLinkService } from '../core/invite-link.service';
import { tr } from '../core/i18n';
import { PageBar } from '../page-bar/page-bar';

/** What Add a friend hands over (in the navigation state, never in the address: an email address and a phone number are personal). */
export interface InviteFriendState {
  /** what was typed: an email address or a phone number that nobody on the app has */
  to: string;
  /** where Done goes: the page Add a friend was opened from, and its query parameters */
  back?: string;
  params?: Record<string, string> | null;
}

/**
 * The page Add a friend opens AT ONCE when the email or phone number that was typed is not on the app (docs/guide/connections.md): here the person decides whether to send the
 * link. Sending it (the share sheet finished, or Copy) is what creates the invitation, for an EMAIL: it is saved and waits, and shows to that person as soon as they sign up or
 * log on with that email. Nothing is saved before, and nothing if the share is cancelled. A phone number gets the same page, but no invitation is saved (it needs an email): only
 * the link goes out. Sharing needs no key and no approval, and neither does saving (it only waits, a few seconds, until the key of this device is created: `FriendsService.add`).
 * Without what to show (opened by hand, a reload) it goes back to Add a friend.
 */
@Component({
  selector: 'app-invite-friend',
  imports: [PageBar, TranslocoDirective],
  templateUrl: './invite-friend.html',
  providers: [provideTranslocoScope('addFriend')],
})
export class InviteFriend {
  private readonly router = inject(Router);
  private readonly friends = inject(FriendsService);
  protected readonly w = inject(ActiveCircleService).words;
  protected readonly invite = inject(InviteLinkService);
  protected readonly state: InviteFriendState | null;
  /** an email can be saved as an invitation; a phone number cannot */
  protected readonly byEmail: boolean;

  /** the invitation is saved (the link was sent): the page says it is ready */
  protected readonly saved = signal(false);
  protected readonly saving = signal(false);
  protected readonly error = signal<string | null>(null);

  constructor() {
    const given = (this.router.getCurrentNavigation()?.extras.state ?? history.state) as Partial<InviteFriendState> | null;
    this.state = typeof given?.to === 'string' && given.to ? { to: given.to, back: given.back, params: given.params } : null;
    this.byEmail = !!this.state?.to.includes('@');
    if (!this.state) void this.router.navigateByUrl('/friends/add', { replaceUrl: true });
    void this.invite.load(); // the link is ready when it is tapped
  }

  /** The link went out: for an email the invitation is saved now (once). */
  private async sent(went: boolean): Promise<void> {
    if (!went || !this.state || !this.byEmail || this.saved() || this.saving()) return;
    this.saving.set(true);
    this.error.set(null);
    try {
      await this.friends.add({ name: '', email: this.state.to, phone: null, message: null });
      this.saved.set(true);
    } catch (err: any) {
      this.error.set(err.message ?? tr('addFriend.sendFailed', 'Could not send the request.'));
    } finally {
      this.saving.set(false);
    }
  }

  protected async share(): Promise<void> {
    await this.sent(await this.invite.share());
  }

  protected async copy(): Promise<void> {
    await this.sent(await this.invite.copy());
  }

  protected done(): void {
    void this.router.navigate([this.state?.back ?? '/'], { queryParams: this.state?.params ?? null });
  }
}
