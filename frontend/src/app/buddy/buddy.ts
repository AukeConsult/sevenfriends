import { NgTemplateOutlet } from '@angular/common';
import { WhyTiles } from '../why-tiles/why-tiles';
import { NextStep } from '../next-step/next-step';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

/**
 * Three short welcome pages for Seven Buddies (young people, 13 to 18), public: /buddy1 (close friends only, the seats in a row), /buddy2 (your people, a stack of friends
 * and a little chat) and /buddy3 (your inner circle, you in the middle). Few words, one picture, one button; the button goes on to sign-in (or home when signed in).
 */
@Component({
  selector: 'app-buddy',
  imports: [NgTemplateOutlet, RouterLink, NextStep, WhyTiles],
  templateUrl: './buddy.html',
})
export class Buddy {
  protected readonly variant: 1 | 2 | 3 = (inject(ActivatedRoute).snapshot.data['variant'] ?? 1) as 1 | 2 | 3;
}
