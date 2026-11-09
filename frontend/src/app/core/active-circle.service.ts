import { Injectable, Injector, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { tr } from './i18n';

/** The circles an app can be bound to: the id each one has on the server (friends is the first circle, `default`), and its name. */
export const CIRCLE_CHOICES = [
  { id: 'default', type: 'friends', label: 'Friends' },
  { id: 'buddies', type: 'buddies', label: 'Buddies' },
  { id: 'work', type: 'work', label: 'Work' },
  { id: 'family', type: 'family', label: 'Family' },
] as const;

const KEY = 'sf-circle';

/** The words the app uses for the people in a circle, so every page speaks the language of the circle it is in. */
export interface CircleWords {
  /** the name of the app in this circle: Seven Friends, Seven Buddies … */
  app: string;
  /** one person: friend, buddy, member, contact */
  one: string;
  /** several people: friends, buddies, members, contacts */
  many: string;
  /** the same with a capital letter, for the start of a sentence */
  One: string;
  Many: string;
  /** the first line suggested in a request */
  hello: string;
  /** the line under the name on the first pages */
  slogan: string;
}

const BASE: Record<string, Omit<CircleWords, 'One' | 'Many'>> = {
  default: { app: 'Seven Friends', one: 'friend', many: 'friends', hello: 'Hi! I would like to have you as a close friend.', slogan: 'Stay close to the friends who matter most.' },
  buddies: { app: 'Seven Buddies', one: 'buddy', many: 'buddies', hello: 'Hey! Want to be my buddy?', slogan: 'Stay close to your buddies.' },
  work: { app: 'Seven Work', one: 'contact', many: 'contacts', hello: 'Hi! I would like to have you as a contact.', slogan: 'Keep the contacts that matter close.' },
  family: { app: 'Seven Family', one: 'member', many: 'members', hello: 'Hi! I would like you in my family circle.', slogan: 'Keep your family close.' },
};

/** The name of a circle in the language of the app (Friends, Buddies, Work, Family). */
export function circleLabel(id: string): string {
  return tr(`circle.${id}.label`, CIRCLE_CHOICES.find((c) => c.id === id)?.label ?? id);
}

/** The kind of circle an id is (friends, buddies, work, family): what an address says with `?incircle=`. */
export function circleType(id: string): string {
  return CIRCLE_CHOICES.find((c) => c.id === id)?.type ?? 'friends';
}

const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);
/** The words of a circle: each one is looked up when it is read, so they follow the language of the app (public/i18n/<language>/common.json, `circle.<id>.<word>`). */
function wordsOf(id: string): CircleWords {
  const base = BASE[id];
  const word = (key: keyof typeof base) => tr(`circle.${id}.${key}`, base[key]);
  return {
    get app() { return word('app'); },
    get one() { return word('one'); },
    get many() { return word('many'); },
    get One() { return cap(word('one')); },
    get Many() { return cap(word('many')); },
    get hello() { return word('hello'); },
    get slogan() { return word('slogan'); },
  };
}
const WORDS: Record<string, CircleWords> = Object.fromEntries(Object.keys(BASE).map((id) => [id, wordsOf(id)]));

/** The words of the circle with this id (a welcome page speaks the language of its own circle, whichever circle the app is in). */
export function circleWords(id: string): CircleWords {
  return WORDS[id] ?? WORDS['default'];
}

/**
 * The ONE circle the app is working in right now. The app covers all circles, but shows exactly one at a time: its friends, seats, messages, unread counts
 * and live updates are that circle's, and it is blind to the others. The person changes circle with `choose`: the app does NOT start again, it
 * forgets everything of the old circle (every service that keeps circle data registers with `onSwitch`), looks at the new circle and shows its Home.
 * A page opened with `?circle=work` (the previews) uses that circle for as long as it is open without remembering it.
 */
@Injectable({ providedIn: 'root' })
export class ActiveCircleService {
  private readonly injector = inject(Injector);
  private readonly current = signal<string>(this.start());
  private readonly previewing = signal<boolean>(this.fromAddress() !== null);
  private readonly isBound = signal<boolean>(this.readBound());
  private readonly hooks: ((id: string) => void)[] = [];
  private changes = 0;

  /** Counts the switches once the new circle's page is shown: the root of the page is made again when it changes, so no page keeps something of the old circle. */
  readonly epoch = signal(0);

  /** the words of the circle in use, always the current circle's (the object stays the same, what it says follows the circle) */
  readonly words: CircleWords = this.liveWords();

  /** the id of the circle in use */
  get id(): string {
    return this.current();
  }
  /** opened with `?circle=`: a preview, nothing is remembered */
  get preview(): boolean {
    return this.previewing();
  }
  /** the person has chosen a circle (until then it is the first circle) */
  get bound(): boolean {
    return this.isBound();
  }
  /** the kind of circle this is (friends, buddies, work, family): what an invite link says, so it invites into this circle */
  get type(): string {
    return CIRCLE_CHOICES.find((c) => c.id === this.current())?.type ?? 'friends';
  }
  /** Counts the switches at once (before the page is made again): an answer that was asked for in an earlier circle is dropped when this has changed. */
  get generation(): number {
    return this.changes;
  }

  private liveWords(): CircleWords {
    const now = () => WORDS[this.current()] ?? WORDS['default'];
    return {
      get app() { return now().app; },
      get one() { return now().one; },
      get many() { return now().many; },
      get One() { return now().One; },
      get Many() { return now().Many; },
      get hello() { return now().hello; },
      get slogan() { return now().slogan; },
    };
  }

  private fromAddress(): string | null {
    const wanted = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('circle');
    return CIRCLE_CHOICES.find((c) => c.id === wanted || c.type === wanted)?.id ?? null;
  }

  private readBound(): boolean {
    try {
      return localStorage.getItem(KEY) !== null;
    } catch {
      return false;
    }
  }

  private start(): string {
    const fromAddress = this.fromAddress();
    if (fromAddress) return fromAddress;
    try {
      const stored = localStorage.getItem(KEY);
      return CIRCLE_CHOICES.find((c) => c.id === stored)?.id ?? 'default';
    } catch {
      return 'default';
    }
  }

  /**
   * A service that keeps anything of the circle (a list, a cache, a listener) registers here. `forget` runs the moment the circle is changed,
   * before anything is shown of the new one, and gets the id of the new circle. It must be quick and must not wait for the network.
   */
  onSwitch(forget: (id: string) => void): void {
    this.hooks.push(forget);
  }

  /**
   * Change the circle without starting the app again: the circle is remembered, every service forgets the old circle's state, and the person
   * is taken to `to` (Home when none) in the new circle. Choosing the circle that is in use only goes to `to`.
   */
  choose(id: string, to?: string): void {
    if (!CIRCLE_CHOICES.some((c) => c.id === id)) return;
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* no storage: the choice cannot be kept */
    }
    this.isBound.set(true);
    this.previewing.set(false);
    const changed = id !== this.current();
    if (changed) {
      this.changes++;
      this.current.set(id);
      for (const forget of this.hooks) {
        try {
          forget(id);
        } catch (error) {
          console.warn('A service could not forget the old circle:', error);
        }
      }
    }
    // the Router is fetched when needed: the Router depends on services that depend on this one
    const done = () => { if (changed) this.epoch.update((n) => n + 1); };
    this.injector.get(Router).navigateByUrl(to ?? '/', { replaceUrl: true }).then(done, done);
  }

  /**
   * A visitor who opens an invitation, or the welcome page of a circle, and goes on: an app that has no circle yet is bound to that one (the link decides)
   * and the page `to` is opened in it. An app that is bound already stays as it is. false = nothing was changed.
   */
  bindIfFree(id: string, to: string): boolean {
    if (this.bound || this.preview || id === this.id) return false;
    this.choose(id, to);
    return true;
  }
}
