import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FriendContext } from './friend-context';

/** Shown above the writing field when my friend has me on their sleep list: my message arrives silently, unless I poke. */
@Component({
  selector: 'app-poke-toggle',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (ctx.friend()?.sleepsMe) {
      <label class="sf-poke" [class.sf-on]="ctx.poke()">
        <input type="checkbox" class="form-check-input m-0" [checked]="ctx.poke()" (change)="ctx.poke.set($any($event.target).checked)" />
        <span>😴 Has you on sleep list. <strong>🔔 Poke anyway</strong> <span class="sf-poke-note">(makes a sound)</span></span>
      </label>
    }
  `,
})
export class PokeToggle {
  protected readonly ctx = inject(FriendContext);
}
