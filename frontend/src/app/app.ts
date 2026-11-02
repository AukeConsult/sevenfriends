import { Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { BottomNav } from './bottom-nav/bottom-nav';
import { AuthService } from './core/auth.service';

@Component({
  selector: 'app-root',
  imports: [RouterOutlet, BottomNav],
  templateUrl: './app.html',
  styleUrl: './app.scss'
})
export class App {
  protected readonly auth = inject(AuthService);
}
