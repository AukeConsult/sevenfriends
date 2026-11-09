import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Capacitor } from '@capacitor/core';
import { environment } from '../../environments/environment';
import { ActiveCircleService } from './active-circle.service';
import { ApiService } from './api.service';
import { APP_KIND } from './app-kind';
import { AuthService } from './auth.service';
import { DesktopNoticeService } from './desktop-notice.service';
import { tr } from './i18n';

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
  private readonly active = inject(ActiveCircleService);

  /**
   * true inside the Android app (Capacitor): there push goes through the phone's own Firebase service
   * (`@capacitor/push-notifications` + the native service in the android project), not through the browser
   */
  private readonly native = Capacitor.isNativePlatform();

  /** push is set up in this build (a key exists and this is not the local demo project; the Android app needs no key) */
  readonly configured = this.native || (Boolean(environment.vapidKey) && !environment.useEmulators);

  /** this browser can do push at all (iPhone: only from the Home Screen app) */
  readonly supported = signal(false);

  /** push is on for this device */
  readonly enabled = signal(false);

  /** the first look at what this browser can do is done (before that, `enabled` is not known yet) */
  readonly checked = signal(false);

  /** why turning it on did not work */
  readonly problem = signal<string | null>(null);

  constructor() {
    void this.checkSupport();
    // the person changes circle: the server is told, so a push about another circle says only "Activity in ..." on this device (see sendPush)
    this.active.onSwitch((id) => {
      const token = this.read(TOKEN_KEY);
      if (token && this.enabled() && this.auth.user()) {
        void this.api.request<void>('/push/devices/circle', { method: 'PUT', body: JSON.stringify({ token, circle: id }) }).catch(() => undefined);
      }
    });
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
      if (this.native) {
        const { PushNotifications } = await import('@capacitor/push-notifications');
        const permission = await PushNotifications.checkPermissions();
        this.supported.set(true);
        this.enabled.set(this.read(ENABLED_KEY) === 'on' && permission.receive === 'granted');
        return;
      }
      const { isSupported } = await import('firebase/messaging');
      this.supported.set(this.configured && (await isSupported()));
      this.enabled.set(this.supported() && this.read(ENABLED_KEY) === 'on' && Notification.permission === 'granted');
    } catch {
      this.supported.set(false);
    } finally {
      this.checked.set(true);
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
        this.problem.set(this.configured ? tr('core.thisBrowserCannotReceive', 'This browser cannot receive push notifications. On iPhone, add the app to the Home Screen first.') : tr('core.pushNotificationsOnlyWork', 'Push notifications only work on the deployed site, not in the local setup.'));
        return false;
      }
      if (this.native) {
        if (!(await this.allowNative())) {
          this.problem.set(tr('core.notificationsAreBlockedFor', 'Notifications are blocked for the app. Allow them in the phone settings (Apps, Seven Friends, Notifications), then try again.'));
          return false;
        }
      } else {
        if (Notification.permission === 'default') await Notification.requestPermission();
        if (Notification.permission !== 'granted') {
          this.problem.set(tr('core.notificationsAreBlockedFor2', 'Notifications are blocked for this site. Allow them in the browser settings, then try again.'));
          return false;
        }
      }
      await this.refresh();
      this.write(ENABLED_KEY, 'on');
      this.enabled.set(true);
      return true;
    } catch (error) {
      this.problem.set((error as Error).message || tr('core.couldNotTurnPush', 'Could not turn push on. Please try again.'));
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
    if (!token) throw new Error(tr('core.thisBrowserDidNot', 'This browser did not give a push token.'));
    await this.api.request<void>('/push/devices', { method: 'POST', body: JSON.stringify({ token, app: APP_KIND, circle: this.active.id }) });
    this.write(TOKEN_KEY, token);
  }

  private async unregister(): Promise<void> {
    const token = this.read(TOKEN_KEY);
    if (token && this.auth.user()) {
      await this.api.request<void>('/push/devices', { method: 'DELETE', body: JSON.stringify({ token }) }).catch(() => undefined);
    }
    this.write(TOKEN_KEY, '');
  }

  /** Android app: asks for the notification permission (Android 13 and newer show a prompt). */
  private async allowNative(): Promise<boolean> {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    let permission = await PushNotifications.checkPermissions();
    if (permission.receive === 'prompt' || permission.receive === 'prompt-with-rationale') {
      permission = await PushNotifications.requestPermissions();
    }
    return permission.receive === 'granted';
  }

  /** Android app: the phone's Firebase token (the same kind of token the backend already sends to). */
  private async nativeToken(): Promise<string | null> {
    const { PushNotifications } = await import('@capacitor/push-notifications');
    const handles: { remove: () => Promise<void> }[] = [];
    try {
      return await new Promise<string | null>((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error(tr('core.thePhoneDidNot', 'The phone did not give a push token. Check the internet connection and try again.'))), 20000);
        const done = (fn: () => void) => {
          clearTimeout(timer);
          fn();
        };
        void (async () => {
          handles.push(await PushNotifications.addListener('registration', (token) => done(() => resolve(token.value))));
          handles.push(await PushNotifications.addListener('registrationError', (e) => done(() => reject(new Error(e.error || tr('core.thePhoneCouldNot', 'The phone could not register for push.'))))));
          await PushNotifications.register();
        })().catch((error) => done(() => reject(error)));
      });
    } finally {
      for (const handle of handles) void handle.remove();
    }
  }

  private async currentToken(): Promise<string | null> {
    if (this.native) return this.nativeToken();
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
