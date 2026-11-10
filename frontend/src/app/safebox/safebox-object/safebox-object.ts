import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { SafeboxTell } from '../safebox-tell/safebox-tell';
import { Location } from '@angular/common';
import { DomSanitizer, SafeResourceUrl } from '@angular/platform-browser';
import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, untracked, viewChild } from '@angular/core';
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../../core/api.service';
import { ChatService } from '../../core/chat.service';
import { FriendsService } from '../../core/friends.service';
import { tr, translationsLoaded } from '../../core/i18n';
import { SafeboxLinks } from '../safebox-links/safebox-links';
import { SafeboxAttachments } from '../safebox-attachments/safebox-attachments';
import { SafeboxService } from '../../core/safebox.service';
import { REMIND_DEFAULT, REMIND_LEADS, objectKind, remindAt, safeUrl } from '../../core/safebox-objects';
import { UiPreferencesService } from '../../core/ui-preferences';
import { FriendContext } from '../../friend-page/friend-context';
import { BoxKeys, CHECKLIST_ENTRIES_MAX, CHECKLIST_TEXT_MAX, ChecklistEntry, OBJECT_TITLE_MAX, ObjectField, ObjectKind, ObjectPayload, ReminderRequest, SAFEBOX_OBJECT_TYPES, SafeboxType } from '../../models';
import { PageBar } from '../../page-bar/page-bar';

/** A link under a field (open the address, call, write, show on a map). */
interface ObjectAction {
  label: string;
  href: string;
  external: boolean;
}

/** A place found by the search. */
interface FoundPlace {
  name: string;
  address: string;
  lat: string;
  lng: string;
}

/**
 * One secret, link, checklist, place, contact or date of the safebox (design: docs/design/safebox-objects.md), new (`/friends/:id/safebox/new/:type`) or
 * opened to read and change (`/friends/:id/safebox/object/:itemId`). One page for all of them: the fields come from the kind (`core/safebox-objects.ts`).
 * Everything is locked on this device; both friends can change or take it out, and a change names the revision it started from (409 = the friend saved first).
 */
@Component({
  selector: 'app-safebox-object',
  imports: [PageBar, SafeboxTell, RouterLink, SafeboxAttachments, SafeboxLinks, TranslocoDirective],
  templateUrl: './safebox-object.html',
  providers: [provideTranslocoScope('safebox')],
})
export class SafeboxObject {
  private readonly service = inject(SafeboxService);
  private readonly router = inject(Router);
  private readonly location = inject(Location);
  private readonly ctx = inject(FriendContext);
  private readonly prefs = inject(UiPreferencesService);
  private readonly friends = inject(FriendsService);
  private readonly chat = inject(ChatService);
  private readonly sanitizer = inject(DomSanitizer);
  private readonly route = inject(ActivatedRoute);

  protected readonly friendId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly itemId = this.route.snapshot.paramMap.get('itemId');
  protected readonly isNew = this.itemId === null;
  protected readonly titleMax = OBJECT_TITLE_MAX;
  protected readonly entryMax = CHECKLIST_TEXT_MAX;
  protected readonly friendName = computed(() => this.friends.friends().find((f) => f.id === this.friendId)?.name ?? tr('safebox.common.yourFriend', 'your friend'));

  /** the kind of this object (for a new one from the address, for an opened one when it has been read) */
  protected readonly type = signal<SafeboxType | null>(this.itemId === null ? ((this.route.snapshot.paramMap.get('type') as SafeboxType | null) ?? null) : null);
  private readonly loaded = translationsLoaded();
  protected readonly kind = computed<ObjectKind | undefined>(() => (this.loaded(), this.type() && SAFEBOX_OBJECT_TYPES.includes(this.type()!) ? objectKind(this.type()!) : undefined));

  protected readonly title = signal('');
  protected readonly values = signal<Record<string, string>>({});
  protected readonly entries = signal<ChecklistEntry[]>([]);
  protected readonly newEntry = signal('');
  /** the secret fields that are shown (they start hidden) */
  protected readonly shown = signal<Record<string, boolean>>({});
  protected readonly copied = signal<string | null>(null);
  /** "remind me": minutes before the time, or 'none' (for a date and a ticket); kept inside the locked payload, only the moment goes to the server */
  protected readonly lead = signal(REMIND_DEFAULT);
  protected readonly remindFriend = signal(false);
  /** A getter: the labels are read when the page is drawn, after the language file is loaded. */
  protected get leads(): { value: string; label: string }[] {
    return REMIND_LEADS.map((l) => ({ value: l.value, label: this.leadLabel(l.minutes) }));
  }
  private readonly saved = signal('');
  private readonly revision = signal(0);
  protected readonly loading = signal(!this.isNew);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly conflict = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly keyStatus = this.ctx.keyStatus;
  protected readonly whoLacksKey = this.ctx.whoLacksKey;
  protected readonly boxKeys = this.ctx.boxKeys;
  private readonly attachments = viewChild(SafeboxAttachments);
  protected readonly list = ['/friends', this.friendId, 'safebox'];

  // a place: the map (Leaflet + OpenStreetMap, drawn by the app: tap it or drag the pin to set the place), "Use my location" and the search (OpenStreetMap's Nominatim)
  protected readonly locating = signal(false);
  protected readonly searchText = signal('');
  protected readonly searching = signal(false);
  protected readonly found = signal<FoundPlace[] | null>(null);
  /** where the place is, for the Open in Maps link and for "has a place": the coordinates, otherwise the address ('' = nothing yet) */
  private readonly mapQuery = computed(() => (this.values()['lat'] && this.values()['lng'] ? `${this.values()['lat']},${this.values()['lng']}` : (this.values()['address'] ?? '').trim()));
  private readonly mapHost = viewChild<ElementRef<HTMLElement>>('mapHost');
  private map: LeafletMap | null = null;
  private pin: LeafletMarker | null = null;
  private leaflet: typeof import('leaflet') | null = null;
  /** the last position came from the map itself (a tap or a drag): the map stays where it is zoomed to */
  private fromMap = false;
  /** the address was filled in from the map (not typed): the next tap may replace it */
  private autoAddress = false;
  private readonly snapshot = computed(() => JSON.stringify([this.title(), this.values(), this.entries(), this.lead(), this.remindFriend()]));
  protected readonly changed = computed(() => this.snapshot() !== this.saved());
  protected readonly canSave = computed(() => !this.busy() && !this.loading() && !!this.kind() && this.title().trim() !== '' && this.requiredFilled() && this.placeFilled() && (this.isNew || this.changed()) && this.keyStatus() === 'both');

  /** every field that must be filled in is */
  private readonly requiredFilled = computed(() => (this.kind()?.fields ?? []).every((f) => !f.required || (this.values()[f.key] ?? '').trim() !== ''));

  /** a place needs an address or a position */
  private readonly placeFilled = computed(() => !this.kind()?.located || this.mapQuery() !== '');

  /** The position of this device goes into the place. */
  protected useMyLocation(): void {
    if (!navigator.geolocation) {
      this.error.set(tr('safebox.object.noLocation', 'This device cannot tell where it is.'));
      return;
    }
    this.locating.set(true);
    this.error.set(null);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        this.locating.set(false);
        this.setPoint(pos.coords.latitude, pos.coords.longitude, false);
      },
      () => {
        this.error.set(tr('safebox.object.couldNotLocate', 'Could not get your position. Allow the location for this app and try again.'));
        this.locating.set(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  /** The place is at this position (from a tap, a drag, this device or a search). The address is looked up from the position (best effort) and replaces the one in the field: the last place you set is the one you mean. */
  private setPoint(lat: number, lng: number, fromMap: boolean, address?: string): void {
    this.fromMap = fromMap;
    this.values.update((v) => ({ ...v, lat: lat.toFixed(6), lng: lng.toFixed(6), ...(address !== undefined ? { address } : {}) }));
    if (address !== undefined) {
      this.autoAddress = true;
      this.placeSet.update((n) => n + 1);
    } else void this.addressOf(lat, lng);
  }

  private addressAsk = 0;
  /** counts the places that were set (a tap, a drag, this device, a search result): a new item is made after the latest one is complete */
  private readonly placeSet = signal(0);

  /** The address of a position, from OpenStreetMap's reverse lookup; only the answer for the latest tap is written in. */
  private async addressOf(lat: number, lng: number): Promise<void> {
    const ask = ++this.addressAsk;
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const name = ((await res.json()) as { display_name?: string }).display_name;
      if (name && ask === this.addressAsk) {
        this.autoAddress = true;
        this.values.update((v) => ({ ...v, address: name.slice(0, 500) }));
        // a place needs a name to be saved: a place set on the map is called after the first part of its address, until the person writes another name
        if (!this.title().trim()) this.title.set(name.split(',')[0].trim().slice(0, this.titleMax));
      }
    } catch {
      /* the address can be written by hand */
    } finally {
      if (ask === this.addressAsk) this.placeSet.update((n) => n + 1);
    }
  }

  /** The address of a found place without its name at the start (it is shown above): "Drammen, Buskerud, Norway" under "Drammen" is "Buskerud, Norway". */
  protected more(place: FoundPlace): string {
    const a = place.address.trim();
    return a.toLowerCase().startsWith(place.name.toLowerCase()) ? a.slice(place.name.length).replace(/^[\s,]+/, '') : a;
  }

  /** Looks the typed text up in OpenStreetMap's Nominatim (the text goes to them, nothing else). One lookup per tap: no search while typing. */
  protected async search(): Promise<void> {
    const text = this.searchText().trim();
    if (!text) return;
    this.searching.set(true);
    this.error.set(null);
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&q=${encodeURIComponent(text)}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      const body = (await res.json()) as { display_name?: string; name?: string; lat: string; lon: string }[];
      this.found.set(body.map((p) => ({ name: p.name || (p.display_name ?? '').split(',')[0].trim(), address: p.display_name ?? '', lat: String(p.lat), lng: String(p.lon) })));
    } catch {
      this.error.set(tr('safebox.object.couldNotSearch', 'Could not search for places right now.'));
    } finally {
      this.searching.set(false);
    }
  }

  /** A found place fills the name (when there is none yet), the address and the position, and the map moves there. */
  protected pick(place: FoundPlace): void {
    if (!this.title().trim() && place.name) this.title.set(place.name.slice(0, OBJECT_TITLE_MAX));
    this.setPoint(Number(place.lat), Number(place.lng), false, place.address.slice(0, 500));
    this.found.set(null);
    this.searchText.set('');
  }

  /** Starts the map in its frame (Leaflet is loaded only now: a page without a place never fetches it). */
  private async startMap(el: HTMLElement): Promise<void> {
    const mod = await import('leaflet');
    const L = ((mod as unknown as { default?: typeof import('leaflet') }).default ?? mod) as typeof import('leaflet');
    this.leaflet = L;
    const map = L.map(el, { zoomControl: true }).setView([50, 10], 4);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '© OpenStreetMap contributors' }).addTo(map);
    map.on('click', (e) => this.setPoint(e.latlng.lat, e.latlng.lng, true));
    this.map = map;
    setTimeout(() => map.invalidateSize(), 0);
    this.showPin();
  }

  /** The pin follows the saved position (and can be dragged); no position = no pin. */
  private showPin(): void {
    const L = this.leaflet;
    const map = this.map;
    if (!L || !map) return;
    const lat = Number(this.values()['lat']);
    const lng = Number(this.values()['lng']);
    if (!this.values()['lat'] || !this.values()['lng'] || Number.isNaN(lat) || Number.isNaN(lng)) {
      this.pin?.remove();
      this.pin = null;
      return;
    }
    if (this.pin) this.pin.setLatLng([lat, lng]);
    else {
      const icon = L.divIcon({ className: 'sf-pin', iconSize: [32, 32], iconAnchor: [16, 32], html: '<svg width="32" height="32" viewBox="0 0 24 24" fill="currentColor" stroke="#fff" stroke-width="1.5" aria-hidden="true"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" fill="#fff" stroke="none" /></svg>' });
      this.pin = L.marker([lat, lng], { icon, draggable: true, keyboard: false }).addTo(map);
      this.pin.on('dragend', () => {
        const at = this.pin!.getLatLng();
        this.setPoint(at.lat, at.lng, true);
      });
    }
    if (this.fromMap) map.panTo([lat, lng]);
    else map.setView([lat, lng], 15);
  }

  private leadLabel(minutes: number | null): string {
    if (minutes === null) return tr('safebox.object.noReminder', "Don't remind me");
    if (minutes === 0) return tr('safebox.object.atTheTime', 'At the time');
    if (minutes < 60) return tr('safebox.object.minutesBefore', '{{ n }} minutes before', { n: minutes });
    if (minutes < 1440) return minutes === 60 ? tr('safebox.object.oneHourBefore', '1 hour before') : tr('safebox.object.hoursBefore', '{{ n }} hours before', { n: minutes / 60 });
    return minutes === 1440 ? tr('safebox.object.oneDayBefore', '1 day before') : minutes === 10080 ? tr('safebox.object.oneWeekBefore', '1 week before') : tr('safebox.object.daysBefore', '{{ n }} days before', { n: minutes / 1440 });
  }

  /** Open / call / write / map links for what is filled in. */
  // ---- the page of a link, shown in a frame (only after a tap: the address is then sent to the server once, to see whether the site allows a frame)
  protected readonly linkUrl = computed(() => (this.type() === 'link' ? safeUrl(this.values()['url'] ?? '') : null));
  /** idle = not asked; loading; frame = the page is shown; none = the site does not allow it */
  protected readonly preview = signal<'idle' | 'loading' | 'frame' | 'none'>('idle');
  protected readonly frame = signal<SafeResourceUrl | null>(null);
  private previewed = '';

  protected async showPreview(): Promise<void> {
    const url = this.linkUrl();
    if (!url) return;
    this.preview.set('loading');
    try {
      const link = await this.chat.previewLink(url);
      if (this.linkUrl() !== url) return; // the address was changed meanwhile
      this.previewed = url;
      if (link?.embedUrl && /^https?:\/\//i.test(link.embedUrl)) {
        this.frame.set(this.sanitizer.bypassSecurityTrustResourceUrl(link.embedUrl));
        this.preview.set('frame');
      } else this.preview.set('none');
    } catch {
      this.preview.set('none');
    }
  }

  protected hidePreview(): void {
    this.preview.set('idle');
    this.frame.set(null);
  }

  /** a link, a secret and a checklist are only that: no files or media on them */
  protected readonly attachable = computed(() => this.type() !== 'link' && this.type() !== 'secret' && this.type() !== 'checklist');

  protected readonly actions = computed<ObjectAction[]>(() => {
    const v = this.values();
    const out: ObjectAction[] = [];
    switch (this.type()) {
      case 'link': { const url = safeUrl(v['url'] ?? ''); if (url) out.push({ label: tr('safebox.object.openTheLink', 'Open the link'), href: url, external: true }); break; }
      case 'place': { const q = this.mapQuery(); if (q) out.push({ label: tr('safebox.object.openInMaps', 'Open in Maps'), href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, external: true }); break; }
      case 'contact': {
        const phone = (v['phone'] ?? '').replace(/[^\d+]/g, '');
        if (phone) out.push({ label: tr('safebox.object.call', 'Call'), href: `tel:${phone}`, external: false });
        const email = (v['email'] ?? '').trim();
        if (/^[^\s@]+@[^\s@]+$/.test(email)) out.push({ label: tr('safebox.object.writeAnEmail', 'Write an email'), href: `mailto:${email}`, external: false });
        break;
      }
    }
    return out;
  });

  constructor() {
    effect(() => {
      const host = this.mapHost();
      if (host && !this.map) void this.startMap(host.nativeElement);
    });
    effect(() => {
      // a link has no title of its own: it is the site of the web address
      const url = this.linkUrl();
      if (this.type() !== 'link' || !url) return;
      let name = url;
      try { name = new URL(url).hostname.replace(/^www\./i, '') || url; } catch { /* the address itself */ }
      untracked(() => { if (this.title() !== name) this.title.set(name.slice(0, this.titleMax)); });
    });
    effect(() => {
      if (this.linkUrl() !== this.previewed && untracked(this.preview) !== 'idle') this.hidePreview(); // another address: the old page is not shown
    });
    effect(() => {
      this.values(); // the pin follows the position
      this.showPin();
    });
    // a NEW place: a tap or a drag on the map, "Use my location" and a search result are not a field that is left, so nothing would make the item;
    // once the place is set (and the name and the rest are there) it is made a moment later. Writing the name does not trigger it: that is saved when the field is left.
    effect((onCleanup) => {
      this.placeSet();
      if (!this.isNew || this.loading() || !this.kind()?.located || !untracked(this.canSave)) return;
      const timer = setTimeout(() => void this.save(), 800);
      onCleanup(() => clearTimeout(timer));
    });
    // autosave: a change to an item that exists is saved a moment after the last key press (also once a save in progress is done)
    effect((onCleanup) => {
      this.snapshot();
      this.busy();
      if (this.isNew || this.loading() || this.conflict() || !this.changed()) return;
      const timer = setTimeout(() => void this.save(), 800);
      onCleanup(() => clearTimeout(timer));
    });
    inject(DestroyRef).onDestroy(() => {
      this.map?.remove();
      if (this.canSave()) void this.save(true); // leaving the page keeps what was typed (also a new item, if the needed fields are filled)
    });
    if (!this.friends.friends().length) void this.friends.load().catch(() => undefined);
    if (!this.isNew) void this.open(true);
  }

  protected value(field: ObjectField): string {
    return this.values()[field.key] ?? field.options?.[0]?.value ?? '';
  }

  protected setValue(field: ObjectField, value: string): void {
    if (field.key === 'address') this.autoAddress = false; // typed by hand: the map no longer replaces it
    this.values.update((v) => ({ ...v, [field.key]: value }));
  }

  protected inputType(field: ObjectField): string {
    return field.input === 'secret' ? (this.shown()[field.key] ? 'text' : 'password') : field.input;
  }

  protected toggleShown(field: ObjectField): void {
    this.shown.update((s) => ({ ...s, [field.key]: !s[field.key] }));
  }

  protected async copy(field: ObjectField): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.value(field));
      this.copied.set(field.key);
      setTimeout(() => this.copied.update((k) => (k === field.key ? null : k)), 1500);
    } catch {
      this.error.set(tr('safebox.object.couldNotCopy', 'Could not copy. Select the text and copy it by hand.'));
    }
  }

  protected addEntry(): void {
    const text = this.newEntry().trim();
    if (!text || this.entries().length >= CHECKLIST_ENTRIES_MAX) return;
    this.entries.update((list) => [...list, { id: Math.random().toString(36).slice(2, 10), text, done: false }]);
    this.newEntry.set('');
  }

  protected toggleEntry(id: string): void {
    this.entries.update((list) => list.map((e) => (e.id === id ? { ...e, done: !e.done } : e)));
  }

  protected editEntry(id: string, text: string): void {
    this.entries.update((list) => list.map((e) => (e.id === id ? { ...e, text } : e)));
  }

  protected removeEntry(id: string): void {
    this.entries.update((list) => list.filter((e) => e.id !== id));
  }

  protected readonly doneCount = computed(() => this.entries().filter((e) => e.done).length);

  private async open(fresh: boolean): Promise<void> {
    this.loading.set(true);
    this.loadError.set(null);
    try {
      const read = await this.service.readObject(this.friendId, this.itemId!, fresh);
      this.type.set(read.type);
      this.title.set(read.payload.title);
      const { remind, remindBoth, ...fields } = read.payload.fields;
      this.values.set(fields);
      this.lead.set(remind ?? REMIND_DEFAULT);
      this.remindFriend.set(remindBoth === '1');
      this.entries.set(read.payload.items ?? []);
      this.saved.set(this.snapshot());
      this.revision.set(read.revision);
      this.conflict.set(false);
    } catch (err: any) {
      this.loadError.set(err?.message || tr('safebox.object.couldNotOpenIt', 'Could not open it'));
    } finally {
      this.loading.set(false);
    }
  }

  protected loadTheirs(): void {
    void this.open(true);
  }

  protected async save(leaving = false): Promise<void> {
    if (!this.canSave()) return;
    this.busy.set(true);
    this.error.set(null);
    const kind = this.kind()!;
    const fields: Record<string, string> = {};
    for (const f of kind.fields) {
      const v = (this.values()[f.key] ?? '').trim();
      if (v) fields[f.key] = v;
    }
    if (kind.located) for (const k of ['lat', 'lng']) if (this.values()[k]) fields[k] = this.values()[k];
    let remind: ReminderRequest | null = null;
    if (kind.timed) {
      fields['remind'] = this.lead();
      fields['remindBoth'] = this.remindFriend() ? '1' : '0';
      const at = remindAt(fields['date'] ?? '', fields['time'] ?? '', this.lead());
      remind = at ? { at, both: this.remindFriend() } : null;
    }
    const items = kind.checklist ? this.entries().filter((e) => e.text.trim()).map((e) => ({ ...e, text: e.text.trim() })) : undefined;
    const payload: ObjectPayload = { v: 1, title: this.title().trim(), fields, ...(items ? { items } : {}) };
    const snapshot = this.snapshot(); // what is saved now: a change made while it goes is saved by the next round
    try {
      if (this.isNew) {
        const keys = this.ctx.boxKeys();
        if (!keys) throw new Error(tr('safebox.common.keysNotKnown', 'The keys are not known yet. Try again in a moment.'));
        const created = await this.service.addObject(this.friendId, kind.type, payload, keys, remind);
        if (leaving) { this.linkNew(created.id, keys).catch(() => undefined); return; } // the person is leaving: nothing to open
        // the files chosen before it was saved go to the new object now; the page of the object opens, and goes on saving by itself
        await this.attachments()?.uploadPending(created.id);
        const from = await this.linkNew(created.id, keys);
        await this.router.navigate(['/friends', this.friendId, 'safebox', 'object', created.id], { replaceUrl: true, state: from ? { backTo: from } : undefined });
        return;
      }
      const updated = await this.service.updateObject(this.friendId, this.itemId!, payload, this.revision(), remind);
      this.revision.set(updated.revision);
      this.saved.set(snapshot);
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && !this.isNew) this.conflict.set(true);
      else this.error.set(err?.message || tr('safebox.object.couldNotSaveIt', 'Could not save it'));
    } finally {
      this.busy.set(false);
    }
  }

  /** The title is the way back: to the page before when there is one in the app, otherwise to the list. */
  protected back(event: Event): void {
    event.preventDefault();
    if ((history.state?.navigationId ?? 1) > 1) {
      this.location.back(); // one step back: the page it was opened from (a new item made from an item replaces the pages of that flow, so that is the item)
      return;
    }
    const to = history.state?.backTo as string | undefined; // opened directly (a reload): the item it was made from, or the list
    void this.router.navigate((to ? this.service.openPath(this.friendId, to) : null) ?? this.list, { replaceUrl: true });
  }

  /** The item this new one is to be linked with ("Add a new item and link it"), taken when the page opens so no other new item can pick it up. */
  private linkFrom: string | null = this.isNew ? this.service.takeLinkFrom() : null;

  /** An item made from "Add a new item and link it": linked with the one it was made from. */
  private async linkNew(id: string, keys: BoxKeys): Promise<string | null> {
    const from = this.linkFrom;
    this.linkFrom = null;
    if (from) await this.service.addLink(this.friendId, from, id, keys).catch(() => undefined);
    return from;
  }

  protected async remove(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.service.remove(this.friendId, this.itemId!);
      this.service.forget(this.friendId, this.itemId!);
      await this.router.navigate(this.list, { replaceUrl: true });
    } catch (err: any) {
      this.error.set(err?.message || tr('safebox.common.couldNotTakeOut', 'Could not take it out'));
      this.busy.set(false);
    }
  }
}
