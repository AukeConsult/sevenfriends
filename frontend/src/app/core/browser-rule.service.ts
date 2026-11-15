import { Injectable, computed, inject } from '@angular/core';
import { REQUIRED_BROWSER } from './in-app-browser';
import { UiPreferencesService } from './ui-preferences';

/**
 * Is this place the wrong one to make an account in (see `requiredBrowser`)? Almost always yes when a browser is required. The one exception: on an iPhone in a Safari TAB the person
 * may choose "Continue in Safari instead" of installing the app first. Safari then makes the account and the key like any browser (the app on the home screen is added later and its key
 * approved from Safari, see the Home notes); the choice is kept on this device. The apps themselves, Android's Chrome and a Windows browser never need it.
 */
@Injectable({ providedIn: 'root' })
export class BrowserRuleService {
  private readonly prefs = inject(UiPreferencesService);
  /** the browser this device must use, or null (the right one) */
  readonly need = inject(REQUIRED_BROWSER);
  private readonly chose = this.prefs.value('iosSafariOk');
  /** the wrong place: nothing to sign in with, no key made (the page for the right browser is shown instead) */
  readonly blocking = computed(() => this.need !== null && !(this.need === 'home-screen' && this.chose()));

  /** The person goes on in Safari (an iPhone, a Safari tab). */
  continueInSafari(): void {
    this.prefs.set('iosSafariOk', true);
  }
}
