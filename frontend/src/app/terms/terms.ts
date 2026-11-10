import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { InfoNav } from '../info-nav/info-nav';
import { RouterLink } from '@angular/router';
import { PageBar } from '../page-bar/page-bar';

/** The terms of use in plain words (opened from the Me menu). */
@Component({
  selector: 'app-terms',
  imports: [PageBar, RouterLink, InfoNav, TranslocoDirective],
  templateUrl: './terms.html',
  providers: [provideTranslocoScope('terms')],
})
export class Terms {
  protected readonly auth = inject(AuthService);
}
