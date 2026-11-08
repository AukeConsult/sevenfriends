import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { AuthService } from '../core/auth.service';
import { InfoNav } from '../info-nav/info-nav';

/** Locking explained in plain words, with figures (a page of the Info tab; also open without signing in). */
@Component({
  selector: 'app-locking',
  imports: [RouterLink, InfoNav],
  templateUrl: './locking.html',
})
export class Locking {
  protected readonly auth = inject(AuthService);
}
