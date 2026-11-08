import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';

/** Shown where locked items are seen (the chat, the safebox): this device cannot open some of them yet, and how to get them back. */
@Component({
  selector: 'app-recovery-hint',
  imports: [RouterLink],
  template: `
    <p class="small text-secondary text-center m-0 px-2">
      🔒 Some {{ what() }} are locked for another device. If you have another device that works, tap Allow under
      <a routerLink="/settings/encryption">Settings → Keys → Advanced</a> on it. Or <a [routerLink]="['/friends', friendId(), 'recovery']">ask your friend to help</a>.
    </p>
  `,
})
export class RecoveryHint {
  readonly friendId = input.required<string>();
  readonly what = input('messages');
}
