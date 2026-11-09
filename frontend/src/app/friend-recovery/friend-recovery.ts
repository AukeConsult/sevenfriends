import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { RouterLink } from '@angular/router';
import { RecoveryState, readableFingerprint } from '../models';
import { RecoveryService } from '../core/recovery.service';
import { FriendContext } from '../friend-page/friend-context';

const POLL_MS = 2500;

/**
 * Recovery with one friend (`/friends/:id/recovery`, from the menu of the friend page): after a new key the old messages and files are locked for the old one.
 * The friend's app can lock them again for the new key. This page explains it, asks the friend, shows how far it is, and stays until it is finished.
 * The same page is what the friend sees: the request with the code of the new key to check, and the work with its progress.
 */
@Component({
  selector: 'app-friend-recovery',
  imports: [RouterLink, TranslocoDirective],
  templateUrl: './friend-recovery.html',
  providers: [provideTranslocoScope('friendRecovery')],
})
export class FriendRecovery {
  protected readonly ctx = inject(FriendContext);
  private readonly service = inject(RecoveryService);

  protected readonly friendName = this.ctx.friendName;
  protected readonly state = signal<RecoveryState | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  /** the helper's app is working now (it must stay on this page) */
  protected readonly running = signal(false);
  protected readonly doneNow = signal(0);
  protected readonly skipped = signal(0);

  protected readonly fingerprint = computed(() => readableFingerprint(this.state()?.fingerprint ?? ''));
  protected readonly short = computed(() => (this.state()?.fingerprint ?? '').slice(0, 8).replace(/(.{4})/, '$1 ').toUpperCase());
  protected readonly added = computed(() => Math.max(this.running() ? this.doneNow() : 0, this.state()?.added ?? 0));
  protected readonly percent = computed(() => {
    const total = this.state()?.total ?? 0;
    return total ? Math.min(100, Math.round((this.added() / total) * 100)) : 0;
  });

  constructor() {
    void this.refresh();
    const timer = setInterval(() => void this.refresh(), POLL_MS);
    inject(DestroyRef).onDestroy(() => clearInterval(timer));
  }

  private async refresh(): Promise<void> {
    try {
      this.state.set(await this.service.state(this.ctx.friendId));
    } catch (err: any) {
      if (!this.state()) this.error.set(err.message ?? tr('friendRecovery.couldNotReadThe', 'Could not read the request'));
    }
  }

  protected async ask(): Promise<void> {
    await this.run(async () => this.state.set(await this.service.ask(this.ctx.friendId)));
  }

  protected async cancel(): Promise<void> {
    await this.run(async () => {
      await this.service.cancel(this.ctx.friendId);
      await this.refresh();
    });
  }

  /** The friend says yes and the work starts at once. */
  protected async approve(): Promise<void> {
    await this.run(async () => {
      this.state.set(await this.service.approve(this.ctx.friendId));
      await this.work();
    });
  }

  /** The work of the helper: also what "Continue" does when the page is opened again halfway. */
  protected async work(): Promise<void> {
    const request = this.state();
    if (!request || this.running()) return;
    this.running.set(true);
    this.doneNow.set(0);
    this.error.set(null);
    try {
      const result = await this.service.help(this.ctx.friendId, request, (done) => this.doneNow.set(done));
      this.skipped.set(result.skipped);
    } finally {
      this.running.set(false);
      await this.refresh();
    }
  }

  private async run(action: () => Promise<void>): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    try {
      await action();
    } catch (err: any) {
      this.error.set(err.message ?? tr('friendRecovery.thatDidNotWork', 'That did not work'));
    } finally {
      this.busy.set(false);
    }
  }
}
