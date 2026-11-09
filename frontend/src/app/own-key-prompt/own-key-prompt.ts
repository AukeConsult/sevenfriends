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
          } @else {
            <span class="sf-own-key-note">{{ tr('core.wasThisYouAllow', 'Was this you? Allow it to open your old messages and files.') }}</span>
          }
        </div>
        @if (!working()) {
          <div class="sf-own-key-actions">
            <button type="button" class="btn btn-primary btn-sm" (click)="allow()">{{ tr('core.allow', 'Allow') }}</button>
            <button type="button" class="btn btn-outline-secondary btn-sm" (click)="hide()">{{ tr('core.notNow', 'Not now') }}</button>
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
      this.message.set(result.skipped ? tr('core.couldNotBeOpened', '{{ skipped }} could not be opened on this device, so the new key is not complete yet. Try again on the device where that key lives.', { skipped: result.skipped }) : null);
      if (result.skipped) this.hidden.set(false);
    } catch (err: any) {
      this.message.set(err.message ?? tr('core.thatDidNotWork', 'That did not work. Try again.'));
    } finally {
      this.working.set(false);
    }
  }

  protected hide(): void {
    this.hidden.set(true);
  }
}
