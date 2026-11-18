import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, input } from '@angular/core';

/**
 * A medal on Home, with its words under it: "Gold, Early adopter" (left of the greeting; the account has the mark `profile.earlyAdopter`, set by the server)
 * or "Premium, Inviter" (right of the greeting; the person shared their invite link `PREMIUM_INVITER_SHARES` times, see `profile.inviteShares`).
 */
@Component({
  selector: 'app-medal',
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('notifications')],
  host: { style: 'display: contents' },
  template: `
    @if (show()) {
      <span class="sf-medal-box" [class.sf-right]="kind() === 'inviter'" *transloco="let t">
        <svg class="sf-medal" viewBox="0 0 150 190" aria-hidden="true">
          @if (kind() === 'early') {
            <path d="M42 4h28l14 62H56z" fill="#2f4b7c" />
            <path d="M108 4H80L66 66h28z" fill="#ba0c2f" />
            <circle cx="75" cy="118" r="62" fill="#e0a526" />
            <circle cx="75" cy="118" r="54" fill="#f5cd5a" stroke="#b9831a" stroke-width="2" />
            <text x="75" y="141" text-anchor="middle" font-size="66" font-weight="700" fill="#2f4b7c" font-family="'Segoe UI', Arial, sans-serif">7</text>
          } @else {
            <path d="M42 4h28l14 62H56z" fill="#7c3aed" />
            <path d="M108 4H80L66 66h28z" fill="#2f4b7c" />
            <circle cx="75" cy="118" r="62" fill="#aeb6c4" />
            <circle cx="75" cy="118" r="54" fill="#e6e9ef" stroke="#7d8697" stroke-width="2" />
            <path d="M52 140l46-46M68 94h30v30" fill="none" stroke="#2f4b7c" stroke-width="12" stroke-linecap="round" stroke-linejoin="round" />
          }
        </svg>
        @if (kind() === 'early') {
          <span class="sf-medal-cap"><b>{{ t('notifications.medalGold') || 'Gold' }}</b> {{ t('notifications.earlyAdopter') || 'Early adopter' }}</span>
        } @else {
          <span class="sf-medal-cap"><b class="sf-premium">{{ t('notifications.medalPremium') || 'Premium' }}</b> {{ t('notifications.inviter') || 'Inviter' }}</span>
        }
      </span>
    }
  `,
})
export class Medal {
  /** which medal: the early adopter (gold) or the premium inviter (silver) */
  readonly kind = input<'early' | 'inviter'>('early');
  /** true = the person has this medal */
  readonly show = input(false);
}
