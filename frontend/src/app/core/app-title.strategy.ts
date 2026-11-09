import { Injectable, inject } from '@angular/core';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { ActiveCircleService } from './active-circle.service';
import { AttentionService } from './attention.service';
import { tr } from './i18n';

/** The key of a page title in common.json (`titles.<key>`): "Add a friend" -> addAFriend. */
const titleKey = (page: string) => page.toLowerCase().replace(/[^a-z0-9]+(.)?/g, (_, c?: string) => (c ?? '').toUpperCase());

/** Page titles as before, in the language of the app (read when the page is opened), but the AttentionService adds the count of what is waiting. */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly attention = inject(AttentionService);
  private readonly words = inject(ActiveCircleService).words;

  override updateTitle(snapshot: RouterStateSnapshot): void {
    const built = this.buildTitle(snapshot) ?? 'Seven Friends';
    const page = /^(.*) – Seven Friends$/.exec(built)?.[1];
    this.attention.baseTitle.set(page ? `${tr('titles.' + titleKey(page), page)} – ${this.words.app}` : built.replace(/Seven Friends$/, this.words.app));
  }
}
