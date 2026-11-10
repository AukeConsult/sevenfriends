import { CASE_DOCUMENTS_MAX, ChecklistEntry, ObjectKind, ObjectPayload, SafeboxType } from '../models';
import { tr } from './i18n';

/** The kinds the New frame always shows; the others are behind "More types" (and move up once the box holds an item of that kind). */
export const STANDARD_KINDS = ['file', 'note', 'secret', 'link', 'checklist', 'album'];

/** The kinds to show at once and the ones behind "More types". `used` are the kinds that already have an item: they count as standard. */
export function splitKinds<T extends { type: string }>(kinds: T[], used: ReadonlySet<string> = new Set()): { main: T[]; more: T[] } {
  const main = kinds.filter((k) => STANDARD_KINDS.includes(k.type) || used.has(k.type));
  return { main, more: kinds.filter((k) => !main.includes(k)) };
}

/**
 * The kinds the way the person arranged them (`layout`, see the preference `boxKindLayout`: the kinds shown at once and the ones behind "More types", each in order),
 * or the standard split when there is no arrangement. A kind the arrangement does not know (a new one) goes where the standard split puts it.
 */
export function arrangeKinds<T extends { type: string }>(kinds: T[], layout: { main: string[]; more: string[] } | null, used: ReadonlySet<string> = new Set()): { main: T[]; more: T[] } {
  const standard = splitKinds(kinds, used);
  if (!layout) return standard;
  const pick = (ids: string[]): T[] => ids.map((id) => kinds.find((k) => k.type === id)).filter((k): k is T => !!k);
  const main = pick(layout.main);
  const more = pick(layout.more).filter((k) => !main.includes(k));
  const unknown = kinds.filter((k) => !main.includes(k) && !more.includes(k));
  return { main: [...main, ...unknown.filter((k) => standard.main.includes(k))], more: [...more, ...unknown.filter((k) => standard.more.includes(k))] };
}

/** The kinds of object a safebox holds besides files (design: docs/design/safebox-objects.md), in the order of the "New" frame. */
export function objectKinds(): ObjectKind[] {
  const note = tr('safebox.common.note', 'Note');
  const textLabel = tr('safebox.common.note', 'Note');
  return [
    { type: 'note', label: note, icon: 'M5 4h14v16H5zM8 9h8M8 13h8M8 17h5', titleLabel: tr('safebox.common.title', 'Title'), fields: [] },
    { type: 'secret', label: tr('safebox.list.secret', 'Secret'), icon: 'M21 2l-2 2m-7.6 7.6a5.5 5.5 0 1 1-7.8 7.8 5.5 5.5 0 0 1 7.8-7.8zm0 0L15.5 7.5m0 0l3 3L22 7l-3-3m-3.5 3.5L19 4', titleLabel: tr('safebox.object.whatIsItFor', 'What is it for?'),
      fields: [{ key: 'value', label: tr('safebox.object.secretValue', 'Password, code or PIN'), input: 'secret', max: 500, copy: true }, { key: 'note', label: textLabel, input: 'textarea', max: 2000 }] },
    { type: 'link', label: tr('safebox.list.link', 'Link'), icon: 'M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71', titleLabel: tr('safebox.common.title', 'Title'),
      fields: [{ key: 'url', label: tr('safebox.object.webAddress', 'Web address'), input: 'url', max: 2000, copy: true }, { key: 'note', label: textLabel, input: 'textarea', max: 2000 }] },
    { type: 'checklist', label: tr('safebox.list.checklist', 'Checklist'), icon: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11', titleLabel: tr('safebox.common.title', 'Title'), fields: [], checklist: true },
    { type: 'place', label: tr('safebox.list.place', 'Place'), icon: 'M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0zM12 7a3 3 0 1 0 0 6 3 3 0 0 0 0-6z', titleLabel: tr('safebox.common.name', 'Name'),
      located: true, fields: [{ key: 'address', label: tr('safebox.object.address', 'Address'), input: 'textarea', max: 500, copy: true }, { key: 'note', label: textLabel, input: 'textarea', max: 2000 }] },
    { type: 'contact', label: tr('safebox.list.contact', 'Contact'), icon: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8z', titleLabel: tr('safebox.common.name', 'Name'),
      fields: [{ key: 'phone', label: tr('safebox.object.phone', 'Phone'), input: 'tel', max: 50, copy: true }, { key: 'email', label: tr('safebox.object.email', 'Email'), input: 'email', max: 200, copy: true }, { key: 'note', label: textLabel, input: 'textarea', max: 2000 }] },
    { type: 'date', label: tr('safebox.common.date', 'Date'), icon: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM16 2v4M8 2v4M3 10h18', titleLabel: tr('safebox.object.whatIsIt', 'What is it?'),
      timed: true, fields: [{ key: 'date', label: tr('safebox.common.date', 'Date'), input: 'date', max: 10, required: true }, { key: 'time', label: tr('safebox.object.time', 'Time'), input: 'time', max: 5 }, { key: 'note', label: textLabel, input: 'textarea', max: 2000 }] },
    { type: 'album', label: tr('safebox.list.album', 'Album'), icon: 'M3 5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM8.5 10a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3zM21 15l-5-5L5 21', titleLabel: tr('safebox.object.albumName', 'Name of the album'), album: true,
      fields: [{ key: 'note', label: textLabel, input: 'textarea', max: 2000 }] },
    { type: 'case', label: tr('safebox.list.case', 'Case'), icon: 'M20 7H4a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V9a2 2 0 0 0-2-2zM16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16', titleLabel: tr('safebox.object.caseName', 'Name of the case'), timed: true, attachmentsMax: CASE_DOCUMENTS_MAX,
      fields: [{ key: 'reference', label: tr('safebox.object.caseNumber', 'Case number or reference'), input: 'text', max: 200, copy: true }, { key: 'party', label: tr('safebox.object.caseParty', 'With (authority, company or person)'), input: 'text', max: 300 },
        { key: 'status', label: tr('safebox.object.status', 'Status'), input: 'select', max: 20, options: [{ value: 'open', label: tr('safebox.object.statusOpen', 'Open') }, { value: 'waiting', label: tr('safebox.object.statusWaiting', 'Waiting for an answer') }, { value: 'closed', label: tr('safebox.object.statusClosed', 'Closed') }] },
        { key: 'date', label: tr('safebox.object.deadline', 'Deadline'), input: 'date', max: 10 }, { key: 'time', label: tr('safebox.object.deadlineTime', 'Time of the deadline'), input: 'time', max: 5 },
        { key: 'note', label: tr('safebox.object.caseNotes', 'Summary and notes'), input: 'textarea', max: 2000 }] },
    { type: 'ticket', label: tr('safebox.list.ticket', 'Ticket'), icon: 'M2 9a3 3 0 0 1 0 6v2a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-2a3 3 0 0 1 0-6V7a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2zM13 5v2M13 17v2M13 11v2', titleLabel: tr('safebox.object.ticketFor', 'Ticket to what?'),
      timed: true, fields: [{ key: 'where', label: tr('safebox.object.where', 'Where'), input: 'text', max: 300, copy: true }, { key: 'date', label: tr('safebox.common.date', 'Date'), input: 'date', max: 10, required: true }, { key: 'time', label: tr('safebox.object.time', 'Time'), input: 'time', max: 5 },
        { key: 'reference', label: tr('safebox.object.reference', 'Seat, booking reference or code'), input: 'text', max: 200, copy: true }, { key: 'note', label: textLabel, input: 'textarea', max: 2000 }] },
  ];
}

export const objectKind = (type: SafeboxType): ObjectKind | undefined => objectKinds().find((k) => k.type === type);

/** The sign (the `d` of a 24x24 stroke icon) of an object type; a file has none. */
export const objectIcon = (type: SafeboxType): string => objectKind(type)?.icon ?? '';

/** True for everything in the box that is not a stored file. */
export const isObjectType = (type: SafeboxType | undefined): boolean => !!type && type !== 'file';

/** A web address the app may open: http or https (a bare "example.com" gets https). Anything else (javascript:, data: ...) is refused. */
export function safeUrl(value: string): string | null {
  const text = value.trim();
  if (!text) return null;
  const full = /^[a-z][a-z0-9+.-]*:/i.test(text) ? text : `https://${text}`;
  try {
    const url = new URL(full);
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** The days from today to a date written yyyy-mm-dd (negative = in the past), or null when it is not a date. */
export function daysUntil(date: string, today = new Date()): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!m) return null;
  const then = Date.UTC(+m[1], +m[2] - 1, +m[3]);
  const now = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((then - now) / 86400000);
}

/** The line under the name in the list ('' for a secret: it shows nothing of what is inside). */
export function summaryOf(type: SafeboxType, p: ObjectPayload): string {
  const f = p.fields;
  switch (type) {
    case 'album': return '';
    case 'case': {
      const status = f['status'] === 'closed' ? tr('safebox.object.statusClosed', 'Closed') : f['status'] === 'waiting' ? tr('safebox.object.statusWaiting', 'Waiting for an answer') : tr('safebox.object.statusOpen', 'Open');
      return [status, f['reference'], daysLeft(f['date'] ?? '')].filter(Boolean).join(' · ');
    }
    case 'link': return (f['url'] ?? '').replace(/^https?:\/\//i, '');
    case 'place': return firstLine(f['address'] ?? '') || (f['lat'] && f['lng'] ? `${f['lat']}, ${f['lng']}` : '');
    case 'contact': return [f['phone'], f['email']].filter(Boolean).join(' · ');
    case 'checklist': {
      const items = p.items ?? [];
      return items.length ? tr('safebox.object.doneOfTotal', '{{ done }} of {{ total }} done', { done: items.filter((i: ChecklistEntry) => i.done).length, total: items.length }) : '';
    }
    case 'date': return daysLeft(f['date'] ?? '');
    case 'ticket': return [daysLeft(f['date'] ?? ''), f['where']].filter(Boolean).join(' · ');
    default: return '';
  }
}

function firstLine(text: string): string {
  return text.split('\n').map((l) => l.trim()).find((l) => l) ?? '';
}

/** "in 3 days", "today", "2 days ago" for a date written yyyy-mm-dd ('' when it is not one). */
function daysLeft(date: string): string {
  const days = daysUntil(date);
  if (days === null) return '';
  return days === 0 ? tr('safebox.object.today', 'today') : days > 0 ? tr('safebox.object.inDays', 'in {{ days }} days', { days }) : tr('safebox.object.daysAgo', '{{ days }} days ago', { days: -days });
}

/**
 * When an item is DUE, in milliseconds: from the start of its reminder period (the date and time minus the lead of "Remind me") or the start of its day,
 * whichever comes first, to the end of its day (local time). null for an item with no date. A date without a time counts as 09:00 for the reminder.
 */
export function dueRange(p: ObjectPayload): { from: number; to: number } | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.fields['date'] ?? '');
  if (!m) return null;
  const [y, mo, d] = [+m[1], +m[2] - 1, +m[3]];
  const t = /^(\d{2}):(\d{2})$/.exec(p.fields['time'] || '09:00') ?? ['', '09', '00'];
  const lead = REMIND_LEADS.find((l) => l.value === (p.fields['remind'] ?? ''))?.minutes ?? 0;
  const start = new Date(y, mo, d).getTime();
  const at = new Date(y, mo, d, +t[1], +t[2]).getTime();
  const to = new Date(y, mo, d + 1).getTime() - 1;
  return Number.isNaN(start) ? null : { from: Math.min(start, at - lead * 60000), to };
}

/** When a date or a ticket is, for the list and the badges: the day (in the person's language) and the time. '' for the others. */
export function whenOf(type: SafeboxType, p: ObjectPayload): string {
  if (type !== 'date' && type !== 'ticket' && type !== 'case') return '';
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(p.fields['date'] ?? '');
  if (!m) return '';
  const day = new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
  return [day, p.fields['time']].filter(Boolean).join(' ');
}

/** The choices of "remind me": minutes before the time ('none' = no reminder). */
export const REMIND_LEADS: { value: string; minutes: number | null }[] = [
  { value: 'none', minutes: null }, { value: '0', minutes: 0 }, { value: '15', minutes: 15 }, { value: '60', minutes: 60 }, { value: '120', minutes: 120 },
  { value: '1440', minutes: 1440 }, { value: '2880', minutes: 2880 }, { value: '10080', minutes: 10080 },
];
export const REMIND_DEFAULT = '1440';

/** The moment to send the reminder for a date + time (local time on this device) and a lead in minutes, as an ISO time; null when there is none. A date without a time counts as 09:00. */
export function remindAt(date: string, time: string, lead: string): string | null {
  const minutes = REMIND_LEADS.find((l) => l.value === lead)?.minutes;
  if (minutes === null || minutes === undefined) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const t = /^(\d{2}):(\d{2})$/.exec(time || '09:00');
  if (!m || !t) return null;
  const at = new Date(+m[1], +m[2] - 1, +m[3], +t[1], +t[2]).getTime() - minutes * 60000;
  return Number.isNaN(at) ? null : new Date(at).toISOString();
}
