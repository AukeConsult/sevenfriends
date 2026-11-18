import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { ChatService } from '../core/chat.service';
import { tr } from '../core/i18n';
import { FriendContext } from './friend-context';

/** What a poke says in the feed: it is a normal message, so it is locked like any other. */
const POKE_TEXT = '🔔';

/**
 * The poke: opened by the bell in the header of a friend. An expandable frame under the header (never a pop-up) says what a poke does and asks once;
 * Send poke sends a normal message with `poke: true`, which rings the friend's phone like an alarm (Android; see docs/design/poke-alarm.md).
 * Only a friend who has a seat for me can be poked (`ctx.canPoke`).
 */
@Component({
  selector: 'app-poke-frame',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoDirective],
  providers: [provideTranslocoScope('friendPage')],
  template: `
    <ng-container *transloco="let t">
      <div class="sf-expand" [class.open]="ctx.pokeOpen() && ctx.canPoke()" [attr.inert]="ctx.pokeOpen() && ctx.canPoke() ? null : ''">
        <div class="sf-expand-inner">
          <div class="sf-card m-2 p-3 d-flex flex-column gap-2" role="group" [attr.aria-label]="t('friendPage.poke') || 'Poke'">
            @if (message(); as m) {
              <p class="m-0" [class.text-danger]="failed()">{{ m }}</p>
            } @else {
              <p class="m-0">🔔 {{ t('friendPage.pokeAsk', { name: ctx.friendName() }) || 'This rings their phone like an alarm, even when it is silent.' }}</p>
            }
            @if (!message()) { <p class="sf-hint m-0">{{ t('friendPage.pokeNote') || 'It rings like an alarm on Android phones and in the Windows app for now. On other devices it arrives as a normal notification.' }}</p> }
            <div class="d-flex gap-2">
              <button type="button" class="btn btn-light btn-sm flex-fill" (click)="close()" [disabled]="busy()">{{ t('friendPage.pokeCancel') || 'Cancel' }}</button>
              @if (!message() || failed()) {
                <button type="button" class="btn btn-primary btn-sm flex-fill" (click)="send()" [disabled]="busy()">{{ t('friendPage.pokeSend') || 'Send poke' }}</button>
              }
            </div>
          </div>
        </div>
      </div>
    </ng-container>
  `,
})
export class PokeFrame {
  protected readonly ctx = inject(FriendContext);
  private readonly chat = inject(ChatService);
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);
  protected readonly failed = signal(false);

  protected close(): void {
    this.ctx.pokeOpen.set(false);
    this.message.set(null);
    this.failed.set(false);
  }

  protected async send(): Promise<void> {
    if (this.busy() || !this.ctx.canPoke()) return;
    this.busy.set(true);
    this.failed.set(false);
    try {
      const item = await this.chat.send(this.ctx.friendId, POKE_TEXT, true);
      this.ctx.feed()?.addSent(item);
      this.message.set(tr('friendPage.pokeSent', '{{ name }} was poked.', { name: this.ctx.friendName() }));
      setTimeout(() => { if (!this.failed()) this.close(); }, 2500);
    } catch (err: any) {
      this.failed.set(true);
      this.message.set(err?.message ?? tr('friendSend.couldNotSendThe', 'Could not send the message'));
    } finally {
      this.busy.set(false);
    }
  }
}
