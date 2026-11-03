import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { environment } from '../../environments/environment';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { DesktopNoticeService } from './desktop-notice.service';

const ENABLED_KEY = 'sf-push';
const TOKEN_KEY = 'sf-push-token';

/**
 * Push notifications for THIS device (phone, computer): the system's own notification system wakes the device when a
 * message, friend request or answer arrives, also when the app is closed or the screen is locked (Firebase Cloud
 * Messaging; the backend sends, `public/firebase-messaging-sw.js` shows).
 *
 * The person turns it on in Settings (per device): the browser asks for permission, the device gets a push token and
 * the token is registered with the backend. It is removed again when the switch is turned off and when the person logs
 * out, so the next person on the same phone does not get somebody else's pushes. Needs the deployed https site (not
 * the emulator setup) and, on iPhone, the app added to the Home Screen.
 */
@Injectable({ providedIn: 'root' })
export class PushService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly desktop = inject(DesktopNoticeService);

  /** push is set up in this build (a key exists and this is not the local demo project) */
  readonly configured = Boolean(environment.vapidKey) && !environment.useEmulators;

  /** this browser can do push at all (iPhone: only from the Home Screen app) */
  readonly supported = signal(false);

  /** push is on for this device */
  readonly enabled = signal(false);

  /** why turning it on did not work */
  readonly problem = signal<string | null>(null);

  constructor() {
    void this.checkSupport();
    // signed in again with push on: make sure this device is registered for the person who is signed in now
    effect(() => {
      const user = this.auth.user();
      untracked(() => {
        if (user && this.enabled()) void this.refresh();
      });
    });
  }

  private async checkSupport(): Promise<void> {
    try {
      const { isSupported } = await import('firebase/messaging');
      this.supported.set(this.configured && (await isSupported()));
      this.enabled.set(this.supported() && this.read(ENABLED_KEY) === 'on' && Notification.permission === 'granted');
    } catch {
      this.supported.set(false);
    }
  }

  /** Switch push on or off for this device. Returns whether push is on afterwards. */
  async setEnabled(on: boolean): Promise<boolean> {
    this.problem.set(null);
    try {
      if (!on) {
        await this.unregister();
        this.write(ENABLED_KEY, 'off');
        this.enabled.set(false);
        return false;
      }
      if (!this.supported()) {
        this.problem.set(this.configured ? 'This browser cannot receive push notifications. On iPhone, add the app to the Home Screen first.' : 'Push notifications only work on the deployed site, not in the local setup.');
        return false;
      }
      if (Notification.permission === 'default') await Notification.requestPermission();
      if (Notification.permission !== 'granted') {
        this.problem.set('Notifications are blocked for this site. Allow them in the browser settings, then try again.');
        return false;
      }
      await this.refresh();
      this.write(ENABLED_KEY, 'on');
      this.enabled.set(true);
      return true;
    } catch (error) {
      this.problem.set((error as Error).message || 'Could not turn push on. Please try again.');
      return false;
    }
  }

  /** Called before logging out: this device stops receiving the signed-in person's pushes. */
  async forgetDevice(): Promise<void> {
    try {
      await this.unregister();
    } catch {
      /* the next login registers again if push is still on */
    }
    this.write(ENABLED_KEY, 'off');
    this.enabled.set(false);
  }

  /** Gets the device's push token (it can change) and registers it for the signed-in person. */
  private async refresh(): Promise<void> {
    const token = await this.currentToken();
    if (!token) throw new Error('This browser did not give a push token.');
    await this.api.request<void>('/push/devices', { method: 'POST', body: JSON.stringify({ token }) });
    this.write(TOKEN_KEY, token);
  }

  private async unregister(): Promise<void> {
    const token = this.read(TOKEN_KEY);
    if (token && this.auth.user()) {
      await this.api.request<void>('/push/devices', { method: 'DELETE', body: JSON.stringify({ token }) }).catch(() => undefined);
    }
    this.write(TOKEN_KEY, '');
  }

  private async currentToken(): Promise<string | null> {
    const [{ getMessaging, getToken }, { firebaseApp }] = await Promise.all([import('firebase/messaging'), import('./firebase')]);
    const registration = await this.desktop.registerWorker();
    if (!registration) return null;
    return getToken(getMessaging(firebaseApp), { vapidKey: environment.vapidKey, serviceWorkerRegistration: registration });
  }

  private read(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch {
      return null;
    }
  }

  private write(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch {
      /* private mode: the choice lasts until the page is closed */
    }
  }
}
