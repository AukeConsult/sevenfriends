import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ActiveCircleService, CIRCLE_CHOICES } from '../core/active-circle.service';
import { AuthService } from '../core/auth.service';
import { tr } from '../core/i18n';

/** The welcome pages of each circle; a visit to /welcome/<circle> opens one of them, picked by chance . */
export const CIRCLE_PAGES: Record<string, string[]> = {
  friends: ['/friends1', '/friends2', '/friends3'],
  buddies: ['/buddy1', '/buddy2', '/buddy3'],
  work: ['/work1', '/work2', '/work3'],
  family: ['/family1', '/family2', '/family3'],
};

/**
 * /welcome/<circle>: a welcome page of that circle, picked by chance. /<circle> (friends, buddy, work, family): straight into that circle: Home when signed in, the
 * sign-in when not. An app that has no circle yet is bound to it first. An app that belongs to another circle stays there and says so (with a way to switch).
 * Which one it is comes from the route: `data: { circle: 'buddies', welcome: true }`.
 */
@Component({
  selector: 'app-circle-entry',
  template: `
    @if (other(); as o) {
      <main class="sf-landing text-center vstack gap-3 align-items-center">
        <p class="m-0">{{ tr('core.thisAppIs', 'This app is ' + (o.app) + '.', { app: o.app }) }}</p>
        <button type="button" class="btn btn-primary" (click)="stay()">{{ tr('core.open', 'Open ' + (o.app), { app: o.app }) }}</button>
        <button type="button" class="btn btn-outline-secondary" (click)="switchTo()">{{ tr('core.switchTo', 'Switch to ' + (wanted.label), { label: wanted.label }) }}</button>
      </main>
    }
  `,
})
export class CircleEntry {
  protected readonly tr = tr;
  private readonly router = inject(Router);
  private readonly auth = inject(AuthService);
  private readonly active = inject(ActiveCircleService);
  private readonly data = inject(ActivatedRoute).snapshot.data;
  protected readonly wanted = CIRCLE_CHOICES.find((c) => c.type === this.data['circle']) ?? CIRCLE_CHOICES[0];
  /** set when this app belongs to another circle: its name */
  protected readonly other = signal<{ app: string } | null>(null);

  constructor() {
    void this.go();
  }

  private async go(): Promise<void> {
    if (this.data['welcome']) {
      const pages = CIRCLE_PAGES[this.wanted.type];
      void this.router.navigateByUrl(pages[Math.floor(Math.random() * pages.length)], { replaceUrl: true });
      return;
    }
    if (this.wanted.id !== this.active.id) {
      if (this.active.bindIfFree(this.wanted.id, `/${this.path()}`)) return; // the app starts again in this circle
      this.other.set({ app: this.active.words.app });
      return;
    }
    await this.auth.ready;
    void this.router.navigateByUrl(this.auth.user() ? '/' : '/login', { replaceUrl: true });
  }

  private path(): string {
    return this.wanted.type === 'friends' ? 'friends' : this.wanted.type === 'buddies' ? 'buddy' : this.wanted.type;
  }

  protected stay(): void {
    void this.router.navigateByUrl('/', { replaceUrl: true });
  }

  protected switchTo(): void {
    this.active.choose(this.wanted.id, '/');
  }
}
