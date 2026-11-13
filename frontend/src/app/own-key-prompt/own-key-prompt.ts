import { Component, effect, inject, signal, untracked } from '@angular/core';
import { AuthService } from '../core/auth.service';
import { OwnRecoveryService } from '../core/own-recovery.service';
import { tr } from '../core/i18n';

const ASK_AGAIN_MS = 5 * 60 * 1000;

/**
 * "A new key was added to your account": shown on a device whose key can open everything. One tap on Allow and this device gives the new key its copies
 * (for every friend at once); the new key can then open the old messages and files. "Not now" hides it until the app is opened again.
 */
@Component({
  selector: 'app-own-key-prompt',
  template: `
    @if (open() && next(); as key) {
      <div class="sf-own-key" role="status">
        <div>
          <strong>{{ tr('core.aNewKeyWas', 'A new key was added to your account') }}</strong>
          <span class="sf-own-key-code">{{ label(key.label, key.fingerprint) }}</span>
          @if (working()) {
            <span class="sf-own-key-note">{{ tr('core.givingItAccessDone', 'Giving it access… ' + (done()) + ' done. Stay in the app.', { done: done() }) }}</span>
          } @else if (message()) {
            <span class="sf-own-key-note">{{ message() }}</span>
          } @else if (confirming()) {
            <span class="sf-own-key-note">{{ tr('core.removeThisKeyNotYou', 'Remove this key? Then that device can no longer open your messages. If it was not you, also change your login.') }}</span>
          } @else {
            <span class="sf-own-key-note">{{ tr('core.wasThisYouAllow', 'Was this you? Approve it: it can then open your old messages and files, and your friends will lock new messages for it too. Your friends do not have to approve anything.') }}</span>
          }
        </div>
        @if (!working()) {
          <div class="sf-own-key-actions">
            @if (confirming()) {
              <button type="button" class="btn btn-danger btn-sm" (click)="notMe()">{{ tr('core.removeIt', 'Remove it') }}</button>
              <button type="button" class="btn btn-outline-secondary btn-sm" (click)="confirming.set(false)">{{ tr('core.cancel', 'Cancel') }}</button>
            } @else {
              <button type="button" class="btn btn-primary btn-sm" (click)="allow()">{{ tr('core.allow', 'Approve') }}</button>
              <button type="button" class="btn btn-outline-secondary btn-sm" (click)="confirming.set(true)">{{ tr('core.notMe', 'Not me') }}</button>
              <button type="button" class="btn btn-outline-secondary btn-sm" (click)="hide()">{{ tr('core.notNow', 'Not now') }}</button>
            }
          </div>
        }
      </div>
    }
  `,
})
export class OwnKeyPrompt {
  protected readonly tr = tr;
  private readonly service = inject(OwnRecoveryService);
  private readonly auth = inject(AuthService);
  protected readonly hidden = signal(false);
  /** "Not me" asks once more before the key is removed (a frame in the card, no pop-up) */
  protected readonly confirming = signal(false);
  protected readonly working = signal(false);
  protected readonly done = signal(0);
  protected readonly message = signal<string | null>(null);
  protected readonly next = () => this.service.waiting()[0] ?? null;
  protected readonly open = () => !this.hidden() && this.service.waiting().length > 0;

  constructor() {
    effect((onCleanup) => {
      if (!this.auth.user()) return;
      untracked(() => void this.service.check());
      const ask = () => void this.service.check();
      const timer = setInterval(ask, ASK_AGAIN_MS);
      window.addEventListener('focus', ask); // coming back to the app: a key may have been added meanwhile
      onCleanup(() => {
        clearInterval(timer);
        window.removeEventListener('focus', ask);
      });
    });
  }

  protected label(label: string, fingerprint: string): string {
    const code = fingerprint.slice(0, 8).replace(/(.{4})/, '$1 ').toUpperCase();
    return label ? `${label} · ${code}` : code;
  }

  protected async allow(): Promise<void> {
    const key = this.next();
    if (!key || this.working()) return;
    this.working.set(true);
    this.done.set(0);
    this.message.set(null);
    try {
      const result = await this.service.allow(key, (n) => this.done.set(n));
      this.message.set(result.skipped ? tr('core.couldNotBeOpened', '{{ skipped }} could not be opened on this device, so the new key is not complete yet. Try again on the device where that key lives.', { skipped: result.skipped }) : result.listed ? null : tr('core.notInListYet', 'The new key can open your old messages, but this device could not add it to your signed list, so it cannot send yet.'));
      if (result.skipped || !result.listed) this.hidden.set(false);
    } catch (err: any) {
      this.message.set(err.message ?? tr('core.thatDidNotWork', 'That did not work. Try again.'));
    } finally {
      this.working.set(false);
    }
  }

  /** The key that asked is not mine: it is removed, and the device that asked is told. */
  protected async notMe(): Promise<void> {
    const key = this.next();
    if (!key || this.working()) return;
    try {
      await this.service.notMe(key);
    } catch (err: any) {
      this.message.set(err.message ?? tr('core.thatDidNotWork', 'That did not work. Try again.'));
    } finally {
      this.confirming.set(false);
    }
  }

  protected hide(): void {
    this.hidden.set(true);
  }
}
