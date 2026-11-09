import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { NgTemplateOutlet } from '@angular/common';
import { Component, computed, DestroyRef, inject } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { SOUND_CHOICES, SOUND_EVENTS, SoundEvent, SoundId, SoundService } from '../core/sound.service';

/** A full page to pick the sound for one event (no drop-down that would open outside the screen). */
@Component({
  selector: 'app-sound-picker',
  imports: [NgTemplateOutlet, TranslocoDirective],
  templateUrl: './sound-picker.html',
  providers: [provideTranslocoScope('soundPicker')],
})
export class SoundPicker {
  protected readonly sounds = inject(SoundService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);

  protected readonly event = computed<SoundEvent>(() => {
    const id = this.route.snapshot.paramMap.get('event');
    return (SOUND_EVENTS.find((e) => e.event === id)?.event ?? 'message') as SoundEvent;
  });
  protected readonly item = computed(() => SOUND_EVENTS.find((e) => e.event === this.event())!);
  protected readonly choices = SOUND_CHOICES;
  protected readonly jingles = this.sounds.jingles;
  /** opened from the setup wizard: Back and Done return to the wizard (its sound step) instead of Settings */
  protected readonly fromSetup = this.route.snapshot.queryParamMap.has('setup');

  constructor() {
    // the list of sounds updates by itself: when the page opens, when the app comes back to the front, and every half minute while it is open
    const update = () => void this.sounds.loadJingles();
    update();
    const timer = setInterval(update, 30_000);
    const visible = () => {
      if (document.visibilityState === 'visible') update();
    };
    document.addEventListener('visibilitychange', visible);
    inject(DestroyRef).onDestroy(() => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', visible);
    });
  }

  /** Choosing a sound selects it and goes back (it does not play: the ▶ on each row is for listening first). */
  protected choose(sound: string): void {
    this.sounds.stop();
    this.sounds.choose(this.event(), sound as SoundId);
    void this.router.navigate([this.fromSetup ? '/setup' : '/settings/notifications'], { queryParams: this.fromSetup ? { step: 'sounds' } : null });
  }

  protected toggle(sound: string): void {
    this.sounds.toggle(sound, sound as SoundId);
  }

  protected current(): SoundId {
    return this.sounds.choices()[this.event()];
  }
}
