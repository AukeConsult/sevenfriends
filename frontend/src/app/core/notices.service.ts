import { inject, Injectable, signal } from '@angular/core';
import { NoticePreferences, Preferences } from '../models';
import { ApiService } from './api.service';
import { tr } from './i18n';

/** Which pushes the person gets and what they show: saved on the account (`/preferences/notices`), so it holds for every device. */
@Injectable({ providedIn: 'root' })
export class NoticesService {
  private readonly api = inject(ApiService);
  /** null = not loaded yet */
  readonly notices = signal<NoticePreferences | null>(null);
  readonly problem = signal<string | null>(null);

  /** Reads the choices from the account. */
  async load(): Promise<boolean> {
    try {
      this.notices.set((await this.api.request<Preferences>('/preferences')).notices);
      return true;
    } catch {
      this.problem.set(tr('core.yourNotificationChoicesCould', 'Your notification choices could not be loaded. Check the connection and open this page again.'));
      return false;
    }
  }

  /** Sends a real push to all my devices through the server; says in words how many it reached. */
  async testPush(): Promise<string> {
    try {
      const { devices, delivered } = await this.api.request<{ devices: number; delivered: number }>('/push/test', { method: 'POST' });
      return devices === 0
        ? tr('core.noDeviceIsSet', 'No device is set up for notifications yet. Turn on "Notify this device" on the device you want to test.')
        : delivered === devices
          ? `Sent to ${devices === 1 ? 'your device' : `all ${devices} of your devices`}. It should arrive in a moment, also when the app is closed.`
          : tr('core.sentButOnlyOf', 'Sent, but only {{ delivered }} of {{ devices }} devices were reached. A device that cannot be reached any more is removed from the list.', { delivered, devices });
    } catch {
      return tr('core.theTestCouldNot', 'The test could not be sent. Check the connection and try again.');
    }
  }

  /** Shows the choices at once and saves them; if saving fails they go back. */
  async save(next: NoticePreferences): Promise<boolean> {
    const before = this.notices();
    this.notices.set(next);
    this.problem.set(null);
    try {
      await this.api.request('/preferences/notices', { method: 'PUT', body: JSON.stringify(next) });
      return true;
    } catch {
      this.notices.set(before);
      this.problem.set(tr('core.thatChoiceCouldNot', 'That choice could not be saved. Try again.'));
      return false;
    }
  }
}
