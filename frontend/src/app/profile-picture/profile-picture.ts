import { Component, ElementRef, Injector, afterNextRender, inject, signal, viewChild } from '@angular/core';
import { Router, RouterLink } from '@angular/router';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { Decoded, decodeImage, sizeOf } from '../core/image';
import { ProfileDetails } from '../models';

/** The side of the square the picture is cropped in, in CSS pixels (the canvas is drawn at twice this for sharpness). */
const VIEW = 280;
/** The picture that is saved: this many pixels square, as a JPEG. */
const OUTPUT = 256;
/** The biggest picture the backend keeps (70 KB): the app aims lower. */
const TARGET_BYTES = 60 * 1024;
const MAX_ZOOM = 4;
const MAX_FILE_BYTES = 20 * 1024 * 1024;

/**
 * A full page to upload a picture for the profile: choose a photo, move and zoom it inside the square (drag, pinch,
 * mouse wheel or the slider), then "Use this picture". The picture is cut to a 256 x 256 JPEG of 15-50 KB in the
 * browser and saved on the account (PUT /profile/picture), so a big photo from a phone is never sent.
 */
@Component({
  selector: 'app-profile-picture',
  imports: [RouterLink],
  templateUrl: './profile-picture.html',
})
export class ProfilePicturePage {
  private readonly api = inject(ApiService);
  private readonly router = inject(Router);
  private readonly injector = inject(Injector);
  private readonly auth = inject(AuthService);
  private readonly canvas = viewChild<ElementRef<HTMLCanvasElement>>('canvas');

  protected readonly view = VIEW;
  protected readonly maxZoom = MAX_ZOOM;
  protected readonly hasImage = signal(false);
  protected readonly zoom = signal(1);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** I already have a picture saved: it can be removed */
  protected readonly existing = signal(false);

  private source: Decoded | null = null;
  private baseScale = 1; // the scale at which the photo just covers the square
  private offsetX = 0; // where the middle of the photo is, from the middle of the square
  private offsetY = 0;
  private readonly pointers = new Map<number, { x: number; y: number }>();
  private pinch: { distance: number; zoom: number } | null = null;

  constructor() {
    afterNextRender(() => this.draw());
    void this.api.request<ProfileDetails>('/profile').then((p) => this.existing.set(p.hasPicture)).catch(() => undefined);
  }

  // ------------------------------------------------------------------ choosing the photo

  protected async onFile(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ''; // the same file can be chosen again
    if (!file) return;
    this.error.set(null);
    if (!file.type.startsWith('image/')) {
      this.error.set('Choose an image file (a photo).');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      this.error.set('That image is very big. Choose one under 20 MB.');
      return;
    }
    try {
      this.source = await decodeImage(file);
    } catch {
      this.error.set('This image cannot be opened. Try another one (JPEG, PNG or WebP).');
      return;
    }
    const { width, height } = sizeOf(this.source);
    this.baseScale = Math.max(VIEW / width, VIEW / height);
    this.zoom.set(1);
    this.offsetX = 0;
    this.offsetY = 0;
    this.hasImage.set(true);
    afterNextRender(() => this.draw(), { injector: this.injector }); // the canvas only exists once the page has shown it
  }

  // ------------------------------------------------------------------ moving and zooming

  protected setZoom(value: number): void {
    this.zoom.set(Math.min(MAX_ZOOM, Math.max(1, value)));
    this.draw();
  }

  protected onWheel(event: WheelEvent): void {
    if (!this.source) return;
    event.preventDefault();
    this.setZoom(this.zoom() * Math.exp(-event.deltaY * 0.002));
  }

  protected onPointerDown(event: PointerEvent): void {
    if (!this.source) return;
    (event.target as HTMLElement).setPointerCapture(event.pointerId);
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    this.pinch = this.pointers.size === 2 ? { distance: this.distance(), zoom: this.zoom() } : null;
  }

  protected onPointerMove(event: PointerEvent): void {
    const last = this.pointers.get(event.pointerId);
    if (!last || !this.source) return;
    this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
    if (this.pointers.size === 1) {
      this.offsetX += event.clientX - last.x;
      this.offsetY += event.clientY - last.y;
      this.draw();
    } else if (this.pointers.size === 2 && this.pinch) {
      this.setZoom(this.pinch.zoom * (this.distance() / this.pinch.distance)); // two fingers: zoom
    }
  }

  protected onPointerEnd(event: PointerEvent): void {
    this.pointers.delete(event.pointerId);
    this.pinch = null;
  }

  private distance(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.hypot(a.x - b.x, a.y - b.y) || 1;
  }

  // ------------------------------------------------------------------ drawing and saving

  /** Keeps the photo covering the whole square (no empty corners). */
  private clamp(scale: number): void {
    if (!this.source) return;
    const { width, height } = sizeOf(this.source);
    const maxX = Math.max(0, (width * scale - VIEW) / 2);
    const maxY = Math.max(0, (height * scale - VIEW) / 2);
    this.offsetX = Math.min(maxX, Math.max(-maxX, this.offsetX));
    this.offsetY = Math.min(maxY, Math.max(-maxY, this.offsetY));
  }

  /** Paints the photo as it is placed now onto a canvas whose side is `side` pixels. */
  private paint(canvas: HTMLCanvasElement, side: number): void {
    const context = canvas.getContext('2d');
    if (!context) return;
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, side, side);
    if (!this.source) return;
    const scale = this.baseScale * this.zoom();
    this.clamp(scale);
    const { width, height } = sizeOf(this.source);
    const k = side / VIEW;
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      this.source,
      k * (VIEW / 2 + this.offsetX - (width * scale) / 2),
      k * (VIEW / 2 + this.offsetY - (height * scale) / 2),
      k * width * scale,
      k * height * scale,
    );
  }

  private draw(): void {
    const canvas = this.canvas()?.nativeElement;
    if (!canvas) return;
    canvas.width = VIEW * 2;
    canvas.height = VIEW * 2;
    this.paint(canvas, VIEW * 2);
  }

  /** The chosen square as a small JPEG (a data URL): the quality goes down until it is under TARGET_BYTES. */
  private result(): string {
    for (const side of [OUTPUT, 192, 128]) {
      const out = document.createElement('canvas');
      out.width = side;
      out.height = side;
      this.paint(out, side);
      for (let quality = 0.9; quality >= 0.45; quality -= 0.15) {
        const url = out.toDataURL('image/jpeg', quality);
        if ((url.length * 3) / 4 <= TARGET_BYTES) return url;
      }
    }
    throw new Error('The picture is too big to save.');
  }

  protected async save(): Promise<void> {
    if (!this.source || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.request('/profile/picture', { method: 'PUT', body: JSON.stringify({ image: this.result() }) });
      await this.router.navigateByUrl('/settings/profile');
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not save the picture. Please try again.');
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.api.request<void>('/profile/picture', { method: 'DELETE' });
      await this.auth.clearPhoto().catch(() => undefined); // the photo of the sign-in goes too
      await this.router.navigateByUrl('/settings/profile');
    } catch (err: any) {
      this.error.set(err.message ?? 'Could not remove the picture. Please try again.');
      this.busy.set(false);
    }
  }
}
