import { NgTemplateOutlet } from '@angular/common';
import { WhyTiles } from '../why-tiles/why-tiles';
import { NextStep } from '../next-step/next-step';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

/**
 * Three welcome pages for Seven Work (the same app for business relations), public: /work1 (seven key contacts with roles), /work2 (stay close to the
 * people your work needs) and /work3 (one private space for each business relation). Only the page is new: the app inside is the same one.
 */
@Component({
  selector: 'app-work',
  imports: [NgTemplateOutlet, RouterLink, NextStep, WhyTiles],
  templateUrl: './work.html',
})
export class Work {
  protected readonly variant: 1 | 2 | 3 = (inject(ActivatedRoute).snapshot.data['variant'] ?? 1) as 1 | 2 | 3;
}
