import { Component, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { DesktopNoticeService } from '../core/desktop-notice.service';
import { PushService } from '../core/push.service';
import { SOUND_CHOICES, SOUND_EVENTS, SoundEvent, SoundService } from '../core/sound.service';

/** A full page for the person's own settings: for now, which sound plays for what. */
@Component({
  selector: 'app-settings',
  imports: [RouterLink],
  templateUrl: './settings.html',
})
export class Settings {
  protected readonly sounds = inject(SoundService);
  protected readonly desktop = inject(DesktopNoticeService);
  protected readonly push = inject(PushService);
  protected readonly noticeProblem = signal<string | null>(null);

  constructor() {
    this.sounds.markDefined(); // the person has now seen the sound settings
  }
  protected readonly events = SOUND_EVENTS;
  private readonly choices = SOUND_CHOICES;
  protected readonly jingles = this.sounds.jingles;

  /** The name of the sound chosen for an event. */
  protected soundLabel(event: SoundEvent): string {
    const id = this.sounds.choices()[event];
    if (id.startsWith('file:')) return this.jingles().find((j) => `file:${j.file}` === id)?.label ?? id.slice(5);
    return this.choices.find((c) => c.id === id)?.label ?? id;
  }

  protected async setPush(on: boolean, input: HTMLInputElement): Promise<void> {
    const enabled = await this.push.setEnabled(on);
    input.checked = enabled; // the switch shows what really happened
  }

  protected async setDesktop(on: boolean): Promise<void> {
    this.noticeProblem.set(null);
    const allowed = await this.desktop.setWanted(on);
    if (on && !allowed) {
      this.noticeProblem.set(
        this.desktop.supported
          ? 'Notifications are blocked for this site. Allow them in the browser settings (the lock icon next to the address), then try again.'
          : 'This browser cannot show desktop notifications.',
      );
    }
  }

  /** Also works before the switch is on: asks for permission first, then shows the pop-up. */
  protected async testNotice(): Promise<void> {
    if (!this.desktop.wanted()) {
      await this.setDesktop(true);
      if (!this.desktop.wanted()) return; // not allowed: the reason is shown
    }
    await this.desktop.show(
      { title: 'Seven Friends', body: 'This is how a notification looks.', id: `test-${Date.now()}`, silent: false, go: '/sound-and-notifications' },
      true,
    );
  }

  protected setVolume(percent: string): void {
    this.sounds.setVolume(Number(percent));
  }

  protected tryOut(event: SoundEvent): void {
    this.sounds.toggle(event, this.sounds.choices()[event]);
  }
}
