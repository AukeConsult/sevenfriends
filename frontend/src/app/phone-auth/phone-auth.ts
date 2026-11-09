import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { ActiveCircleService } from '../core/active-circle.service';
import { Component, ElementRef, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { authMessage } from '../core/auth-errors';
import { AuthService } from '../core/auth.service';
import { PhoneStep } from '../models/view';

/** Phone number + SMS code. Used to sign in ('login') and to verify the phone of a signed-in account ('link'). */
@Component({
  selector: 'app-phone-auth',
  imports: [RouterLink, TranslocoDirective],
  templateUrl: './phone-auth.html',
  providers: [provideTranslocoScope('phoneAuth')],
})
export class PhoneAuth {
  protected readonly w = inject(ActiveCircleService).words;
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute).snapshot;
  protected readonly linking = this.route.data['mode'] === 'link';
  protected readonly backLink = this.linking ? '/settings/profile' : '/login';

  private readonly recaptcha = viewChild.required<ElementRef<HTMLElement>>('recaptcha');

  protected readonly step = signal<PhoneStep>('number');
  /** the number typed on the Profile page comes along as ?phone= */
  protected readonly phone = signal(this.route.queryParamMap.get('phone') ?? '');
  protected readonly code = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** "0047 900 00 000" / "+47 900 00 000" → "+4790000000"; null when it is not an international number */
  private normalize(raw: string): string | null {
    let value = raw.trim().replace(/[\s\-().]/g, '');
    if (value.startsWith('00')) value = '+' + value.slice(2);
    return /^\+[1-9]\d{6,14}$/.test(value) ? value : null;
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
      await this.auth.sendPhoneCode(phone, this.recaptcha().nativeElement, this.linking);
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
      await this.auth.confirmPhoneCode(code, this.linking);
      await this.router.navigateByUrl(this.linking ? '/settings/profile' : this.auth.landingPath());
    } catch (err) {
      this.error.set(authMessage(err, tr('phoneAuth.thatCodeDidNot', 'That code did not work. Please try again.')));
    } finally {
      this.busy.set(false);
    }
  }

  protected changeNumber(): void {
    this.step.set('number');
    this.code.set('');
    this.error.set(null);
  }
}
