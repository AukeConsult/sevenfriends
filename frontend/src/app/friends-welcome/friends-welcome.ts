import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { circleWords } from '../core/active-circle.service';
import { NextStep } from '../next-step/next-step';
import { Inviter } from '../inviter/inviter';

/** a text of a welcome page: the translation key and the English words */
type Text = readonly [key: string, en: string];
/** one page: a headline, one picture (`dots` = the seven seats, `card` = a message, `lock` = a locked room) and one line */
interface Page { head: Text; kind: 'dots' | 'card' | 'lock'; name?: Text; card?: Text; line: Text }

/** the words of every welcome page (the texts live in friendsWelcome.json, buddy.json, work.json and family.json) */
const PAGES: Record<string, Page[]> = {
  default: [
    { head: ['friendsWelcome.headline', 'Your seven closest people.'], kind: 'dots', line: ['friendsWelcome.line', 'One calm place. No feeds, no ads.'] },
    { head: ['friendsWelcome.headlineB', 'Your phone, finally quiet.'], kind: 'card', name: ['friendsWelcome.mia', 'Mia'], card: ['friendsWelcome.coffeeAt', 'Coffee at 5?'], line: ['friendsWelcome.lineB', 'Only your seven can reach you.'] },
    { head: ['friendsWelcome.headlineC', 'A locked room for every friend.'], kind: 'lock', card: ['friendsWelcome.boxC', 'Only you two can open it'], line: ['friendsWelcome.lineC', 'Not even we can read it.'] },
  ],
  buddies: [
    { head: ['buddy.closeBuddiesOnlyBr', 'Close buddies only.<br>Seven seats.'], kind: 'dots', line: ['buddy.keepYourPeopleClose', 'Keep your people close and the noise away.'] },
    { head: ['buddy.yourPeopleBrOnly', 'Your people.<br>Only the close ones.'], kind: 'card', card: ['buddy.youUp', 'you up?'], line: ['buddy.privateNoAdsNo', 'Private. No ads. No feed.'] },
    { head: ['buddy.yourInnerCircle', 'Your inner circle'], kind: 'lock', card: ['buddy.picsVideosVoiceJust', 'Pics, videos, voice. Just you two.'], line: ['buddy.sevenCloseFriendsAround', 'Seven close friends around you.'] },
  ],
  work: [
    { head: ['work.yourSevenKeyBr', 'Your seven key<br>business contacts'], kind: 'dots', line: ['work.theFewPeopleYour', 'The few people your work depends on. Close, clear, always reachable.'] },
    { head: ['work.stayCloseToThe', 'Stay close to the people your work needs'], kind: 'card', card: ['work.seeWhoYouHaven', 'See who you haven’t spoken to in a while'], line: ['work.privateNoAdsNo', 'Private. No ads. No feed.'] },
    { head: ['work.onePrivateSpaceFor', 'One private space for each business relation'], kind: 'lock', card: ['work.bSharedFilesB', '<b>Shared files.</b> Only you and your contact can open them.'], line: ['work.noBigChannelsJust', 'No big channels. Just you and one contact.'] },
  ],
  family: [
    { head: ['family.yourSevenClosestBr', 'Your seven closest.<br>Always in reach.'], kind: 'dots', line: ['family.theFamilyYouCall', 'The family you call first, in one calm place.'] },
    { head: ['family.aSafePlaceBr', 'A safe place<br>for your family'], kind: 'card', card: ['family.onlyThePeopleYou', 'Only the people you invite. No strangers.'], line: ['family.noAdsNoFeed', 'No ads. No feed. Nothing sold.'] },
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
