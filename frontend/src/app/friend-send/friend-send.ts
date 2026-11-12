import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { Component, ElementRef, HostListener, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { AddMedia } from '../add-media/add-media';
import { ChatService } from '../core/chat.service';
import { PokeToggle } from '../friend-page/poke-toggle';
import { Clearable } from '../core/clearable';
import { EMOJI_GROUPS } from '../core/emojis';
import { UiPreferencesService } from '../core/ui-preferences';
import { FriendContext } from '../friend-page/friend-context';

/**
 * Send a message to one friend (`/friends/:id/send`, from the icon in the header of the friend page): a large frame to write in, with the smiley, the image,
 * video and voice buttons and Send inside it.
 * Everything that opens (the emojis, the image / video / voice panel) closes when focus goes elsewhere (a click outside, or Escape); the
 * image / video / voice panel only while it holds nothing (no file chosen, no camera or recording open), so nothing is lost.
 */
@Component({
  selector: 'app-friend-send',
  imports: [AddMedia, Clearable, PokeToggle, TranslocoDirective],
  templateUrl: './friend-send.html',
  providers: [provideTranslocoScope('friendSend')],
})
export class FriendSend {
  protected readonly ctx = inject(FriendContext);
  /** shown on top of the feed (not as the Send page): the form is always shown then */
  readonly embedded = input(false);
  private readonly chat = inject(ChatService);
  private readonly prefs = inject(UiPreferencesService);

  protected readonly friendName = this.ctx.friendName;
  protected readonly enterSends = this.prefs.value('enterSends');

  constructor() {
    // the writing field is two lines and grows with the text (the style caps it): measured after the new text is in the field
    effect(() => {
      this.text();
      const field = this.field()?.nativeElement;
      if (!field) return;
      setTimeout(() => {
        field.style.height = 'auto';
        field.style.height = `${field.scrollHeight}px`;
      });
    });
  }

  /** the small button in the corner of the frame: hide the Send form (the Send icon in the header shows it again) */
  protected hide(): void {
    if (this.embedded()) this.ctx.feedSendOpen.set(false);
    else this.ctx.sendFormOpen.set(false);
  }

  protected readonly field = viewChild<ElementRef<HTMLTextAreaElement>>('field');
  private readonly media = viewChild(AddMedia);
  protected readonly text = this.ctx.sendDraft;
  protected readonly busy = signal(false);
  protected readonly notice = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  // ------------------------------------------------------------------ what opens over the frame

  protected readonly emojiGroups = EMOJI_GROUPS;
  protected readonly emojiOpen = signal(false);
  /** the group open in the emoji picker: the one used last (remembered on this device), People when there is none */
  protected readonly emojiGroup = signal(EMOJI_GROUPS.some((g) => g.name === this.prefs.get('emojiTab')) ? this.prefs.get('emojiTab') : 'People');
  protected readonly emojisOfGroup = computed(() => EMOJI_GROUPS.find((g) => g.name === this.emojiGroup())?.emojis ?? []);
  protected readonly attach = signal<'image' | 'video' | 'audio' | null>(null);

  protected chooseEmojiGroup(name: string): void {
    this.emojiGroup.set(name);
    this.prefs.set('emojiTab', name);
  }

  protected toggleEmoji(): void {
    if (this.attach() && this.media()?.hasWork()) return; // the panel holds something: it is finished or cancelled first
    this.attach.set(null);
    this.emojiOpen.update((on) => !on);
  }

  protected openAttach(kind: 'image' | 'video' | 'audio'): void {
    if (this.attach() && this.media()?.hasWork()) return;
    this.emojiOpen.set(false);
    this.attach.set(this.attach() === kind ? null : kind);
  }

  /** a click elsewhere, or Escape, closes what is open (the panel for an image, a video or a voice only while it holds nothing) */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    const inside = (selector: string) => event.composedPath().some((el) => el instanceof Element && el.matches(selector)); // the path as it was at the click: a button that was removed by the click is still inside
    if (this.emojiOpen() && !inside('.sf-send-emoji, [data-send="emoji"]')) this.emojiOpen.set(false);
    if (this.attach() && !inside('.sf-send-attach, [data-send="attach"]') && !this.media()?.hasWork()) this.attach.set(null);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.emojiOpen.set(false);
    if (!this.media()?.hasWork()) this.attach.set(null);
  }

  /** the emoji goes where the cursor is */
  protected addEmoji(emoji: string): void {
    const input = this.field()?.nativeElement;
    const value = this.text();
    const start = input?.selectionStart ?? value.length;
    const end = input?.selectionEnd ?? start;
    const next = value.slice(0, start) + emoji + value.slice(end);
    if (next.length > 2000) return; // the same limit as the field
    this.text.set(next);
    if (input) {
      input.value = next; // not focused: focusing the field would close the picker (the next emoji goes after this one, as in the conversation)
      const caret = start + emoji.length;
      input.setSelectionRange(caret, caret);
    }
  }

  // ------------------------------------------------------------------ sending

  protected async deliver(message: string, clear = false): Promise<void> {
    const text = message.trim();
    if (!text || (!clear && this.busy())) return;
    // at once: the frame is empty and the message is said to be on its way, the answer of the server is not waited for (a failure puts the text back)
    if (clear) {
      this.text.set('');
      this.emojiOpen.set(false);
    } else {
      this.busy.set(true);
    }
    this.error.set(null);
    this.notice.set(`Sending: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`);
    const poke = this.ctx.pokes();
    try {
      await this.chat.send(this.ctx.friendId, text, poke);
      this.ctx.poke.set(false);
      this.notice.set(`Sent: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`);
    } catch (err: any) {
      if (clear && !this.text().trim()) this.text.set(text); // not sent: the text is back in the frame (unless something new is being written)
      this.notice.set(null);
      this.error.set(err.message ?? tr('friendSend.couldNotSendThe', 'Could not send the message'));
    } finally {
      if (!clear) this.busy.set(false);
    }
  }

  /** a file is waiting in the panel above the frame: Send sends it, with the text of the frame as its text */
  protected readonly mediaReady = computed(() => !!this.attach() && !!this.media()?.hasFile());

  protected go(): void {
    if (this.mediaReady()) void this.media()?.send();
    else void this.deliver(this.text(), true);
  }

  protected enterPressed(event: Event): void {
    if (!this.enterSends() || (event as KeyboardEvent).shiftKey) return;
    event.preventDefault();
    this.go();
  }

  protected attached(): void {
    this.attach.set(null);
    this.text.set('');
    this.notice.set('Sent.');
    this.error.set(null);
  }
}
