import { activeLang, tr } from './i18n';

/**
 * A time as "how long ago" in plain English: "just now", "5 minutes ago", "3 hours ago", "yesterday", "4 days ago",
 * "2 weeks ago", and the date for anything older than about a month. `now` is passed in so a page can refresh it.
 */
export function timeAgo(iso: string, now: number = Date.now()): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const seconds = Math.max(0, Math.round((now - then) / 1000));
  const relative = new Intl.RelativeTimeFormat(activeLang(), { numeric: 'auto' });
  if (seconds < 60) return tr('time.justNow', 'just now');
  if (seconds < 3600) return relative.format(-Math.floor(seconds / 60), 'minute');
  if (seconds < 86400) return relative.format(-Math.floor(seconds / 3600), 'hour');
  const days = Math.floor(seconds / 86400);
  if (days < 7) return relative.format(-days, 'day');
  if (days < 30) return relative.format(-Math.floor(days / 7), 'week');
  return new Date(then).toLocaleDateString(activeLang(), { day: 'numeric', month: 'short', year: 'numeric' });
}
