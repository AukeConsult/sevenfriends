import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { NgTemplateOutlet } from '@angular/common';
import { WhyTiles } from '../why-tiles/why-tiles';
import { NextStep } from '../next-step/next-step';
import { Component, inject } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { Inviter } from '../inviter/inviter';

/**
 * Three welcome pages for Seven Family (the same app for close family and safe family matters), public: /family1 (your seven closest), /family2 (a safe place
 * for your family) and /family3 (close, even when far apart). Only the page is new: the app inside is the same one.
 */
@Component({
  selector: 'app-family',
  imports: [Inviter, NgTemplateOutlet, NextStep, WhyTiles, TranslocoDirective],
  templateUrl: './family.html',
  providers: [provideTranslocoScope('family')],
})
export class Family {
  protected readonly variant: 1 | 2 | 3 = (inject(ActivatedRoute).snapshot.data['variant'] ?? 1) as 1 | 2 | 3;
}
