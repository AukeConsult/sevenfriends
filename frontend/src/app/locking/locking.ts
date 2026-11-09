import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { InfoNav } from '../info-nav/info-nav';

/** Locking explained in plain words, with figures (a page of the Info tab; also open without signing in). */
@Component({
  selector: 'app-locking',
  imports: [RouterLink, InfoNav, TranslocoDirective],
  templateUrl: './locking.html',
  providers: [provideTranslocoScope('locking')],
})
export class Locking {
  protected readonly auth = inject(AuthService);
}
