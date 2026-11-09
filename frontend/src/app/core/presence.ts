import { Presence } from '../models';
import { tr } from './i18n';

/** What a dot means, in words (for the tooltip and screen readers). */
export function presenceLabel(presence: Presence): string {
  return presence === 'active' ? tr('core.activeNow', 'Active now') : presence === 'passive' ? tr('core.awayTheScreenIs', 'Away: the screen is off or hidden') : 'Offline';
}
