import { Injectable, Signal, computed, signal } from '@angular/core';

/**
 * Everything the person chooses in THIS app on THIS device that is not part of their account
 * (the sounds are an account setting, see sound.service.ts). It is ONE object in localStorage (`STORAGE_KEY`), so a
 * reload, a new visit or a second window finds the same choices. Every page that has a choice reads and writes it
 * through this service, never through localStorage itself: add a new choice to `UiPreferences` and `DEFAULTS`.
 *
 * Deliberately NOT remembered: the filter of "delete these messages" (it always starts with the safe defaults).
 */
export interface UiPreferences {
  /** the order of a conversation: the oldest message first (default) or the newest first */
  chatOrder: 'oldest' | 'newest';
  /** Enter sends the message (Shift+Enter is a new line); off (default) = Enter is a new line and Ctrl+Enter sends */
  enterSends: boolean;
  /** friends can be put on a sleep list (default) instead of being deleted; off = the card offers Delete only, and the sleep list row is hidden while the list is empty */
  sleepList: boolean;
  /** a picture next to every message in a conversation (mine too); off = only the bubbles */
  feedIcons: boolean;
  /** ready-made messages: they are listed in the + menu of a conversation and sent with one tap (at most QUICK_MAX, each at most QUICK_LENGTH characters) */
  quickMessages: string[];
  /** the first-time setup (/setup): 'new' = not offered yet, 'skipped' = left for later (Home offers it again), 'done' */
  setup: 'new' | 'skipped' | 'done';
  /** the page that was open last (a path like `/friends`), shown again when the app is opened at its start page; null = none */
  lastPage: string | null;
  /** the microphone is opened without the filters of the browser (set once a recording came out silent) */
  micRaw: boolean;
  /** who an opened friend link points to (see friend-link.service.ts): kept until the person has signed in and answered it; null = none */
  pendingFriend: PendingFriend | null;
  /** "Continue in the browser" on the welcome page was chosen: it is not shown again until this time (milliseconds since 1970); null = show it */
  welcomeUntil: number | null;
}

/** Where a friend link points: an invite code, or an email / phone number. */
export interface PendingFriend {
  code: string | null;
  email: string | null;
  phone: string | null;
}

export const QUICK_MAX = 10;
export const QUICK_LENGTH = 200;

const DEFAULTS: UiPreferences = { chatOrder: 'oldest', enterSends: false, sleepList: true, quickMessages: [], feedIcons: true, setup: 'new', lastPage: null, micRaw: false, pendingFriend: null, welcomeUntil: null };

/** The ready-made messages as stored: only texts, trimmed, not empty, not too long, not too many. */
export function quickOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim().slice(0, QUICK_LENGTH)).filter(Boolean).slice(0, QUICK_MAX);
}

const text = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

function pendingOf(value: unknown): PendingFriend | null {
  if (!value || typeof value !== 'object') return null;
  const v = value as Record<string, unknown>;
  const pending = { code: text(v['code']), email: text(v['email']), phone: text(v['phone']) };
  return pending.code || pending.email || pending.phone ? pending : null;
}
const STORAGE_KEY = 'sf-ui';
/** The two separate keys that were used before this object existed: read once, then the object is used. */
const OLD_CHAT_ORDER = 'sf-chat-order';
const OLD_MIC_RAW = 'sf-mic-raw';

/** What is in storage, checked field by field (a missing or damaged field falls back to its default). */
function read(): UiPreferences {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) {
      return {
        ...DEFAULTS,
        chatOrder: localStorage.getItem(OLD_CHAT_ORDER) === 'newest' ? 'newest' : 'oldest',
        micRaw: localStorage.getItem(OLD_MIC_RAW) === '1',
      };
    }
    const saved = JSON.parse(raw) as Partial<Record<keyof UiPreferences, unknown>>;
    return {
      chatOrder: saved.chatOrder === 'newest' ? 'newest' : 'oldest',
      enterSends: saved.enterSends === true,
      sleepList: saved.sleepList !== false,
      quickMessages: quickOf(saved.quickMessages),
      feedIcons: saved.feedIcons !== false,
      setup: saved.setup === 'done' || saved.setup === 'skipped' ? saved.setup : 'new',
      lastPage: typeof saved.lastPage === 'string' && saved.lastPage.startsWith('/') ? saved.lastPage : null,
      micRaw: saved.micRaw === true,
      pendingFriend: pendingOf(saved.pendingFriend),
      welcomeUntil: typeof saved.welcomeUntil === 'number' && Number.isFinite(saved.welcomeUntil) ? saved.welcomeUntil : null,
    };
  } catch {
    return { ...DEFAULTS }; // private mode or damaged: the defaults, the choices last until the page is closed
  }
}

@Injectable({ providedIn: 'root' })
export class UiPreferencesService {
  private readonly state = signal<UiPreferences>(read());

  constructor() {
    // another window or tab of this app changed a choice: follow it
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === null) this.state.set(read());
    });
  }

  /** One choice as a signal (for templates and computed values). */
  value<K extends keyof UiPreferences>(key: K): Signal<UiPreferences[K]> {
    return computed(() => this.state()[key]);
  }

  get<K extends keyof UiPreferences>(key: K): UiPreferences[K] {
    return this.state()[key];
  }

  /** Change one choice: it is remembered at once (merged into what is stored, so a second window's other choices are kept). */
  set<K extends keyof UiPreferences>(key: K, value: UiPreferences[K]): void {
    const next = { ...read(), [key]: value };
    this.state.set(next);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode: the choice lasts until the page is closed */
    }
  }
}
