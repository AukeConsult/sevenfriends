import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { SOUND_CHOICES, SOUND_EVENTS, SoundEvent, SoundId, SoundService } from '../core/sound.service';

/** A full page to pick the sound for one event (no drop-down that would open outside the screen). */
@Component({
  selector: 'app-sound-picker',
  imports: [RouterLink],
  templateUrl: './sound-picker.html',
})
export class SoundPicker {
  protected readonly sounds = inject(SoundService);
  private readonly route = inject(ActivatedRoute);

  protected readonly event = computed<SoundEvent>(() => {
    const id = this.route.snapshot.paramMap.get('event');
    return (SOUND_EVENTS.find((e) => e.event === id)?.event ?? 'message') as SoundEvent;
  });
  protected readonly item = computed(() => SOUND_EVENTS.find((e) => e.event === this.event())!);
  protected readonly choices = SOUND_CHOICES;
  protected readonly jingles = this.sounds.jingles;

  /** Choosing a sound plays it, so you hear what you picked. */
  protected choose(sound: string): void {
    this.sounds.choose(this.event(), sound as SoundId);
    this.sounds.preview(sound as SoundId, sound);
  }

  protected toggle(sound: string): void {
    this.sounds.toggle(sound, sound as SoundId);
  }

  protected current(): SoundId {
    return this.sounds.choices()[this.event()];
  }
}
