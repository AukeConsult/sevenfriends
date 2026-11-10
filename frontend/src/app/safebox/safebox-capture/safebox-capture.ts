import { Component, input, output, signal } from '@angular/core';
import { CaptureButton, CaptureKind, Captured } from '../../capture-button/capture-button';
import { prepareRecordedAudio } from '../../core/audio';

/**
 * The buttons that make a new file on the spot (safebox files and attachments): Take a photo, Record a video, Record a voice message. They are the common
 * `app-capture-button`, the same as on every other page. What was made is given to the page as an ordinary file (`captured`), the same as one that was chosen.
 */
@Component({
  selector: 'app-safebox-capture',
  imports: [CaptureButton],
  templateUrl: './safebox-capture.html',
})
export class SafeboxCapture {
  /** no voice message (an album holds pictures and videos) */
  readonly noVoice = input(false);
  readonly disabled = input(false);
  readonly captured = output<File>();
  readonly failed = output<string>();

  /** which one is open on the page */
  protected readonly opened = signal<CaptureKind | null>(null);

  protected got(made: Captured): void {
    if (made.kind === 'audio' && made.recorded) {
      const voice = prepareRecordedAudio(made.file, made.durationMs ?? 0);
      this.captured.emit(new File([voice.blob], voice.name, { type: voice.blob.type }));
    } else this.captured.emit(made.file);
  }
}
