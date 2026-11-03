import { Presence } from '../models';

/** What a dot means, in words (for the tooltip and screen readers). */
export function presenceLabel(presence: Presence): string {
  return presence === 'active' ? 'Active now' : presence === 'passive' ? 'Away: the screen is off or hidden' : 'Offline';
}
