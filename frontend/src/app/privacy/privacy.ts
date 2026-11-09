import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { InfoNav } from '../info-nav/info-nav';
import { RouterLink } from '@angular/router';

/** What is stored, who can see it, the GDPR rights and every way to delete (opened from the Me menu). */
@Component({
  selector: 'app-privacy',
  imports: [RouterLink, InfoNav, TranslocoDirective],
  templateUrl: './privacy.html',
  providers: [provideTranslocoScope('privacy')],
})
export class Privacy {
  protected readonly auth = inject(AuthService);
}
