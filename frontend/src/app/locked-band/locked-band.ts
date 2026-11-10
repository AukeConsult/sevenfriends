import { Component, input } from '@angular/core';
import { RouterLink } from '@angular/router';
import { tr } from '../core/i18n';

/**
 * Under the header of a friend's page (messages and safebox): this device cannot open some of the messages or files of this friendship, and where to get them
 * back (Settings → Privacy lock: my other devices, my 24 words, my friend). Design: docs/design/recovery-own-devices.md.
 */
@Component({
  selector: 'app-locked-band',
  imports: [RouterLink],
  template: `
    <div class="sf-locked-band" role="status">
      <span class="sf-locked-text">🔒 {{ text() }}</span>
      <a class="btn btn-primary btn-sm" routerLink="/settings/encryption" [queryParams]="{ from: '/friends/' + friendId() }">{{ tr('core.getThemBack', 'Get them back') }}</a>
    </div>
  `,
})
export class LockedBand {
  protected readonly tr = tr;
  readonly friendId = input.required<string>();
  readonly name = input('');
  readonly messages = input(0);
  readonly files = input(0);

  protected text(): string {
    const messages = this.messages();
    const files = this.files();
    const name = this.name();
    if (messages && files) return tr('core.lockedMessagesAndFiles', '{{ messages }} messages and {{ files }} files with {{ name }} are locked on this device.', { messages, files, name });
    if (files) return tr('core.lockedFilesWith', '{{ count }} files with {{ name }} are locked on this device.', { count: files, name });
    return tr('core.lockedMessagesWith', '{{ count }} messages with {{ name }} are locked on this device.', { count: messages, name });
  }
}
