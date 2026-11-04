import { Component, inject } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { RouterLink } from '@angular/router';

/** What is stored, who can see it, the GDPR rights and every way to delete (opened from the Me menu). */
@Component({
  selector: 'app-privacy',
  imports: [RouterLink],
  templateUrl: './privacy.html',
})
export class Privacy {
  protected readonly auth = inject(AuthService);
}
