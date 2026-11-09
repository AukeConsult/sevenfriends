import { Component, inject, input } from '@angular/core';
import { Router } from '@angular/router';
import { ActiveCircleService } from '../core/active-circle.service';
import { AuthService } from '../core/auth.service';
import { InstallService } from '../core/install.service';
import { WelcomeService } from '../core/welcome.service';
import { tr } from '../core/i18n';

/**
 * The end of every welcome page: it knows the device and offers the right next move. Signed in: on to Home (and, in a browser tab, the install step of this device, quieter). Already the installed app: on to sign-in.
 * Otherwise the install step of this device (the Android app, Add to Home Screen, the Windows installer, or the browser's own install) and, quieter, "Continue in the browser".
 * An app that has no circle yet is bound to the circle of the page on the way (the page decides), so the install and sign-in pages open in it.
 */
@Component({
  selector: 'app-next-step',
  host: { style: 'display:block' },
  template: `
    @if (auth.user()) {
      <button type="button" [class]="ctaClass()" [style.background]="bg()" [style.color]="fg()" (click)="open('/')">{{ back() }}</button>
      @if (!install.installed()) {
        <!-- signed in, but in a browser tab: the install step of this device is still offered, as on /welcome -->
        <button type="button" [class]="ctaClass()" style="background:transparent;margin-top:8px" [style.color]="bg()" [style.border]="'1.5px solid ' + bg()" (click)="open(installPage)">{{ installLabel }}</button>
        <p style="font-size:12px;opacity:.75;margin:8px 0 0;text-align:center">{{ note }}</p>
      }
    } @else if (install.installed()) {
      <button type="button" [class]="ctaClass()" [style.background]="bg()" [style.color]="fg()" (click)="signIn()">{{ cta() }}</button>
    } @else {
      <button type="button" [class]="ctaClass()" [style.background]="bg()" [style.color]="fg()" (click)="open(installPage)">{{ installLabel }}</button>
      <button type="button" [class]="ctaClass()" style="background:transparent;margin-top:8px" [style.color]="bg()" [style.border]="'1.5px solid ' + bg()" (click)="signIn()">{{ tr('core.continueInTheBrowser', 'Continue in the browser') }}</button>
      <p style="font-size:12px;opacity:.75;margin:8px 0 0;text-align:center">{{ note }}</p>
    }
  `,
})
export class NextStep {
  protected readonly tr = tr;
  protected readonly auth = inject(AuthService);
  protected readonly install = inject(InstallService);
  private readonly active = inject(ActiveCircleService);
  private readonly router = inject(Router);
  private readonly welcome = inject(WelcomeService);

  /** the id of the circle of this page */
  readonly circle = input.required<string>();
  /** the words of the button when the person is signed out (and in the installed app), and when signed in */
  readonly cta = input.required<string>();
  readonly back = input.required<string>();
  /** the look of the page's own button */
  readonly ctaClass = input.required<string>();
  readonly bg = input.required<string>();
  readonly fg = input.required<string>();

  private readonly kind: 'android' | 'ios' | 'windows' | 'other' = this.install.androidDevice ? 'android' : this.install.ios ? 'ios' : this.install.windows ? 'windows' : 'other';
  protected readonly installPage = `/install/${this.kind === 'android' ? 'android' : this.kind === 'ios' ? 'iphone' : 'windows'}`;
  protected readonly installLabel = this.kind === 'android' ? tr('core.getTheAndroidApp', 'Get the Android app') : this.kind === 'ios' ? tr('core.addItToYour', 'Add it to your home screen') : tr('core.installItOnYour', 'Install it on your computer');
  protected readonly note =
    this.kind === 'android'
      ? tr('core.theAppGivesYou', 'The app gives you alerts and sounds.')
      : this.kind === 'ios'
        ? 'iPhone needs the home-screen app for alerts.'
        : this.kind === 'windows'
          ? tr('core.opensInItsOwn', 'Opens in its own window, with alerts.')
          : tr('core.chromeAndEdgeOffer', 'Chrome and Edge offer an install button in the address bar.');

  /** opens a page; an app that has no circle yet is bound to this page's circle first (and starts again on that page) */
  protected open(path: string): void {
    if (this.active.bindIfFree(this.circle(), path)) return;
    void this.router.navigateByUrl(path);
  }

  protected signIn(): void {
    this.welcome.continueInBrowser();
    this.open('/login');
  }
}
