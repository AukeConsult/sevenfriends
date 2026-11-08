import { Component, inject, signal } from '@angular/core';
import { NavigationEnd, Router } from '@angular/router';
import { ActiveCircleService, CIRCLE_CHOICES, circleWords } from '../core/active-circle.service';
import { AuthService } from '../core/auth.service';

/**
 * A push or a link can be about another circle than the one this app is in: its address says so (`?incircle=work`). The app never switches by itself:
 * it asks first (Switch to that circle / Stay here), because the person may be in the middle of something. When the address names the circle the app
 * is in already, the mark is just taken out of the address.
 */
@Component({
  selector: 'app-circle-switch',
  template: `
    @if (ask(); as a) {
      <div class="sf-circle-ask" role="dialog" aria-modal="true" aria-labelledby="sf-circle-ask-title">
        <div class="sf-circle-ask-card">
          <h2 id="sf-circle-ask-title">This is about {{ a.app }}</h2>
          <p>You are in {{ here }} now. Switch to open it?</p>
          <button type="button" class="btn btn-primary w-100" (click)="switchNow()">Switch to {{ a.label }}</button>
          <button type="button" class="btn btn-outline-secondary w-100" (click)="stay()">Stay in {{ here }}</button>
        </div>
      </div>
    }
  `,
})
export class CircleSwitch {
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly active = inject(ActiveCircleService);
  protected readonly here = this.active.words.app;
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
    const wanted = params.get('incircle');
    if (!wanted) return;
    params.delete('incircle');
    const rest = params.toString();
    const clean = path + (rest ? `?${rest}` : '');
    const choice = CIRCLE_CHOICES.find((c) => c.type === wanted);
    await this.auth.ready;
    if (!choice || choice.id === this.active.id || !this.auth.user()) {
      void this.router.navigateByUrl(clean, { replaceUrl: true }); // nothing to ask: the mark goes
      return;
    }
    this.ask.set({ id: choice.id, label: choice.label, app: circleWords(choice.id).app, path: clean });
  }

  protected switchNow(): void {
    const a = this.ask();
    if (a) this.active.choose(a.id, a.path); // the app starts again in that circle, on that page
  }

  protected stay(): void {
    this.ask.set(null);
    void this.router.navigateByUrl('/', { replaceUrl: true }); // the page belongs to the other circle
  }
}
