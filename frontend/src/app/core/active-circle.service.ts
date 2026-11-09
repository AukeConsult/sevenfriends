import { Injectable } from '@angular/core';
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
 * The ONE circle this app is bound to. An app covers exactly one circle and is blind to the others: its friends, seats, messages, unread counts and
 * live updates are all that circle's. For now the binding is `default` (friends); the test page (/viewwelcome) can choose another one for test and demo,
 * and a page opened with `?circle=work` (the previews) uses that circle for as long as it is open without remembering it.
 * Later an installed app chooses once on its first start and is changed only by "Reset this app".
 */
@Injectable({ providedIn: 'root' })
export class ActiveCircleService {
  /** the id of the circle this app is bound to */
  readonly id: string = this.start();
  /** opened with `?circle=`: a preview, nothing is remembered */
  readonly preview: boolean = this.fromAddress() !== null;
  /** this app has been bound to a circle (chosen once; for now it is the first circle until something binds it) */
  readonly bound: boolean = this.isBound();
  /** the kind of circle this is (friends, buddies, work, family): what an invite link says, so it invites into this circle */
  readonly type: string = CIRCLE_CHOICES.find((c) => c.id === this.id)?.type ?? 'friends';
  /** the words of this circle */
  readonly words: CircleWords = WORDS[this.id] ?? WORDS['default'];

  private fromAddress(): string | null {
    const wanted = new URLSearchParams(typeof location === 'undefined' ? '' : location.search).get('circle');
    return CIRCLE_CHOICES.find((c) => c.id === wanted || c.type === wanted)?.id ?? null;
  }

  private isBound(): boolean {
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

  /** For test and demo: bind this app to another circle and start again, so everything (the live updates too) belongs to that circle. */
  choose(id: string, to?: string): void {
    try {
      localStorage.setItem(KEY, id);
    } catch {
      /* no storage: the choice cannot be kept */
    }
    if (to) location.assign(to);
    else location.reload();
  }

  /**
   * A visitor who opens an invitation, or the welcome page of a circle, and goes on: an app that has no circle yet is bound to that one (the link decides)
   * and the page `to` is opened afresh in it. An app that is bound already stays as it is. false = nothing was changed.
   */
  bindIfFree(id: string, to: string): boolean {
    if (this.bound || this.preview || id === this.id) return false;
    this.choose(id, to);
    return true;
  }
}
