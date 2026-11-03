import { Clearable } from '../core/clearable';
import { Component, DestroyRef, ElementRef, inject, signal } from '@angular/core';
import { ApiService } from '../core/api.service';
import { MOODS, moodIcon, moodLabel } from '../core/moods';
import { ProfileDetails } from '../models';

/** How long after the last key press the mood message is saved. */
const SAVE_MESSAGE_MS = 800;

/**
 * My mood: one of 4 small icons and a short message, which my confirmed friends see. It saves by itself, alone
 * (PUT /profile/mood), so it can sit on any page: the Home page and the Profile page both use it.
 */
@Component({
  selector: 'app-mood-editor',
  imports: [Clearable],
  templateUrl: './mood-editor.html',
})
export class MoodEditor {
  private readonly api = inject(ApiService);
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);

  protected readonly moods = MOODS;
  protected readonly moodIcon = moodIcon;
  protected readonly moodLabel = moodLabel;
  /** the frame is closed (just my mood icon and message) until it is tapped; open it to change them */
  protected readonly open = signal(false);
  protected readonly mood = signal<number | null>(null);
  protected readonly message = signal('');
  protected readonly loaded = signal(false);
  protected readonly error = signal<string | null>(null);

  private timer: ReturnType<typeof setTimeout> | undefined;
  private messageDirty = false;

  constructor() {
    void this.load();
    // leaving the page with a message that is not saved yet: save it now
    // the message is not lost when the page is hidden, closed or left: it is saved, and the request may finish after the page is gone
    const onHide = () => {
      if (this.messageDirty) this.flushMessage(true);
    };
    document.addEventListener('visibilitychange', onHide);
    window.addEventListener('pagehide', onHide);
    inject(DestroyRef).onDestroy(() => {
      document.removeEventListener('visibilitychange', onHide);
      window.removeEventListener('pagehide', onHide);
      clearTimeout(this.timer);
      if (this.messageDirty) void this.save({ moodMessage: this.message().trim() || null }, true);
    });
  }

  private async load(): Promise<void> {
    try {
      const profile = await this.api.request<ProfileDetails>('/profile');
      this.mood.set(profile.mood);
      this.message.set(profile.moodMessage ?? '');
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not load your mood');
    } finally {
      this.loaded.set(true);
    }
  }

  /** Stick a mood on, or take it off by tapping the same one again. */
  protected choose(id: number): void {
    const next = this.mood() === id ? null : id;
    this.mood.set(next);
    void this.save({ mood: next });
    this.open.set(false); // chosen: the frame closes again
  }

  protected typed(text: string): void {
    this.message.set(text);
    this.messageDirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flushMessage(), SAVE_MESSAGE_MS);
  }

  /**
   * The message field lost focus: save the message and close the frame. It closes a moment later, and only when the focus
   * did not go to something in the frame (a mood icon that was just tapped must still get its tap).
   */
  protected leftField(): void {
    this.flushMessage();
    setTimeout(() => {
      if (!this.host.nativeElement.querySelector('#mood-panel')?.contains(document.activeElement)) this.open.set(false);
    }, 200);
  }

  /** Saves the message now. */
  protected flushMessage(keepalive = false): void {
    clearTimeout(this.timer);
    if (!this.messageDirty) return;
    this.messageDirty = false;
    void this.save({ moodMessage: this.message().trim() || null }, keepalive);
  }

  private async save(body: { mood?: number | null; moodMessage?: string | null }, keepalive = false): Promise<void> {
    this.error.set(null);
    try {
      await this.api.request<ProfileDetails>('/profile/mood', { method: 'PUT', body: JSON.stringify(body), keepalive });
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not save your mood');
    }
  }
}
