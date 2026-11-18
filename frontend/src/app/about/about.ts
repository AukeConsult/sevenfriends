import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { InfoNav } from '../info-nav/info-nav';
import { PageBar } from '../page-bar/page-bar';
import { version } from '../../environments/version';

/** Who made the app and how to reach them (public: also shown before signing in). */
@Component({
  selector: 'app-about',
  imports: [PageBar, RouterLink, InfoNav, TranslocoDirective],
  templateUrl: './about.html',
  providers: [provideTranslocoScope('about')],
})
export class About {
  protected readonly auth = inject(AuthService);
  /** the build counter and the time of the build (see scripts/sync-version.mjs) */
  protected readonly version = version;
  protected readonly builtAt = new Date(version.builtAt).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}
