import { Injectable, signal } from '@angular/core';
import { Capacitor } from '@capacitor/core';

/** The browser's install offer (Chrome / Edge on Android and desktop); not in the standard TypeScript types. */
interface InstallPrompt extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

/**
 * Putting the app on the phone: the browser decides when the app can be installed (https, manifest, service worker) and
 * hands over an install offer; it can only be shown after a tap, so the Profile page has a button for it. An installed
 * app gets its icon in the app menu and opens full screen. iPhones have no such offer: there the person uses
 * Share → Add to Home Screen themselves, so the page explains that. On a computer an installed app can also start when
 * the person signs in; that is a setting of the browser (the page cannot switch it on), so the page explains where it is.
 */
@Injectable({ providedIn: 'root' })
export class InstallService {
  /** the browser has an install offer ready: the button works */
  readonly canInstall = signal(false);
  /** this is the Android app (Capacitor): there is nothing to install, and the browser-only parts of the pages are hidden */
  readonly native = Capacitor.isNativePlatform();
  /** this window is the Windows app (it adds its name to the browser identity, see windows/MainWindow.xaml.cs) */
  readonly windowsApp = /SevenFriendsWindows/i.test(navigator.userAgent);
  /** this window is the installed app (a browser tab is never "installed", so the install can always be done again); the Android app always is */
  readonly installed = signal(this.native || this.windowsApp || this.isStandalone());
  /** an iPhone / iPad: installing is a manual step in Safari */
  // an iPad in its default settings says it is a Mac: a Mac with a touch screen is an iPad
  readonly ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);
  /** a phone or tablet (Android or iOS): there is no start-at-sign-in setting there, the apps are opened from the app menu */
  readonly mobile = this.ios || /android/i.test(navigator.userAgent);

  /** a Windows computer (the Windows app can be downloaded) */
  readonly windows = /Windows NT/i.test(navigator.userAgent) && !this.mobile;
  /** an Android phone or tablet (the Android app file can be downloaded) */
  readonly androidDevice = /android/i.test(navigator.userAgent);

  private offer: InstallPrompt | null = null;

  constructor() {
    // Only a window that IS the installed app counts as installed. Chrome on Android can keep saying "installed" after the icon was removed, so a browser tab always offers the install again.
    const early = (window as { __sfInstallOffer?: Event }).__sfInstallOffer; // arrived before the app started (see index.html)
    if (early) {
      this.offer = early as InstallPrompt;
      this.canInstall.set(true);
    }
    window.addEventListener('beforeinstallprompt', (event) => {
      event.preventDefault(); // keep the offer for the button
      this.offer = event as InstallPrompt;
      this.canInstall.set(true);
    });
    window.addEventListener('appinstalled', () => {
      this.offer = null;
      this.canInstall.set(false);
      this.installed.set(true);
    });
  }

  /** Shows the browser's install dialog. */
  async install(): Promise<void> {
    const offer = this.offer;
    if (!offer) return;
    this.offer = null; // an offer can be used once
    this.canInstall.set(false);
    await offer.prompt();
    await offer.userChoice.catch(() => undefined);
  }

  /**
   * This window is an app with a storage of its own, apart from the browser the person signed up in: the Android app, the Windows app, and a phone's
   * home-screen app. A key, a notification permission or a microphone permission made in the browser is NOT here, so this device has to be set up again.
   */
  get separateApp(): boolean {
    return this.native || this.windowsApp || (this.mobile && this.installed());
  }

  /** this window IS the installed app (not a browser tab) */
  runsAsApp(): boolean {
    return this.isStandalone();
  }

  private isStandalone(): boolean {
    return matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;
  }
}
