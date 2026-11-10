import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, effect, inject, input, signal } from '@angular/core';
import { ChatService } from '../../core/chat.service';
import { tr } from '../../core/i18n';

/**
 * The button at the top of an item: "Tell {friend}". Adding or changing an item never sends anything; only this button does: it sends a regular message
 * ("📦 In the safebox: Ticket – the title", then the address of the item on a line of its own) in the conversation, the same as one typed there (locked when both of you have a key, with its sound and push).
 * It can be pressed again for a later change.
 */
@Component({
  selector: 'app-safebox-tell',
  imports: [TranslocoDirective],
  templateUrl: './safebox-tell.html',
  providers: [provideTranslocoScope('safebox')],
})
export class SafeboxTell {
  readonly friendId = input.required<string>();
  readonly itemId = input.required<string>();
  readonly friendName = input.required<string>();
  /** what kind of item it is (Note, Ticket, Picture ...) and its title: they make the text of the message */
  readonly what = input('');
  readonly title = input('');
  /** the page of the item (`['/friends', id, 'safebox', ...]`): its address goes into the message, so a tap on the message opens the item */
  readonly path = input<string[]>([]);

  private readonly chat = inject(ChatService);
  protected readonly state = signal<'idle' | 'sending' | 'sent'>('idle');
  protected readonly error = signal<string | null>(null);

  constructor() {
    // another item: the button starts again
    effect(() => {
      this.itemId();
      this.state.set('idle');
      this.error.set(null);
    });
  }

  /** the message: a regular one, locked like every message when both of you have a key */
  private text(): string {
    const what = this.what().trim();
    const title = this.title().trim();
    const text = tr('safebox.tell.message', '📦 In the safebox: {{ item }}', { item: [what, title].filter(Boolean).join(' – ') });
    return this.path().length ? `${text}\n${location.origin}${this.path().join('/')}` : text;
  }

  protected async tell(): Promise<void> {
    this.state.set('sending');
    this.error.set(null);
    try {
      await this.chat.send(this.friendId(), this.text());
      this.state.set('sent');
    } catch (err: any) {
      this.state.set('idle');
      this.error.set(err?.message || tr('safebox.tell.couldNotSend', 'The message could not be sent. Try again.'));
    }
  }
}
