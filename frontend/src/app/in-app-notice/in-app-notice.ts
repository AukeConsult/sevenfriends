import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, inject, signal } from '@angular/core';
import { APP_ORIGIN } from '../core/app-origin';
import { FriendLinkService } from '../core/friend-link.service';
import { REQUIRED_BROWSER } from '../core/in-app-browser';

/**
 * The page that takes the whole screen when somebody who is not signed in is NOT in the browser that is right for the device: Safari on an iPhone or iPad, Chrome on Android,
 * a real browser on Windows (see `requiredBrowser`). Most often it is the built-in browser of another app (Messenger, WhatsApp ...), where a link from a chat opens.
 * It replaces EVERYTHING (`App` shows nothing else then: no sign-in page, no welcome pages, no menu): the lock key is made and kept in the storage of the browser, and another
 * browser has its own storage, so an account made here would lose its key and the messages could not be opened. So the person can only do one thing: copy the link, open the
 * right browser, and paste it there. Nothing is made or asked here (`KeysService` makes no key in the wrong browser either).
 */
@Component({
  selector: 'app-in-app-notice',
  imports: [TranslocoDirective],
  templateUrl: './in-app-notice.html',
  providers: [provideTranslocoScope('inAppNotice', 'login')],
})
export class InAppNotice {
  private readonly friendLinks = inject(FriendLinkService);
  /** the browser this device must use */
  protected readonly need = inject(REQUIRED_BROWSER);
  /** an invitation waits (the link has its code): the page says so */
  protected readonly invited = this.friendLinks.pending;

  protected readonly copied = signal(false);
  /** the link, shown to copy by hand when the browser did not allow the copy */
  protected readonly manual = signal<string | null>(null);

  /** The link to paste in the right browser: the waiting invitation when there is one, otherwise the start page. */
  private link(): string {
    const pending = this.friendLinks.pending();
    return pending ? this.friendLinks.linkText(pending) : APP_ORIGIN;
  }

  protected async copy(): Promise<void> {
    const link = this.link();
    try {
      await navigator.clipboard.writeText(link);
      this.copied.set(true);
      this.manual.set(null);
    } catch {
      this.copied.set(false);
      this.manual.set(link);
    }
  }
}
