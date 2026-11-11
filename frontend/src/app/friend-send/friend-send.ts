import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { Component, ElementRef, HostListener, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { AddMedia } from '../add-media/add-media';
import { ChatService } from '../core/chat.service';
import { PokeToggle } from '../friend-page/poke-toggle';
import { Clearable } from '../core/clearable';
import { EMOJI_GROUPS } from '../core/emojis';
import { QUICK_LENGTH, QUICK_MAX, UiPreferencesService, quickOf } from '../core/ui-preferences';
import { FriendContext } from '../friend-page/friend-context';

/**
 * Send a message to one friend (`/friends/:id/send`, from the icon in the header of the friend page): a large frame to write in, with the smiley, the image,
 * video and voice buttons and Send inside it, and the ready-made messages as bubbles under it (this friend's own first, then the general ones; the
 * dashed "Add" bubble opens the frame to change this friend's own, which are kept on this device only).
 * Everything that opens (the emojis, the image / video / voice panel, the Add frame) closes when focus goes elsewhere (a click outside, or Escape); the
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
  protected readonly general = this.prefs.value('quickMessages');
  protected readonly enterSends = this.prefs.value('enterSends');
  /** the ready-made messages (and the Add frame) are off for now */
  protected readonly quickMessagesShown = false;
  protected readonly quickMax = QUICK_MAX;
  protected readonly quickLength = QUICK_LENGTH;

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
    // the menu of the header: "Messages for Leif x only" opens the frame to change them (after the click that chose it has been seen by the click-outside rule)
    // (off with the ready-made messages) this.ctx.setPageTool({ label: tr('friendSend.messagesForOnly', 'Messages for {{ friendName }} only', { friendName: this.friendName() }), kind: 'message', run: () => setTimeout(() => this.openAdd()) }, inject(DestroyRef));
  }

  /** the small button in the corner of the frame: hide the Send form (the Send icon in the header shows it again) */
  protected hide(): void {
    if (this.embedded()) this.ctx.feedSendOpen.set(false);
    else this.ctx.sendFormOpen.set(false);
  }

  private openAdd(): void {
    this.emojiOpen.set(false);
    if (!this.addOpen()) this.toggleAdd();
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
  /** the frame to change this friend's own messages */
  protected readonly addOpen = signal(false);
  /** the messages being changed there (empty rows are allowed while typing; only the filled ones are saved) */
  protected readonly rows = signal<string[]>([]);

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

  protected toggleAdd(): void {
    if (!this.addOpen()) this.rows.set([...this.ctx.ownQuick(), ...(this.ctx.ownQuick().length < QUICK_MAX ? [''] : [])]);
    this.addOpen.update((on) => !on);
  }

  /** a click elsewhere, or Escape, closes what is open (the panel for an image, a video or a voice only while it holds nothing) */
  @HostListener('document:click', ['$event'])
  protected onDocumentClick(event: Event): void {
    const inside = (selector: string) => event.composedPath().some((el) => el instanceof Element && el.matches(selector)); // the path as it was at the click: a button that was removed by the click is still inside
    if (this.emojiOpen() && !inside('.sf-send-emoji, [data-send="emoji"]')) this.emojiOpen.set(false);
    if (this.attach() && !inside('.sf-send-attach, [data-send="attach"]') && !this.media()?.hasWork()) this.attach.set(null);
    if (this.addOpen() && !inside('.sf-send-addframe, [data-send="add"]')) this.addOpen.set(false);
  }

  @HostListener('document:keydown.escape')
  protected onEscape(): void {
    this.emojiOpen.set(false);
    this.addOpen.set(false);
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
    if (!text || this.busy()) return;
    this.busy.set(true);
    this.error.set(null);
    this.notice.set(null);
    try {
      await this.chat.send(this.ctx.friendId, text, this.ctx.pokes());
      this.ctx.poke.set(false);
      this.notice.set(`Sent: ${text.length > 40 ? text.slice(0, 40) + '…' : text}`);
      if (clear) {
        this.text.set('');
        this.emojiOpen.set(false);
      }
    } catch (err: any) {
      this.error.set(err.message ?? tr('friendSend.couldNotSendThe', 'Could not send the message'));
    } finally {
      this.busy.set(false);
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

  // ------------------------------------------------------------------ this friend's own messages

  protected setRow(index: number, value: string): void {
    this.rows.update((list) => list.map((text, i) => (i === index ? value : text)));
    this.save();
  }

  protected removeRow(index: number): void {
    this.rows.update((list) => list.filter((_, i) => i !== index));
    this.save();
  }

  protected addRow(): void {
    if (this.rows().length < QUICK_MAX) this.rows.update((list) => [...list, '']);
  }

  private save(): void {
    this.ctx.setOwnQuick(quickOf(this.rows())); // saved as it is typed, so closing the frame loses nothing
  }
}
