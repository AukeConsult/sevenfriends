import { Injectable, inject } from '@angular/core';
import { RouterStateSnapshot, TitleStrategy } from '@angular/router';
import { AttentionService } from './attention.service';

/** Page titles as before, but the AttentionService adds the count of what is waiting. */
@Injectable({ providedIn: 'root' })
export class AppTitleStrategy extends TitleStrategy {
  private readonly attention = inject(AttentionService);

  override updateTitle(snapshot: RouterStateSnapshot): void {
    this.attention.baseTitle.set(this.buildTitle(snapshot) ?? 'Seven Friends');
  }
}
