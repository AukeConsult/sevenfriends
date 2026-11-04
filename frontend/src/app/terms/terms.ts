import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { RouterLink } from '@angular/router';

/** The terms of use in plain words (opened from the Me menu). */
@Component({
  selector: 'app-terms',
  imports: [RouterLink],
  templateUrl: './terms.html',
})
export class Terms {
  protected readonly auth = inject(AuthService);
}
