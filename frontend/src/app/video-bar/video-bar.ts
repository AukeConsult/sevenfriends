import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, effect, input, signal } from '@angular/core';

/**
 * The controls under a video (play / pause, position, time, sound), the same in every browser: Safari and iPhone draw the native controls over the picture,
 * Chrome differently. The video is a `<video>` without `controls`, given to `video`; this bar listens to it. (The video of a message in the feed has the same bar built in.)
 */
@Component({
  selector: 'app-video-bar',
  imports: [TranslocoDirective],
  templateUrl: './video-bar.html',
  providers: [provideTranslocoScope('mediaVideo')],
  host: { class: 'w-100' },
})
export class VideoBar {
  readonly video = input<HTMLVideoElement | null>(null);
  protected readonly playing = signal(false);
  protected readonly muted = signal(false);
  protected readonly current = signal(0);
  protected readonly duration = signal(0);

  constructor() {
    effect((onCleanup) => {
      const video = this.video();
      if (!video) return;
      const state = (): void => {
        this.playing.set(!video.paused && !video.ended);
        this.muted.set(video.muted);
        this.current.set(video.currentTime);
        this.duration.set(Number.isFinite(video.duration) ? video.duration : 0);
      };
      const events = ['play', 'pause', 'ended', 'timeupdate', 'loadedmetadata', 'durationchange', 'volumechange'];
      for (const name of events) video.addEventListener(name, state);
      state();
      onCleanup(() => events.forEach((name) => video.removeEventListener(name, state)));
    });
  }

  protected toggle(): void {
    const video = this.video();
    if (!video) return;
    if (video.paused) void video.play().catch(() => undefined);
    else video.pause();
  }

  protected toggleMute(): void {
    const video = this.video();
    if (video) video.muted = !video.muted;
  }

  /**
   * The video fills the screen. An iPhone has no `requestFullscreen` for a video (Safari: `webkitEnterFullscreen`, the system player, which has its own controls);
   * elsewhere the video gets its native controls while it is full screen, since this bar is not shown then.
   */
  protected fullscreen(): void {
    const video = this.video() as (HTMLVideoElement & { webkitEnterFullscreen?: () => void; webkitRequestFullscreen?: () => void }) | null;
    if (!video) return;
    if (video.requestFullscreen) {
      const back = (): void => {
        video.controls = document.fullscreenElement === video;
        if (!video.controls) video.removeEventListener('fullscreenchange', back);
      };
      video.addEventListener('fullscreenchange', back);
      void video.requestFullscreen().catch(() => video.webkitEnterFullscreen?.());
    } else if (video.webkitRequestFullscreen) video.webkitRequestFullscreen();
    else video.webkitEnterFullscreen?.();
  }

  protected seek(seconds: string): void {
    const video = this.video();
    if (video) video.currentTime = Number(seconds);
  }

  protected clock(seconds: number): string {
    const whole = Math.floor(seconds || 0);
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
  }
}
