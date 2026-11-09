import { Capacitor } from '@capacitor/core';
import { tr } from './i18n';

/** What kind of Seven Friends this is: the Android app, the iPhone app, the Windows app, or a browser. */
function kindOf(ua: string): string {
  const platform = Capacitor.getPlatform();
  if (platform === 'android' || (window as unknown as { SevenFriendsAndroid?: unknown }).SevenFriendsAndroid) return tr('core.androidApp', 'Android app');
  if (platform === 'ios') return tr('core.iphoneApp', 'iPhone app');
  if (/SevenFriendsWindows/i.test(ua)) return tr('core.windowsApp', 'Windows app');
  if (installedWebApp()) return tr('core.browserApp', 'Browser app');
  return tr('core.browser', 'Browser');
}

/** The web app installed from the browser ("Add to home screen" / "Install"): it opens in its own window without the browser's bars. */
function installedWebApp(): boolean {
  try {
    return window.matchMedia('(display-mode: standalone)').matches || window.matchMedia('(display-mode: fullscreen)').matches || (navigator as unknown as { standalone?: boolean }).standalone === true;
  } catch {
    return false;
  }
}

/** The name the owner gave the device: asked of the Android app, or sent by the Windows app in its user agent ("SevenFriendsDevice/<name>"). '' = none. */
function ownName(ua: string, androidName?: () => string): string {
  try {
    const android = androidName?.() ?? '';
    if (android) return android;
    const windows = /SevenFriendsDevice\/(\S+)/.exec(ua)?.[1];
    return windows ? decodeURIComponent(windows) : '';
  } catch {
    return '';
  }
}

/** "Leif's Pixel (Google Pixel 8)", or just the device when it has no name of its own (or the name says the same). */
function named(system: string, name: string): string {
  return name && name.toLowerCase() !== system.toLowerCase() ? `${name} (${system})` : system;
}

/** The device: its model when the system tells it (Android), else the system, and for a browser also which browser ("Chrome on Windows"). */
function deviceOf(ua: string, inApp: boolean): string {
  const touchMac = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1; // iPadOS says it is a Mac
  let system = 'device';
  const bridge = (window as unknown as { SevenFriendsAndroid?: { deviceModel?: () => string; deviceName?: () => string } }).SevenFriendsAndroid;
  const ask = (get?: () => string): string => { try { return get?.() ?? ''; } catch { return ''; } };
  const model = ask(bridge?.deviceModel?.bind(bridge)); // the Android app tells its phone (the browser hides the model)
  if (model) system = model;
  else if (/Android/i.test(ua)) {
    const model = /Android [\d.]+; ([^;)]+)/.exec(ua)?.[1]?.trim();
    system = model && model !== 'K' && !/^Android/i.test(model) ? model : 'Android';
  } else if (/iPhone|iPod/i.test(ua)) system = 'iPhone';
  else if (/iPad/i.test(ua) || touchMac) system = 'iPad';
  else if (/Windows/i.test(ua)) system = 'Windows';
  else if (/CrOS/i.test(ua)) system = 'ChromeOS';
  else if (/Mac OS X|Macintosh/i.test(ua)) system = 'Mac';
  else if (/Linux|X11/i.test(ua)) system = 'Linux';
  if (inApp) return named(system, ownName(ua, bridge?.deviceName?.bind(bridge)));
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /SamsungBrowser/.test(ua) ? 'Samsung Internet' : /Firefox\/|FxiOS/.test(ua) ? 'Firefox' : /Chrome\/|CriOS/.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : '';
  return browser ? tr('core.browserOnDevice', '{{ browser }} on {{ device }}', { browser, device: system }) : system;
}

/** A name for this device in the list of keys: the kind and the device, like "Browser · Chrome on Windows" or "Android app · SM-S918B" (at most 60 characters). */
export function deviceLabel(): string {
  const ua = navigator.userAgent;
  const kind = kindOf(ua);
  const inApp = kind !== tr('core.browser', 'Browser') && kind !== tr('core.browserApp', 'Browser app');
  return `${kind} · ${deviceOf(ua, inApp)}`.slice(0, 60);
}
