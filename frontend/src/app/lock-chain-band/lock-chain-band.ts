import { Component, computed, effect, inject, input, signal } from '@angular/core';
import { FriendListsService } from '../core/friend-lists.service';
import { tr } from '../core/i18n';

/**
 * Under the header of a friend's page: the signed lock list of the friend (or of someone in the group) does not hold (docs/design/default-key.md, step 3).
 * Unlike the question about a new key, this STOPS sending: nothing is locked while the chain is broken. A new history that is valid in itself ('pin': the person
 * may have started over after losing every device) can be accepted after asking them; a broken signature or lists that went away can only be explained by them.
 */
@Component({
  selector: 'app-lock-chain-band',
  template: `
    @if (problems().length) {
      <div class="alert alert-danger m-0 d-flex flex-column gap-2" role="alert">
        <span>⚠ {{ tr('core.chainBroken', 'The lock of {{ name }} does not check out. Nothing can be sent until you know why. Call {{ name }} and ask what happened.', { name: name() }) }}</span>
        @if (onlyNewHistory()) {
          <span class="sf-hint">{{ tr('core.chainNewHistory', 'The lock starts from a new beginning. This can happen when {{ name }} lost every phone and computer. Only accept it if {{ name }} told you so.', { name: name() }) }}</span>
        } @else {
          <span class="sf-hint">{{ tr('core.chainCannotTrust', 'Something in the list of locks was changed or taken away. It cannot be accepted here.') }}</span>
        }
        <span class="d-flex gap-2">
          @if (onlyNewHistory()) {
            <button type="button" class="btn btn-primary btn-sm" [disabled]="busy()" (click)="accept()">{{ tr('core.chainAccept', 'Yes, {{ name }} told me', { name: name() }) }}</button>
          }
          <button type="button" class="btn btn-light btn-sm" [disabled]="busy()" (click)="again()">{{ tr('core.chainAgain', 'Check again') }}</button>
        </span>
      </div>
    }
  `,
})
export class LockChainBand {
  protected readonly tr = tr;
  private readonly lists = inject(FriendListsService);

  readonly friendId = input.required<string>();
  readonly name = input('');
  protected readonly busy = signal(false);

  protected readonly problems = computed(() => this.lists.broken()[this.friendId()] ?? []);
  /** every problem is a valid new history (it can be accepted); one broken chain or vanished list makes the whole warning final */
  protected readonly onlyNewHistory = computed(() => this.problems().length > 0 && this.problems().every((p) => p.reason === 'pin'));

  constructor() {
    effect(() => void this.lists.check(this.friendId()));
  }

  protected async again(): Promise<void> {
    this.busy.set(true);
    try {
      await this.lists.check(this.friendId());
    } finally {
      this.busy.set(false);
    }
  }

  protected async accept(): Promise<void> {
    this.busy.set(true);
    try {
      for (const p of this.problems()) await this.lists.accept(this.friendId(), p.uid);
    } finally {
      this.busy.set(false);
    }
  }
}
