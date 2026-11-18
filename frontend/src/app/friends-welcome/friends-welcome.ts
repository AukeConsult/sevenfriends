import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { circleWords } from '../core/active-circle.service';
import { NextStep } from '../next-step/next-step';
import { Inviter } from '../inviter/inviter';

/** a text of a welcome page: the translation key and the English words */
type Text = readonly [key: string, en: string];
/** one page: a headline, one picture (`dots` = the seven seats, `card` = a message, `poke` = a friend poking you, `lock` = a locked room) and one line */
interface Page { head: Text; kind: 'dots' | 'card' | 'lock' | 'poke'; name?: Text; card?: Text; line: Text }

/** the words of every welcome page (the texts live in friendsWelcome.json, buddy.json, work.json and family.json) */
const PAGES: Record<string, Page[]> = {
  default: [
    { head: ['friendsWelcome.headline', 'Your seven closest people.'], kind: 'dots', line: ['friendsWelcome.line', 'One calm place. No feeds, no ads.'] },
    { head: ['friendsWelcome.headlineP', 'The ones you want shall get through'], kind: 'poke', card: ['friendsWelcome.cardP', 'Mia is poking you'], line: ['friendsWelcome.lineP', 'One poke rings their phone like an alarm.'] },
    { head: ['friendsWelcome.headlineC', 'A locked room for every friend.'], kind: 'lock', card: ['friendsWelcome.boxC', 'Only you two can open it'], line: ['friendsWelcome.lineC', 'Not even we can read it.'] },
  ],
  buddies: [
    { head: ['buddy.closeBuddiesOnlyBr', 'Close buddies only.<br>Seven seats.'], kind: 'dots', line: ['buddy.keepYourPeopleClose', 'Keep your people close and the noise away.'] },
    { head: ['buddy.headlineP', 'Your buddies get through.<br>Nobody else.'], kind: 'poke', card: ['buddy.cardP', 'Jonas is poking you'], line: ['buddy.lineP', 'One poke rings your buddy’s phone like an alarm.'] },
    { head: ['buddy.yourInnerCircle', 'Your inner circle'], kind: 'lock', card: ['buddy.picsVideosVoiceJust', 'Pics, videos, voice. Just you two.'], line: ['buddy.sevenCloseFriendsAround', 'Seven close friends around you.'] },
  ],
  work: [
    { head: ['work.yourSevenKeyBr', 'Your seven key<br>business contacts'], kind: 'dots', line: ['work.theFewPeopleYour', 'The few people your work depends on. Close, clear, always reachable.'] },
    { head: ['work.headlineP', 'The contacts you need get through'], kind: 'poke', card: ['work.cardP', 'Lisa is poking you'], line: ['work.lineP', 'One poke rings their phone, when work cannot wait.'] },
    { head: ['work.onePrivateSpaceFor', 'One private space for each business relation'], kind: 'lock', card: ['work.bSharedFilesB', '<b>Shared files.</b> Only you and your contact can open them.'], line: ['work.noBigChannelsJust', 'No big channels. Just you and one contact.'] },
  ],
  family: [
    { head: ['family.yourSevenClosestBr', 'Your seven closest.<br>Always in reach.'], kind: 'dots', line: ['family.theFamilyYouCall', 'The family you call first, in one calm place.'] },
    { head: ['family.headlineP', 'Your family always<br>gets through'], kind: 'poke', card: ['family.cardP', 'Mom is poking you'], line: ['family.lineP', 'Quiet at night. A poke rings the phone if it is urgent.'] },
    { head: ['family.closeEvenWhenBr', 'Close, even when<br>far apart'], kind: 'lock', card: ['family.voiceVideoAndPhotos', 'Voice, video and photos, just for you.'], line: ['family.quietAtNightA', 'Quiet at night. A poke if it is urgent.'] },
  ],
};

/**
 * The short welcome pages of every circle, public: /friends1-3, /buddy1-3, /work1-3 and /family1-3 (the route says `data: { circle, variant }`).
 * Page 1 shows the seven seats, page 2 a message, page 3 a locked room: a headline, one picture, one line and one button (the next step for this device, see NextStep),
 * all high on the screen so it fits a small phone. "How does it work?" opens the explain page (/welcome/explain).
 */
@Component({
  selector: 'app-friends-welcome',
  imports: [Inviter, NextStep, RouterLink, TranslocoDirective],
  templateUrl: './friends-welcome.html',
  providers: [provideTranslocoScope('friendsWelcome'), provideTranslocoScope('buddy'), provideTranslocoScope('work'), provideTranslocoScope('family')],
})
export class FriendsWelcome {
  private readonly data = inject(ActivatedRoute).snapshot.data;
  /** the id of the circle of the page (default = Friends) */
  protected readonly circle: string = this.data['circle'] ?? 'default';
  protected readonly app = circleWords(this.circle).app;
  protected readonly page: Page = (PAGES[this.circle] ?? PAGES['default'])[(this.data['variant'] ?? 1) - 1];
  /** the seven seats: one colour each */
  protected readonly dots = ['#F5C4B3', '#FAC775', '#9FE1CB', '#CECBF6', '#F4C0D1', '#C0DD97', '#B5D4F4'];
}
