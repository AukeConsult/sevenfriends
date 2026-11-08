import { Component, computed, inject } from '@angular/core';
import { ActiveCircleService } from '../core/active-circle.service';
import { Router, RouterLink } from '@angular/router';
import { FriendsService } from '../core/friends.service';
import { InstallService } from '../core/install.service';
import { InviteLinkService } from '../core/invite-link.service';
import { HomeTop } from '../home-top/home-top';

/** Share (a tab of the bottom menu): the link that invites friends, and the way to install the app on a phone. */
@Component({
  selector: 'app-share',
  imports: [HomeTop, RouterLink],
  templateUrl: './share.html',
})
export class Share {
  private readonly circle = inject(ActiveCircleService);
  protected readonly w = this.circle.words;
  protected readonly install = inject(InstallService);
  protected readonly invite = inject(InviteLinkService);
  private readonly friends = inject(FriendsService);
  private readonly router = inject(Router);

  /** A click on empty space (not on a card, a link, a button or the top) goes back to Home. */
  protected emptySpaceClicked(event: Event): void {
    const target = event.target as HTMLElement | null;
    if (!target || target.closest('a, button, input, textarea, select, summary, label, details, .card, .alert, app-home-top, [role="button"], [tabindex], [contenteditable]')) return;
    if (window.getSelection()?.toString()) return; // the person was selecting text
    void this.router.navigateByUrl('/');
  }

  /** seats still free (the invitation is most useful then) */
  protected readonly freeSeats = computed(() => 7 - this.friends.awake().length);

  /** the link to hand out: whoever opens it, signs in and confirms sends ME a friend request (my invite code, never my email address or phone number) */
  protected readonly friendLink = this.invite.link;

  constructor() {
    void this.invite.load();
  }
}
