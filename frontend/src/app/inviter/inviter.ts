import { Component, computed, inject, signal } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { FriendLinkService } from '../core/friend-link.service';
import { tr } from '../core/i18n';

/**
 * "Invited by Name (l***@mail.com)": shown right under the headline of every welcome page when a friend link with a code waits and
 * nobody is signed in. The name and the address (its middle hidden) come from the public lookup, see FriendLinkService.inviter.
 */
@Component({
  selector: 'app-inviter',
  host: { style: 'display:block' },
  template: `@if (text(); as line) { <p class="sf-inviter" role="status">{{ line }}</p> }`,
})
export class Inviter {
  private readonly auth = inject(AuthService);
  private readonly links = inject(FriendLinkService);
  private readonly who = signal<{ name: string | null; contact: string | null } | null>(null);

  protected readonly text = computed(() => {
    const who = this.who();
    if (!who || this.auth.user()) return null;
    const line = [who.name, who.contact ? (who.name ? `(${who.contact})` : who.contact) : null].filter(Boolean).join(' ');
    return line ? tr('core.invitedBy', 'Invited by your friend {{ who }}', { who: line }) : null;
  });

  constructor() {
    const pending = this.links.pending();
    if (pending?.code) void this.links.inviter(pending).then((who) => this.who.set(who));
  }
}
