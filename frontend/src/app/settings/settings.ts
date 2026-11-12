import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { ActiveCircleService } from '../core/active-circle.service';
import { Component, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NoticeControls } from '../notice-controls/notice-controls';
import { THEMES, UiPreferencesService } from '../core/ui-preferences';

/** A full page for the person's own settings: for now, which sound plays for what. */
@Component({
  selector: 'app-settings',
  imports: [RouterLink, NoticeControls, TranslocoDirective],
  templateUrl: './settings.html',
  providers: [provideTranslocoScope('settings')],
})
export class Settings {
  protected readonly w = inject(ActiveCircleService).words;
  /** which page this is (the route says): the preferences, the sounds, or the notifications */
  protected readonly section = inject(ActivatedRoute).snapshot.data['section'] as 'preferences' | 'notifications';
  protected readonly title = { preferences: 'Preferences', notifications: 'Notifications' }[this.section];
  protected readonly prefs = inject(UiPreferencesService);

  protected readonly themes = THEMES;
}
