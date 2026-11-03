import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BottomNav } from './bottom-nav/bottom-nav';
import { AuthService } from './core/auth.service';
import { InstallService } from './core/install.service';
import { PresenceService } from './core/presence.service';
import { RealtimeService } from './core/realtime.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, BottomNav],
  templateUrl: './app.html'
})
export class App {
  protected readonly auth = inject(AuthService);

  constructor() {
    inject(RealtimeService); // starts listening for live updates (friend requests, messages) once somebody is signed in
    inject(InstallService); // catches the browser's install offer early (it can arrive soon after the page opens)
    inject(PresenceService); // tells the system when the person is active, away or offline (the dot on their friends)
  }
}
