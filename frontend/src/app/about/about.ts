import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { InfoNav } from '../info-nav/info-nav';

/** Who made the app and how to reach them (public: also shown before signing in). */
@Component({
  selector: 'app-about',
  imports: [RouterLink, InfoNav],
  templateUrl: './about.html',
})
export class About {
  protected readonly auth = inject(AuthService);
}
