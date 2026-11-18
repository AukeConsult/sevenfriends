import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { Component, ElementRef, effect, inject, output, signal, viewChild } from '@angular/core';
import { Router } from '@angular/router';
import { authMessage } from '../core/auth-errors';
import { AuthService } from '../core/auth.service';
import { PhoneStep } from '../models/view';

/**
 * Phone number + SMS code, to sign in: it sits inside the Login page (no page of its own), opened by "Continue with phone". (Verifying the phone of a signed-in
 * account is done on the Profile page.) A code that was sent and not entered yet comes back after a reload.
 */
@Component({
  selector: 'app-phone-auth',
  imports: [TranslocoDirective],
  templateUrl: './phone-auth.html',
  providers: [provideTranslocoScope('phoneAuth')],
})
export class PhoneAuth {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  /** the person gave up: the Login page closes this */
  readonly closed = output<void>();

  private readonly recaptcha = viewChild.required<ElementRef<HTMLElement>>('recaptcha');

  private readonly pending = this.auth.pendingPhone();
  private readonly resume = this.pending && !this.pending.linking ? this.pending : null;
  protected readonly step = signal<PhoneStep>(this.resume ? 'code' : 'number');
  protected readonly phone = signal(this.resume?.phone ?? '');
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** "0047 900 00 000" / "+47 900 00 000" → "+4790000000"; null when it is not an international number */
  private normalize(raw: string): string | null {
    let value = raw.trim().replace(/[\s\-().]/g, '');
    if (value.startsWith('00')) value = '+' + value.slice(2);
    return /^\+[1-9]\d{6,14}$/.test(value) ? value : null;
  }

  constructor() {
    // a code that was not entered within 5 minutes is forgotten: back to the number, with a note
    let first = true;
    effect(() => {
      this.auth.phoneCodeExpired();
      if (first) first = false;
      else if (this.step() === 'code') {
        this.step.set('number');
        this.code.set('');
        this.error.set(authMessage({ code: 'auth/code-expired' }, ''));
      }
    });
  }

  protected async sendCode(): Promise<void> {
    const phone = this.normalize(this.phone());
    if (!phone) {
      this.error.set(tr('phoneAuth.writeTheNumberWith', 'Write the number with country code, for example +47 900 00 000.'));
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.sendPhoneCode(phone, this.recaptcha().nativeElement);
      this.phone.set(phone);
      this.step.set('code');
    } catch (err) {
      this.error.set(authMessage(err, tr('phoneAuth.couldNotSendThe', 'Could not send the code. Please try again.')));
    } finally {
      this.busy.set(false);
    }
  }

  protected async confirm(): Promise<void> {
    const code = this.code().trim();
    if (!code) {
      this.error.set(tr('phoneAuth.writeTheCodeFrom', 'Write the code from the text message.'));
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.confirmPhoneCode(code);
      await this.router.navigateByUrl(this.auth.landingPath());
    } catch (err) {
      this.error.set(authMessage(err, tr('phoneAuth.thatCodeDidNot', 'That code did not work. Please try again.')));
    } finally {
      this.busy.set(false);
    }
  }

  protected cancel(): void {
    this.auth.cancelPhoneCode();
    this.closed.emit();
  }

  protected changeNumber(): void {
    this.auth.cancelPhoneCode();
    this.step.set('number');
    this.code.set('');
    this.error.set(null);
  }
}
