import { Injectable, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import { ActiveCircleService } from './active-circle.service';
import { tr } from './i18n';

const STORAGE_KEY = 'sf-desktop-notices';
const WORKER_URL = '/firebase-messaging-sw.js'; // the one service worker of the app (push + notification clicks)

export interface DesktopNotice {
  title: string;
  body: string;
  /**
   * The unique id of the EVENT this notice is about (the id of the message, of the friend request, of the answer):
   * it is the notification's id in the system, and an event is announced once, however often it is reported.
   */
  id: string;
  /** true when the app plays its own sound, so the system does not add a second one */
  silent: boolean;
  /** the page a click on the notice opens */
  go: string;
}

/**
 * Desktop notifications: the operating system's own notification (on Windows in the corner of the screen and in
 * the notification centre), outside the browser window, with the sender and the message. Shown when Seven Friends
 * is open but the person is not looking at it. Clicking it brings the tab to the front and opens the right page.
 *
 * They are shown through the app's service worker (`public/firebase-messaging-sw.js`), which browsers (Chrome, Edge)
 * handle more reliably than a notification made directly by the page; without a service worker the page makes it itself.
 * It needs the person's permission (asked when the switch on Settings is turned on). The switch and the permission
 * are per browser and per device: Chrome and Edge each need to be set up. A closed app can not show anything.
 */
@Injectable({ providedIn: 'root' })
export class DesktopNoticeService {
  private readonly router = inject(Router);
  private readonly active = inject(ActiveCircleService);

  readonly supported = typeof Notification !== 'undefined';

  /** the browser's answer: 'default' = not asked yet */
  readonly permission = signal<NotificationPermission>(this.supported ? Notification.permission : 'denied');

  /** the person's switch on the Settings page (only works with permission) */
  readonly wanted = signal(this.read());

  /** What happened the last time a notice was due (shown on Settings, to find out why nothing appeared). */
  readonly lastResult = signal<string>(tr('core.nothingYet', 'Nothing yet'));

  private worker: ServiceWorkerRegistration | null = null;
  /** ids of the events already announced */
  private readonly announced = new Set<string>();

  constructor() {
    if ('serviceWorker' in navigator) {
      // a click on a notice: the worker brings the tab to the front and tells it where to go
      navigator.serviceWorker.addEventListener('message', (event) => {
        if (event.data?.type === 'open' && typeof event.data.url === 'string') void this.router.navigateByUrl(event.data.url);
        // a push while the app is in front: the page shows it itself for its own circle; one about ANOTHER circle is shown here as a notification
        const push = event.data?.type === 'push' ? (event.data.data as { id: string; title?: string; body?: string; url?: string; circle?: string; silent?: string } | undefined) : undefined;
        if (push?.title && push.circle && push.circle !== this.active.type) {
          void this.show({ id: push.id, title: push.title, body: push.body ?? '', go: push.url ?? '/', silent: push.silent === '1' }, true);
        }
      });
    }
    if (this.wanted()) void this.registerWorker();
  }

  /** Turns the switch on or off; turning on asks for permission. Returns whether notices will now be shown. */
  async setWanted(on: boolean): Promise<boolean> {
    if (on && this.supported && Notification.permission === 'default') {
      this.permission.set(await Notification.requestPermission());
    }
    const allowed = on && this.supported && Notification.permission === 'granted';
    this.permission.set(this.supported ? Notification.permission : 'denied');
    this.wanted.set(allowed);
    try {
      localStorage.setItem(STORAGE_KEY, allowed ? 'on' : 'off');
    } catch {
      /* private mode: the choice lasts until the page is closed */
    }
    if (allowed) await this.registerWorker();
    return allowed;
  }

  /** Shows a notice when the person is not looking at the app (or always, with `force`). */
  async show(notice: DesktopNotice, force = false): Promise<void> {
    if (!this.supported || !this.wanted() || Notification.permission !== 'granted') {
      this.lastResult.set(tr('core.notShownNotificationsAre', 'Not shown: notifications are switched off or not allowed in this browser'));
      return;
    }
    // not while the person is looking at the app: the tab is in view AND its window is in front
    if (!force && document.visibilityState === 'visible' && document.hasFocus()) {
      this.lastResult.set(tr('core.notShownYouWere', 'Not shown: you were looking at the app'));
      return;
    }
    if (this.announced.has(notice.id)) {
      this.lastResult.set(tr('core.notShownAgainThis', 'Not shown again: this event was announced already'));
      return;
    }
    this.announced.add(notice.id);
    // the event's own id is the notification's tag: different events never replace each other, and the same event never shows twice
    const options = {
      body: notice.body,
      tag: notice.id,
      silent: notice.silent,
      data: { url: notice.go },
    };
    try {
      const worker = this.worker ?? (await this.registerWorker());
      if (worker) {
        await worker.showNotification(notice.title, options);
        this.lastResult.set(tr('core.shownThroughTheService', 'Shown through the service worker ({{ toLocaleTimeString }})', { toLocaleTimeString: new Date().toLocaleTimeString() }));
        return;
      }
      const shown = new Notification(notice.title, options);
      shown.onclick = () => {
        window.focus();
        shown.close();
        void this.router.navigateByUrl(notice.go);
      };
      this.lastResult.set(tr('core.shownByThePage', 'Shown by the page ({{ toLocaleTimeString }})', { toLocaleTimeString: new Date().toLocaleTimeString() }));
    } catch (error) {
      this.lastResult.set(tr('core.theBrowserRefusedThe', 'The browser refused the notification: {{ ErrorMessage }}', { ErrorMessage: (error as Error).message }));
    }
  }

  /** Starts the app's service worker (once). Also used by push. Null when the browser has none. */
  async registerWorker(): Promise<ServiceWorkerRegistration | null> {
    if (this.worker) return this.worker;
    if (!('serviceWorker' in navigator)) return null;
    try {
      await navigator.serviceWorker.register(WORKER_URL);
      this.worker = await navigator.serviceWorker.ready;
      return this.worker;
    } catch (error) {
      console.warn('Could not start the notification service worker:', error);
      return null;
    }
  }

  private read(): boolean {
    try {
      return localStorage.getItem(STORAGE_KEY) === 'on' && this.supported && Notification.permission === 'granted';
    } catch {
      return false;
    }
  }
}
