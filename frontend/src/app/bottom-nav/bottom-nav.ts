import { Component, inject } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';
import { NotificationsService } from '../core/notifications.service';

/** Always-visible banner menu at the bottom of the screen (shown when signed in). */
@Component({
  selector: 'app-bottom-nav',
  imports: [RouterLink, RouterLinkActive],
  templateUrl: './bottom-nav.html',
})
export class BottomNav {
  private readonly notifications = inject(NotificationsService);

  /** Clicking Home runs the invite + message check (also when already on Home). */
  protected onHome(): void {
    this.notifications.refresh();
  }
}
