import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { WhyTiles } from '../why-tiles/why-tiles';
import { NextStep } from '../next-step/next-step';

/**
 * Three short welcome pages for Seven Friends, public: /friends1 (seven people around you, "that is your circle") and /friends2 (a phone that is quiet until it matters) and /friends3 (a private room for every friend).
 * Few words, one picture, one button; the button is the next step for this device (see NextStep).
 */
@Component({
  selector: 'app-friends-welcome',
  imports: [RouterLink, NextStep, WhyTiles, TranslocoDirective],
  templateUrl: './friends-welcome.html',
  providers: [provideTranslocoScope('friendsWelcome')],
})
export class FriendsWelcome {
  protected readonly variant: 1 | 2 | 3 = (inject(ActivatedRoute).snapshot.data['variant'] ?? 1) as 1 | 2 | 3;
  /** the colour of the page: the button, the logo (as on the other circles, each page has its own) */
  protected readonly look = [{ bg: '#185FA5', fg: '#E6F1FB' }, { bg: '#534AB7', fg: '#EEEDFE' }, { bg: '#0F6E56', fg: '#E1F5EE' }][this.variant - 1];
  /** the seven people around you in page 1: the letter, the colours */
  protected readonly ring = [
    ['M', '#F5C4B3', '#712B13'],
    ['J', '#FAC775', '#633806'],
    ['S', '#9FE1CB', '#085041'],
    ['L', '#CECBF6', '#3C3489'],
    ['A', '#F4C0D1', '#72243E'],
    ['K', '#C0DD97', '#27500A'],
    ['T', '#B5D4F4', '#0C447C'],
  ];
}
