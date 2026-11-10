import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Location, NgTemplateOutlet } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { translationsLoaded } from '../../core/i18n';
import { SafeboxService } from '../../core/safebox.service';
import { UiPreferencesService } from '../../core/ui-preferences';
import { arrangeKinds, boxKinds } from '../../core/safebox-objects';

/**
 * Add a new item and link it (`/friends/:id/safebox/link/:itemId/new`): the kinds to choose from, like the New frame of the list. The choice opens the page
 * of that kind and remembers this item (SafeboxService.setLinkFrom): when the new item is saved (or the files are uploaded) it is linked with this one.
 */
@Component({
  selector: 'app-safebox-link-new',
  imports: [NgTemplateOutlet, RouterLink, TranslocoDirective],
  templateUrl: './safebox-link-new.html',
  providers: [provideTranslocoScope('safebox')],
})
export class SafeboxLinkNew {
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  protected readonly friendId = inject(ActivatedRoute).snapshot.paramMap.get('id') ?? '';
  protected readonly itemId = inject(ActivatedRoute).snapshot.paramMap.get('itemId') ?? '';
  protected readonly list = ['/friends', this.friendId, 'safebox'];
  private readonly service = inject(SafeboxService);
  protected readonly prefs = inject(UiPreferencesService);
  protected readonly moreOpen = this.prefs.value('boxHiddenOpen');
  protected readonly split = computed(() => arrangeKinds(this.kinds(), this.prefs.value('boxKindLayout')()));
  protected readonly newKinds = computed(() => [...this.split().main, ...(this.moreOpen() ? this.split().more : [])]);
  private readonly loaded = translationsLoaded();
  /** the names are read again when the language file has arrived */
  protected readonly kinds = computed(() => (this.loaded(), boxKinds()));

  /** The new item is made linked with this one: remembered until its page has taken it. */
  protected choose(): void {
    this.service.setLinkFrom(this.itemId);
  }

  protected path(type: string): string[] {
    const base = ['/friends', this.friendId, 'safebox'];
    if (type === 'file') return [...base, 'new', 'file'];
    return type === 'note' ? [...base, 'note'] : [...base, 'new', type];
  }

  /** One step back in the history (the pages of this flow replace each other, so that is the item, or the list of items to pick from); opened directly: the item, or the list. */
  protected back(event: Event): void {
    event.preventDefault();
    if ((history.state?.navigationId ?? 1) > 1) this.location.back();
    else void this.router.navigate(this.service.openPath(this.friendId, this.itemId) ?? this.list, { replaceUrl: true });
  }
}
