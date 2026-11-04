import { Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { InstallService } from '../core/install.service';

/** What "install" means and how to do it on this device (opened from the Me menu). */
@Component({
  selector: 'app-install-app',
  imports: [RouterLink],
  templateUrl: './install-app.html',
})
export class InstallApp {
  protected readonly app = inject(InstallService);
}
