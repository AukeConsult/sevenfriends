import { Component, inject, signal } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { NoticeControls } from '../notice-controls/notice-controls';
import { QUICK_LENGTH, QUICK_MAX, THEMES, UiPreferencesService, quickOf } from '../core/ui-preferences';

/** A full page for the person's own settings: for now, which sound plays for what. */
@Component({
  selector: 'app-settings',
  imports: [RouterLink, NoticeControls],
  templateUrl: './settings.html',
})
export class Settings {
  /** which page this is (the route says): the preferences, the sounds, or the notifications */
  protected readonly section = inject(ActivatedRoute).snapshot.data['section'] as 'preferences' | 'notifications';
  protected readonly title = { preferences: 'Preferences', notifications: 'Notifications' }[this.section];
  protected readonly prefs = inject(UiPreferencesService);

  /** The ready-made messages being edited (empty rows are allowed while typing; only the filled ones are saved). */
  protected readonly quick = signal<string[]>([...this.prefs.get('quickMessages')]);
  protected readonly quickMax = QUICK_MAX;
  protected readonly themes = THEMES;
  protected readonly quickLength = QUICK_LENGTH;

  protected addQuick(): void {
    if (this.quick().length < QUICK_MAX) this.quick.update((list) => [...list, '']);
  }

  protected setQuick(index: number, value: string): void {
    this.quick.update((list) => list.map((text, i) => (i === index ? value : text)));
    this.saveQuick();
  }

  protected removeQuick(index: number): void {
    this.quick.update((list) => list.filter((_, i) => i !== index));
    this.saveQuick();
  }

  private saveQuick(): void {
    this.prefs.set('quickMessages', quickOf(this.quick()));
  }
}
