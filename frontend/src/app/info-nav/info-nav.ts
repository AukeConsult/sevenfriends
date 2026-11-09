import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component } from '@angular/core';
import { RouterLink, RouterLinkActive } from '@angular/router';

/** The pages of the Info tab: who made the app, the terms of use, the data and privacy, and how locking works. */
@Component({
  selector: 'app-info-nav',
  imports: [RouterLink, RouterLinkActive, TranslocoDirective],
  templateUrl: './info-nav.html',
  providers: [provideTranslocoScope('infoNav')],
})
export class InfoNav {}
