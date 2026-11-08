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
  /** the colours of the app (see THEMES); light is the default */
  theme: ThemeKey;
  /** the size of the text in the whole app: normal (default), tiny, small, big or huge (on a phone every step is a bigger text than on a computer, see PHONE_SCALES) */
  textSize: 'normal' | 'tiny' | 'small' | 'big' | 'huge';
  /** the tab of Settings that was open last (the path of the tab): Settings opens on it again */
  settingsTab: SettingsTab;
  /** the group of the emoji picker that was open last (its name, see emojis.ts): the picker opens on it again */
  emojiTab: string;
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
  /** the safebox: files added are NOT encrypted even when both friends have a key (ticked on the safebox page); off (default) = they are encrypted */
  boxPlain: boolean;
  /** the clean-up frame of a conversation: whose messages and how old they must be are remembered (the words to look for are not) */
  cleanupWhose: 'mine' | 'both';
  cleanupDays: number | null;
  /** ready-made messages for ONE friend (by friend id), kept on this device only: listed first in that friend's + menu and on the Send a message page */
  friendQuick: Record<string, string[]>;
}

/** Where a friend link points: an invite code, or an email / phone number. */
export interface PendingFriend {
  code: string | null;
  email: string | null;
  phone: string | null;
}

/** The colour themes: `header` is the colour of the browser's address bar (the header colour of the theme in styles.scss); `dark` themes switch Bootstrap's dark mode on too. */
export const THEMES = [
  { key: 'light', label: 'Light', header: '#fde6c6', dark: false },
  { key: 'dark', label: 'Dark', header: '#1f2430', dark: true },
  { key: 'ocean', label: 'Ocean', header: '#d6eaf7', dark: false },
  { key: 'forest', label: 'Forest', header: '#dcefd3', dark: false },
  { key: 'rose', label: 'Rose', header: '#fbdde3', dark: false },
] as const;
export type ThemeKey = (typeof THEMES)[number]['key'];

/** The tabs of Settings (the path of each, see settings-shell.ts). */
export const SETTINGS_TABS = ['profile', 'preferences', 'notifications', 'encryption', 'install', 'about'] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export const QUICK_MAX = 10;
export const QUICK_LENGTH = 200;

/** How much the text grows or shrinks (the root font size is multiplied by it: everything in rem follows). */
export const TEXT_SCALES: Record<UiPreferences['textSize'], number> = { tiny: 0.8, small: 0.9, normal: 1, big: 1.15, huge: 1.35 };
/** The same on a phone (a screen up to 575 px wide): one step up, so Small is what Normal was, Normal is what Big was, and Big is 15% more. */
export const PHONE_TEXT_SCALES: Record<UiPreferences['textSize'], number> = { tiny: 0.9, small: 1, normal: 1.15, big: 1.3225, huge: 1.55 };

export const DEFAULTS: UiPreferences = { theme: 'light', textSize: 'normal', settingsTab: 'profile', emojiTab: 'People', chatOrder: 'oldest', enterSends: true, sleepList: true, quickMessages: [], feedIcons: true, setup: 'new', lastPage: null, micRaw: false, pendingFriend: null, welcomeUntil: null, boxPlain: false, cleanupWhose: 'mine', cleanupDays: 30, friendQuick: {} };

/** The ready-made messages as stored: only texts, trimmed, not empty, not too long, not too many. */
export function quickOf(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === 'string').map((v) => v.trim().slice(0, QUICK_LENGTH)).filter(Boolean).slice(0, QUICK_MAX);
}

/** The ready-made messages of each friend as stored: by friend id, each list cleaned like the general one, empty lists left out, not too many friends. */
export function friendQuickOf(value: unknown): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [id, list] of Object.entries(value as Record<string, unknown>).slice(0, 200)) {
    const clean = quickOf(list);
    if (clean.length) result[id] = clean;
  }
  return result;
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
      theme: THEMES.find((t) => t.key === saved.theme)?.key ?? 'light',
      textSize: saved.textSize === 'tiny' || saved.textSize === 'small' || saved.textSize === 'big' || saved.textSize === 'huge' ? saved.textSize : 'normal',
      settingsTab: SETTINGS_TABS.find((t) => t === saved.settingsTab) ?? 'profile',
      emojiTab: typeof saved.emojiTab === 'string' && saved.emojiTab ? saved.emojiTab.slice(0, 40) : 'People',
      chatOrder: saved.chatOrder === 'newest' ? 'newest' : 'oldest',
      enterSends: saved.enterSends !== false,
      sleepList: saved.sleepList !== false,
      quickMessages: quickOf(saved.quickMessages),
      feedIcons: saved.feedIcons !== false,
      setup: saved.setup === 'done' || saved.setup === 'skipped' ? saved.setup : 'new',
      lastPage: typeof saved.lastPage === 'string' && saved.lastPage.startsWith('/') ? saved.lastPage : null,
      micRaw: saved.micRaw === true,
      pendingFriend: pendingOf(saved.pendingFriend),
      welcomeUntil: typeof saved.welcomeUntil === 'number' && Number.isFinite(saved.welcomeUntil) ? saved.welcomeUntil : null,
      boxPlain: saved.boxPlain === true,
      cleanupWhose: saved.cleanupWhose === 'both' ? 'both' : 'mine',
      friendQuick: friendQuickOf(saved.friendQuick),
      cleanupDays: saved.cleanupDays === null || (typeof saved.cleanupDays === 'number' && Number.isInteger(saved.cleanupDays) && saved.cleanupDays > 0) ? saved.cleanupDays : 30,
    };
  } catch {
    return { ...DEFAULTS }; // private mode or damaged: the defaults, the choices last until the page is closed
  }
}

@Injectable({ providedIn: 'root' })
export class UiPreferencesService {
  private readonly state = signal<UiPreferences>(read());

  constructor() {
    this.applyLook();
    // another window or tab of this app changed a choice: follow it
    window.addEventListener('storage', (event) => {
      if (event.key === STORAGE_KEY || event.key === null) {
        this.reload();
      }
    });
    // the app comes back to the front (or a page is restored from the back/forward cache): read the stored choices again and show them
    document.addEventListener('visibilitychange', () => { if (!document.hidden) this.reload(); });
    window.addEventListener('pageshow', () => this.reload());
  }

  /** Reads the stored choices again and shows them on every page (colours and text size are page-wide, so all pages follow at once). */
  private reload(): void {
    this.state.set(read());
    this.applyLook();
  }

  /**
   * The text size is a number on the page (`--sf-text-scale`, and `--sf-text-scale-phone` for a phone), which the root font size in styles.scss multiplies; the theme is
   * `data-theme` (our colours) and `data-bs-theme` (Bootstrap's) on the page, and the colour of the browser's address bar follows it.
   * (index.html does the same before the app starts, so the page does not flash light first.)
   */
  private applyLook(): void {
    const root = document.documentElement;
    const { textSize, theme } = this.state();
    root.style.setProperty('--sf-text-scale', String(TEXT_SCALES[textSize]));
    root.style.setProperty('--sf-text-scale-phone', String(PHONE_TEXT_SCALES[textSize]));
    const chosen = THEMES.find((t) => t.key === theme) ?? THEMES[0];
    root.setAttribute('data-theme', chosen.key);
    root.setAttribute('data-bs-theme', chosen.dark ? 'dark' : 'light');
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', chosen.header);
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
    this.applyLook();
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* private mode: the choice lasts until the page is closed */
    }
  }
}
