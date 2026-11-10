import { Component, input, output, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { Camera } from '../camera/camera';
import { Voice } from '../voice/voice';
import { audioRecorderType } from '../core/audio';
import { tr } from '../core/i18n';
import { recorderType } from '../core/video';

export type CaptureKind = 'image' | 'video' | 'audio';

/** What the button hands over: a file from the camera app of a phone (`recorded` false), or a picture, a film or a voice made on the page (`recorded` true, with its length for a film or a voice). */
export interface Captured {
  kind: CaptureKind;
  file: File;
  recorded: boolean;
  durationMs: number | null;
}

/** a phone or tablet (found from the system, not from a touch screen: a Windows laptop with a touch screen ignores `capture`); iPadOS says it is a Mac */
export const onPhone = (): boolean => /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

/**
 * How a picture, a film or a voice is made here. The camera or the recorder is shown on the page wherever the browser can (a computer, the installed Android app,
 * a phone, a browser in device mode); a phone whose browser cannot (no https) uses its camera app instead (a file chooser with `capture`).
 * `available` is false when neither works (no camera, no microphone, or no https), and then no button is shown.
 */
export function captureSupport(kind: CaptureKind): { cameraApp: boolean; page: boolean; available: boolean } {
  // the camera / recorder on the page is preferred wherever the browser has one: a computer, the installed app, a phone browser, and a computer
  // that pretends to be a phone (the browser's device mode), where `capture` would only open the file chooser
  const page =
    Boolean(navigator.mediaDevices?.getUserMedia) && (kind === 'audio' ? audioRecorderType() !== null : kind === 'image' || recorderType() !== null);
  // the camera app of a phone is the way only when the page cannot (no https, no recorder in the browser)
  const cameraApp = !page && onPhone() && kind !== 'audio' && !Capacitor.isNativePlatform();
  return { cameraApp, page, available: cameraApp || page };
}

const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

/**
 * THE button that makes a new picture, film or voice on the spot: "Take a photo", "Record a video" or "Record a voice message". Every page that does this uses it
 * (the media pages of the conversation, the safebox files and attachments, the profile picture), so it is the same everywhere. It opens the camera app of the phone
 * or the camera / recorder on the page (shown instead of the button until it is done), and gives the result as `captured`. It shows nothing where it cannot work.
 */
@Component({
  selector: 'app-capture-button',
  imports: [Camera, Voice],
  templateUrl: './capture-button.html',
})
export class CaptureButton {
  readonly kind = input.required<CaptureKind>();
  readonly buttonClass = input('btn btn-light btn-sm');
  readonly disabled = input(false);
  readonly captured = output<Captured>();
  readonly failed = output<string>();
  /** the camera or the recorder is open on the page (the page can hide the rest while it is) */
  readonly openChange = output<boolean>();

  protected readonly open = signal(false);
  protected readonly support = (kind: CaptureKind) => captureSupport(kind);

  /** the same words on every page */
  protected label(): string {
    switch (this.kind()) {
      case 'image':
        return tr('core.takeAPhoto', 'Take a photo');
      case 'video':
        return tr('core.recordAVideo', 'Record a video');
      default:
        return tr('core.recordAVoiceMessage', 'Record a voice message');
    }
  }

  protected start(): void {
    this.setOpen(true);
  }

  private setOpen(value: boolean): void {
    this.open.set(value);
    this.openChange.emit(value);
  }

  protected close(): void {
    this.setOpen(false);
  }

  protected problem(message: string): void {
    this.setOpen(false);
    this.failed.emit(message);
  }

  /** the file the camera app of the phone made */
  protected picked(event: Event): void {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    if (file) this.captured.emit({ kind: this.kind(), file, recorded: false, durationMs: null });
  }

  protected photo(file: File): void {
    this.setOpen(false);
    this.captured.emit({ kind: 'image', file, recorded: true, durationMs: null });
  }

  protected film(film: { blob: Blob; durationMs: number }): void {
    this.setOpen(false);
    const ending = film.blob.type.includes('mp4') ? 'mp4' : 'webm';
    this.captured.emit({ kind: 'video', file: new File([film.blob], `video-${stamp()}.${ending}`, { type: film.blob.type }), recorded: true, durationMs: film.durationMs });
  }

  protected voice(voice: { blob: Blob; durationMs: number }): void {
    this.setOpen(false);
    this.captured.emit({ kind: 'audio', file: new File([voice.blob], `voice-${stamp()}`, { type: voice.blob.type }), recorded: true, durationMs: voice.durationMs });
  }
}
