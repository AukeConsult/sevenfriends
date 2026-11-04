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
  /** the page that was open last (a path like `/friends`), shown again when the app is opened at its start page; null = none */
  lastPage: string | null;
  /** the microphone is opened without the filters of the browser (set once a recording came out silent) */
  micRaw: boolean;
}

const DEFAULTS: UiPreferences = { chatOrder: 'oldest', lastPage: null, micRaw: false };
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
      lastPage: typeof saved.lastPage === 'string' && saved.lastPage.startsWith('/') ? saved.lastPage : null,
      micRaw: saved.micRaw === true,
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
