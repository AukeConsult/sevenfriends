import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, input, output, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Camera } from '../../camera/camera';
import { Voice } from '../../voice/voice';
import { audioRecorderType, prepareRecordedAudio } from '../../core/audio';
import { recorderType } from '../../core/video';

type Kind = 'image' | 'video' | 'audio';

/**
 * The buttons that make a new file on the spot: a picture, a video or a voice message (safebox files and attachments). A phone uses its camera app for the
 * picture and the video; a computer and the installed app show the camera on the page; the voice recorder is on the page everywhere. What was made is
 * given to the page as an ordinary file (`captured`), the same as one that was chosen.
 */
@Component({
  selector: 'app-safebox-capture',
  imports: [Camera, Voice, TranslocoDirective],
  templateUrl: './safebox-capture.html',
  providers: [provideTranslocoScope('safebox')],
})
export class SafeboxCapture {
  /** no voice message (an album holds pictures and videos) */
  readonly noVoice = input(false);
  readonly disabled = input(false);
  readonly captured = output<File>();
  readonly failed = output<string>();

  /** which of the three is open on the page */
  protected readonly open = signal<Kind | null>(null);

  private readonly phone = (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) && !Capacitor.isNativePlatform();
  private readonly mediaDevices = Boolean(navigator.mediaDevices?.getUserMedia);
  protected readonly canVideo = !this.phone ? this.mediaDevices && recorderType() !== null : true;
  protected readonly canVoice = this.mediaDevices && audioRecorderType() !== null;

  protected start(kind: Kind, input: HTMLInputElement | null): void {
    if (this.phone && kind !== 'audio' && input) input.click(); // the camera app of the phone
    else this.open.set(kind);
  }

  protected pick(input: HTMLInputElement): void {
    const file = input.files?.[0];
    input.value = '';
    if (file) this.captured.emit(file);
  }

  protected photo(file: File): void {
    this.open.set(null);
    this.captured.emit(file);
  }

  protected filmed(film: { blob: Blob; durationMs: number }): void {
    this.open.set(null);
    const ending = film.blob.type.includes('mp4') ? 'mp4' : 'webm';
    this.captured.emit(new File([film.blob], `video-${stamp()}.${ending}`, { type: film.blob.type }));
  }

  protected voice(voice: { blob: Blob; durationMs: number }): void {
    this.open.set(null);
    const made = prepareRecordedAudio(voice.blob, voice.durationMs);
    this.captured.emit(new File([made.blob], made.name, { type: made.blob.type }));
  }

  protected problem(message: string): void {
    this.open.set(null);
    this.failed.emit(message);
  }
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
