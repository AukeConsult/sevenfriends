import { Component, input, output } from '@angular/core';
import { RouterLink } from '@angular/router';
import { tr } from '../core/i18n';

/**
 * The header of every page: the one coloured bar (`.sf-bar`, see styles.scss). A back arrow on a sub-page (a link, or a button that emits `backClick`), the title on the left
 * with an optional small line under it, an optional icon before the title (`<svg barIcon>`), and the actions of the page on the right (the content of the tag, each a `.sf-bar-icon`).
 * A top page (Profile, Settings) has no back arrow. The styles are the standard ones; nothing is styled here.
 */
@Component({
  selector: 'app-page-bar',
  imports: [RouterLink],
  host: { style: 'display: contents' }, // the bar sticks to the top of the page, not of this tag
  template: `
    <header class="sf-bar" [class.sf-bar-sub]="sub()">
      @if (backTo(); as to) {
        <a class="sf-back" [routerLink]="to" (click)="backClick.emit($event)" [attr.aria-label]="label()">‹</a>
      } @else if (backButton()) {
        <button type="button" class="sf-back" (click)="backClick.emit($event)" [attr.aria-label]="label()">‹</button>
      }
      <div class="sf-bar-text">
        <h1 class="sf-bar-title sf-bar-heading"><ng-content select="[barIcon]" /><span class="sf-ellipsis">{{ title() }}</span></h1>
        @if (subtitle()) { <span class="sf-hint sf-ellipsis">{{ subtitle() }}</span> }
      </div>
      <div class="sf-bar-end"><ng-content /></div>
    </header>
  `,
})
export class PageBar {
  readonly title = input.required<string>();
  /** one small line under the title */
  readonly subtitle = input<string | null>(null);
  /** the back arrow is a link to this address */
  readonly backTo = input<string | unknown[] | null>(null);
  /** the back arrow is a button (it closes something on the same page, or does its own going back): see `backClick` */
  readonly backButton = input(false);
  /** a bar under another header (a friend's page): not sticky, no tint */
  readonly sub = input(false);
  /** the words for a screen reader; "Back" when not given */
  readonly backLabel = input<string | null>(null);
  readonly backClick = output<Event>();

  protected label(): string {
    return this.backLabel() || tr('common.back', 'Back');
  }
}
