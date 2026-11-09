import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { ActiveCircleService, CIRCLE_CHOICES, circleWords } from '../core/active-circle.service';
import { AuthService } from '../core/auth.service';
import { tr } from '../core/i18n';

/**
 * A link can be about another circle than the one the app is in: its address says so (`?incircle=work`). The app never switches by itself for a link:
 * it asks first (Switch to that circle / Stay here), because the person may be in the middle of something. A tap on a notification about another circle
 * (`?opencircle=work`) is a clear wish: the app switches at once and opens the page. When the address names the circle the app is in already, the mark is
 * just taken out of the address.
 */
@Component({
  selector: 'app-circle-switch',
  template: `
    @if (ask(); as a) {
      <div class="sf-circle-ask" role="dialog" aria-modal="true" aria-labelledby="sf-circle-ask-title">
        <div class="sf-circle-ask-card">
          <h2 id="sf-circle-ask-title">{{ tr('core.thisIsAbout', 'This is about ' + (a.app), { app: a.app }) }}</h2>
          <p>{{ tr('core.youAreInNow', 'You are in ' + (here) + ' now. Switch to open it?', { here: here }) }}</p>
          <button type="button" class="btn btn-primary w-100" (click)="switchNow()">{{ tr('core.switchTo', 'Switch to ' + (a.label), { label: a.label }) }}</button>
          <button type="button" class="btn btn-outline-secondary w-100" (click)="stay()">{{ tr('core.stayIn', 'Stay in ' + (here), { here: here }) }}</button>
        </div>
      </div>
    }
  `,
})
export class CircleSwitch {
  protected readonly tr = tr;
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly active = inject(ActiveCircleService);
  protected get here(): string { return this.active.words.app; }
  /** the circle that was asked for (when it is another one), and the page without the mark */
  protected readonly ask = signal<{ id: string; label: string; app: string; path: string } | null>(null);

  constructor() {
    this.router.events.subscribe((event) => {
      if (event instanceof NavigationEnd) void this.check(event.urlAfterRedirects);
    });
  }

  private async check(url: string): Promise<void> {
    const [path, query = ''] = url.split('?');
    const params = new URLSearchParams(query.split('#')[0]);
    // `opencircle` (a tap on a notification about another circle) switches at once; `incircle` (a link) asks first
    const openNow = params.get('opencircle');
    const wanted = openNow ?? params.get('incircle');
    if (!wanted) return;
    params.delete('incircle');
    params.delete('opencircle');
    const rest = params.toString();
    const clean = path + (rest ? `?${rest}` : '');
    const choice = CIRCLE_CHOICES.find((c) => c.type === wanted);
    await this.auth.ready;
    if (!choice || choice.id === this.active.id || !this.auth.user()) {
      void this.router.navigateByUrl(clean, { replaceUrl: true }); // nothing to ask: the mark goes
      return;
    }
    if (openNow) {
      this.active.choose(choice.id, clean); // the person tapped a notification about that circle: the app is there and opens the page
      return;
    }
    this.ask.set({ id: choice.id, label: choice.label, app: circleWords(choice.id).app, path: clean });
  }

  protected switchNow(): void {
    const a = this.ask();
    if (a) {
      this.ask.set(null);
      this.active.choose(a.id, a.path); // the app shows that circle, on that page
    }
  }

  protected stay(): void {
    this.ask.set(null);
    void this.router.navigateByUrl('/', { replaceUrl: true }); // the page belongs to the other circle
  }
}
