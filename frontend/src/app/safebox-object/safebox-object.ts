import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from '@angular/core';
import type { Map as LeafletMap, Marker as LeafletMarker } from 'leaflet';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';
import { ApiError } from '../core/api.service';
import { FriendsService } from '../core/friends.service';
import { tr } from '../core/i18n';
import { SafeboxAttachments } from '../safebox-attachments/safebox-attachments';
import { SafeboxService } from '../core/safebox.service';
import { REMIND_DEFAULT, REMIND_LEADS, objectKind, remindAt, safeUrl } from '../core/safebox-objects';
import { UiPreferencesService } from '../core/ui-preferences';
import { FriendContext } from '../friend-page/friend-context';
import { CHECKLIST_ENTRIES_MAX, CHECKLIST_TEXT_MAX, ChecklistEntry, OBJECT_TITLE_MAX, ObjectField, ObjectKind, ObjectPayload, ReminderRequest, SAFEBOX_OBJECT_TYPES, SafeboxType } from '../models';

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
  imports: [RouterLink, SafeboxAttachments, TranslocoDirective],
  templateUrl: './safebox-object.html',
  providers: [provideTranslocoScope('safeboxObject')],
})
export class SafeboxObject {
  private readonly service = inject(SafeboxService);
  private readonly router = inject(Router);
  private readonly ctx = inject(FriendContext);
  private readonly prefs = inject(UiPreferencesService);
  private readonly friends = inject(FriendsService);
  private readonly route = inject(ActivatedRoute);

  protected readonly friendId = this.route.snapshot.paramMap.get('id') ?? '';
  protected readonly itemId = this.route.snapshot.paramMap.get('itemId');
  protected readonly isNew = this.itemId === null;
  protected readonly titleMax = OBJECT_TITLE_MAX;
  protected readonly entryMax = CHECKLIST_TEXT_MAX;
  protected readonly friendName = computed(() => this.friends.friends().find((f) => f.id === this.friendId)?.name ?? tr('safeboxObject.yourFriend', 'your friend'));

  /** the kind of this object (for a new one from the address, for an opened one when it has been read) */
  protected readonly type = signal<SafeboxType | null>(this.itemId === null ? ((this.route.snapshot.paramMap.get('type') as SafeboxType | null) ?? null) : null);
  protected readonly kind = computed<ObjectKind | undefined>(() => (this.type() && SAFEBOX_OBJECT_TYPES.includes(this.type()!) ? objectKind(this.type()!) : undefined));

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
  protected readonly leads = REMIND_LEADS.map((l) => ({ value: l.value, label: this.leadLabel(l.minutes) }));
  private readonly saved = signal('');
  private readonly revision = signal(0);
  protected readonly loading = signal(!this.isNew);
  protected readonly loadError = signal<string | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);
  protected readonly conflict = signal(false);
  protected readonly confirmDelete = signal(false);
  protected readonly keyStatus = this.ctx.keyStatus;
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
      this.error.set(tr('safeboxObject.noLocation', 'This device cannot tell where it is.'));
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
        this.error.set(tr('safeboxObject.couldNotLocate', 'Could not get your position. Allow the location for this app and try again.'));
        this.locating.set(false);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 },
    );
  }

  /** The place is at this position (from a tap, a drag, this device or a search). The address is filled in from the position (best effort) when it is empty or came from the map earlier; one you typed stays. */
  private setPoint(lat: number, lng: number, fromMap: boolean, address?: string): void {
    this.fromMap = fromMap;
    this.values.update((v) => ({ ...v, lat: lat.toFixed(6), lng: lng.toFixed(6), ...(address !== undefined ? { address } : {}) }));
    if (address !== undefined) this.autoAddress = true;
    else if (!(this.values()['address'] ?? '').trim() || this.autoAddress) void this.addressOf(lat, lng);
  }

  /** The address of a position, from OpenStreetMap's reverse lookup; written in only while the address is empty or was itself filled in from the map. */
  private async addressOf(lat: number, lng: number): Promise<void> {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${lat}&lon=${lng}`, { headers: { Accept: 'application/json' } });
      if (!res.ok) return;
      const name = ((await res.json()) as { display_name?: string }).display_name;
      if (name && (!(this.values()['address'] ?? '').trim() || this.autoAddress)) {
        this.autoAddress = true;
        this.values.update((v) => ({ ...v, address: name.slice(0, 500) }));
      }
    } catch {
      /* the address can be written by hand */
    }
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
      this.error.set(tr('safeboxObject.couldNotSearch', 'Could not search for places right now.'));
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
    if (minutes === null) return tr('safeboxObject.noReminder', "Don't remind me");
    if (minutes === 0) return tr('safeboxObject.atTheTime', 'At the time');
    if (minutes < 60) return tr('safeboxObject.minutesBefore', '{{ n }} minutes before', { n: minutes });
    if (minutes < 1440) return minutes === 60 ? tr('safeboxObject.oneHourBefore', '1 hour before') : tr('safeboxObject.hoursBefore', '{{ n }} hours before', { n: minutes / 60 });
    return minutes === 1440 ? tr('safeboxObject.oneDayBefore', '1 day before') : minutes === 10080 ? tr('safeboxObject.oneWeekBefore', '1 week before') : tr('safeboxObject.daysBefore', '{{ n }} days before', { n: minutes / 1440 });
  }

  /** Open / call / write / map links for what is filled in. */
  protected readonly actions = computed<ObjectAction[]>(() => {
    const v = this.values();
    const out: ObjectAction[] = [];
    switch (this.type()) {
      case 'link': { const url = safeUrl(v['url'] ?? ''); if (url) out.push({ label: tr('safeboxObject.openTheLink', 'Open the link'), href: url, external: true }); break; }
      case 'place': { const q = this.mapQuery(); if (q) out.push({ label: tr('safeboxObject.openInMaps', 'Open in Maps'), href: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`, external: true }); break; }
      case 'contact': {
        const phone = (v['phone'] ?? '').replace(/[^\d+]/g, '');
        if (phone) out.push({ label: tr('safeboxObject.call', 'Call'), href: `tel:${phone}`, external: false });
        const email = (v['email'] ?? '').trim();
        if (/^[^\s@]+@[^\s@]+$/.test(email)) out.push({ label: tr('safeboxObject.writeAnEmail', 'Write an email'), href: `mailto:${email}`, external: false });
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
      this.values(); // the pin follows the position
      this.showPin();
    });
    inject(DestroyRef).onDestroy(() => this.map?.remove());
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
      this.error.set(tr('safeboxObject.couldNotCopy', 'Could not copy. Select the text and copy it by hand.'));
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
      this.loadError.set(err?.message || tr('safeboxObject.couldNotOpenIt', 'Could not open it'));
    } finally {
      this.loading.set(false);
    }
  }

  protected loadTheirs(): void {
    void this.open(true);
  }

  protected async save(): Promise<void> {
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
    try {
      if (this.isNew) {
        const keys = this.ctx.boxKeys();
        if (!keys) throw new Error(tr('safeboxObject.theKeysAreNot', 'The keys are not known yet. Try again in a moment.'));
        const created = await this.service.addObject(this.friendId, kind.type, payload, keys, remind);
        this.prefs.set('boxHidden', this.prefs.value('boxHidden')().filter((k) => k !== kind.type));
        // the files chosen before saving go to the new object now; if one fails, the object is open so the rest can be added again
        if (await this.attachments()?.uploadPending(created.id)) {
          await this.router.navigate(['/friends', this.friendId, 'safebox', 'object', created.id], { replaceUrl: true });
          return;
        }
      } else {
        await this.service.updateObject(this.friendId, this.itemId!, payload, this.revision(), remind);
      }
      await this.router.navigate(this.list, { replaceUrl: true });
    } catch (err: any) {
      if (err instanceof ApiError && err.status === 409 && !this.isNew) this.conflict.set(true);
      else this.error.set(err?.message || tr('safeboxObject.couldNotSaveIt', 'Could not save it'));
    } finally {
      this.busy.set(false);
    }
  }

  protected async remove(): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.service.remove(this.friendId, this.itemId!);
      this.service.forget(this.friendId, this.itemId!);
      await this.router.navigate(this.list, { replaceUrl: true });
    } catch (err: any) {
      this.error.set(err?.message || tr('safeboxObject.couldNotTakeIt', 'Could not take it out'));
      this.busy.set(false);
    }
  }
}
