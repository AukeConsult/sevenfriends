import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { ActiveCircleService } from '../core/active-circle.service';
import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { NoticeControls } from '../notice-controls/notice-controls';
import { ApiService } from '../core/api.service';
import { PROFILE_COLORS, ProfileDetails } from '../models';
import { THEMES, UiPreferencesService } from '../core/ui-preferences';

/** A full page for the person's own settings: for now, which sound plays for what. */
@Component({
  selector: 'app-settings',
  imports: [NoticeControls, TranslocoDirective],
  templateUrl: './settings.html',
  providers: [provideTranslocoScope('settings', 'profile')],
})
export class Settings {
  protected readonly w = inject(ActiveCircleService).words;
  /** which page this is (the route says): the preferences, the sounds, or the notifications */
  protected readonly section = inject(ActivatedRoute).snapshot.data['section'] as 'preferences' | 'friends' | 'notifications';
  protected readonly prefs = inject(UiPreferencesService);

  protected readonly themes = THEMES;

  private readonly api = inject(ApiService);
  protected readonly colors = PROFILE_COLORS;
  /** the colour I chose for my profile (a key of PROFILE_COLORS), seen by my friends; null = none. `loaded` = it is known, so a tap cannot save over it */
  protected readonly color = signal<string | null>(null);
  protected readonly colorLoaded = signal(false);

  constructor() {
    if (this.section === 'preferences') {
      this.api.request<ProfileDetails>('/profile').then((res) => {
        this.color.set(res.color);
        this.colorLoaded.set(true);
      }).catch(() => undefined);
    }
  }

  /** Choose my colour (null = none): shown at once, saved with a request that carries only the colour, put back if it fails. */
  protected chooseColor(key: string | null): void {
    const before = this.color();
    this.color.set(key);
    this.api.request<ProfileDetails>('/profile', { method: 'PUT', body: JSON.stringify({ color: key }) }).catch(() => this.color.set(before));
  }
}
