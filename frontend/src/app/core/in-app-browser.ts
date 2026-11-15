import { InjectionToken } from '@angular/core';
import { Capacitor } from '@capacitor/core';

/**
 * The lock key of a person is made and kept in the storage of the browser the account was made in. So an account must be made, and signed in to, in the browser that is
 * right for the device, and in that browser only:
 *   iPhone / iPad: Safari (or the app on the home screen, which is Safari),
 *   Android: Chrome (or the Android app of Seven Friends),
 *   Windows and the rest: a real browser (or the Windows app of Seven Friends), never the built-in browser of another app.
 * The built-in browser of another app (Messenger, Facebook, Instagram ...) is none of them: it has its own storage, which is not the one of Safari or Chrome, so a key made
 * there would be lost and the messages could not be opened. Another browser on the phone (Chrome on an iPhone, Firefox or Samsung Internet on Android) has its own storage too.
 */
export type RequiredBrowser = 'safari' | 'chrome' | 'browser';

export interface BrowserEnv {
  /** this is the Android app of Seven Friends (Capacitor) */
  native: boolean;
  /** the page runs as an app on the home screen (iPhone) or an installed app */
  standalone: boolean;
  /** the device has a touch screen (an iPad says it is a Mac) */
  touchMac: boolean;
}

/**
 * The chat and social apps with their own built-in browser: a link opened from a chat runs in there. Named here, for a computer (where nothing else tells) and as a second
 * check. On an iPhone and on Android every such browser is caught without a name (see `requiredBrowser`: no "Safari" in its identity, or an Android web view), so WhatsApp,
 * Telegram, Signal, Viber, Slack, Gmail, Outlook and the rest are covered too.
 */
const IN_APP = /\bFBAN\b|\bFBAV\b|FB_IAB|FBIOS|Messenger|Instagram|\bLine\/|MicroMessenger|Snapchat|TikTok|musical_ly|BytedanceWebview|Twitter|LinkedInApp|Pinterest|WhatsApp|Telegram|\bViber|\bSlack|Discord|\bTeams\/|Outlook|Electron\/|KAKAOTALK|NAVER\(inapp/i;

/** A computer's page that says it is one of the real browsers (Chrome, Edge, Firefox, Safari, Opera, Vivaldi ...). Anything else (an unknown program with a web view) is not a browser. */
const REAL_BROWSER = /(Chrome|Chromium|Firefox|Safari|Edg|OPR|Vivaldi)\//i;

export function inAppBrowser(userAgent: string): boolean {
  return IN_APP.test(userAgent);
}

/**
 * Which browser the person MUST use, or null when this one is the right one. The apps of Seven Friends themselves (Android: Capacitor; Windows: the window adds
 * `SevenFriendsWindows` to its browser identity) are always fine.
 */
export function requiredBrowser(ua: string, env: BrowserEnv): RequiredBrowser | null {
  if (env.native || /SevenFriendsWindows/i.test(ua)) return null;
  const inApp = IN_APP.test(ua);
  const ios = /iphone|ipad|ipod/i.test(ua) || (/Macintosh/i.test(ua) && env.touchMac);
  if (ios) {
    if (env.standalone && !inApp) return null; // the app on the home screen (it has no "Safari" in its identity, but it is Safari)
    const safari = /Safari\//.test(ua) && !/CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|GSA\/|DuckDuckGo|YaBrowser|UCBrowser/i.test(ua);
    return safari && !inApp ? null : 'safari';
  }
  if (/android/i.test(ua)) {
    const chrome = /Chrome\//.test(ua) && !/; wv\)|EdgA|OPR\/|SamsungBrowser|Firefox|UCBrowser|YaBrowser|DuckDuckGo|Vivaldi/i.test(ua);
    return chrome && !inApp ? null : 'chrome';
  }
  // Windows, Mac, Linux: a real browser, and not a program with a web view
  return !inApp && REAL_BROWSER.test(ua) ? null : 'browser';
}

/** The browser this device must use, or null (a token, so a test can say it is Messenger on an iPhone). */
export const REQUIRED_BROWSER = new InjectionToken<RequiredBrowser | null>('REQUIRED_BROWSER', {
  factory: () =>
    requiredBrowser(navigator.userAgent, {
      native: Capacitor.isNativePlatform(),
      standalone: (navigator as { standalone?: boolean }).standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches),
      touchMac: navigator.maxTouchPoints > 1,
    }),
});
