import { ActiveCircleService } from '../core/active-circle.service';
import { Component, computed, effect, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { LanguageService, deviceCountry } from '../core/language.service';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { InviteLinkService } from '../core/invite-link.service';
import { KeysService } from '../core/keys.service';
import { ProfileDetails, ProfilePicture, profileColorHex } from '../models';
import { FriendsService } from '../core/friends.service';
import { InstallService } from '../core/install.service';
import { NoticesService } from '../core/notices.service';
import { UiPreferencesService } from '../core/ui-preferences';
import { KeySetup } from '../key-setup/key-setup';
import { NoticeControls } from '../notice-controls/notice-controls';

/** The steps of the setup wizard, in order. */
type SetupStep = 'profile' | 'friend' | 'notify' | 'install' | 'key' | 'done';

/**
 * The setup wizard: only what a first start needs, the rest is in Settings (sounds, text size and theme, country and language, colour, the email check
 * (a bar on Home), microphone and camera (asked the first time they are used)). Three steps and an optional last one:
 * 1. about you (name, picture or icon), 2. the first friend, 3. notifications (and the app, where notifications need it; "hide the text of a message"
 * is switched on for a new account), then the key (24 secret words), which can be left for later.
 * - a computer browser: about you, the first friend, notifications, the key, then the app if it is not installed;
 * - a phone browser: about you, the first friend, then the app (notifications and the key follow in the app);
 * - inside the app (Android, Windows, a phone's home-screen app): notifications, the first friend (shown as done when there is one), the key.
 * "Finish" is always on the page; "Do it later" leaves the setup open (Home shows a "Finish setup" bar). A step that is already done is still shown,
 * marked as done. Home sends a new account here once, and a freshly installed app without a key.
 */
@Component({
  selector: 'app-setup',
  imports: [KeySetup, NoticeControls, TranslocoDirective],
  providers: [provideTranslocoScope('setup')],
  templateUrl: './setup.html',
})
export class Setup {
  protected readonly w = inject(ActiveCircleService).words;
  protected readonly install = inject(InstallService);
  protected readonly prefs = inject(UiPreferencesService);
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly api = inject(ApiService);
  private readonly lang = inject(LanguageService);
  private readonly auth = inject(AuthService);
  private readonly keys = inject(KeysService);
  private readonly notices = inject(NoticesService);
  /** I already have a friend: the last step says so and lets me finish */
  private readonly friendsService = inject(FriendsService);
  protected readonly hasFriends = computed(() => this.friendsService.friends().some((f) => f.status !== 'rejected'));
  protected readonly invite = inject(InviteLinkService);

  /** the steps shown (decided once, when the wizard opens, so a step does not vanish the moment it is done); null while that is worked out */
  protected readonly steps = signal<SetupStep[] | null>(null);
  private readonly index = signal(0);
  protected readonly step = computed<SetupStep | null>(() => this.steps()?.[this.index()] ?? null);
  protected readonly stepNumber = computed(() => this.index() + 1);
  protected readonly stepCount = computed(() => this.steps()?.length ?? 0);

  // ---- about you
  protected readonly name = signal('');
  protected readonly icon = signal<number | null>(null);
  protected readonly color = signal<string | null>(null);
  /** not asked in the wizard: the country of the device is saved (country and language are changed under Settings → Profile) */
  private readonly country = signal('');
  private readonly language = signal('');
  /** a photo from the sign-in (Google) or one uploaded earlier: then no icon is offered */
  protected readonly hasPhoto = signal(false);
  /** the picture shown while there is one (uploaded, or from the sign-in) */
  protected readonly photo = signal<string | null>(null);
  protected readonly icons = [1, 2, 3, 4, 5, 6, 7];
  /** the ring around my picture, in the chosen colour */
  protected readonly colorHex = computed(() => profileColorHex(this.color()));
  protected readonly initial = computed(() => (this.name().trim() || this.auth.user()?.email || '?')[0].toUpperCase());
  protected readonly saveProblem = signal<string | null>(null);

  /** the wizard opens for a new account: the text of its notifications is hidden unless the person says otherwise */
  private firstTime = false;

  constructor() {
    void this.open();
    effect(() => {
      if (this.step() === 'notify') void this.hideTextForNewAccount();
    });
  }

  /** Reads what is already done and decides which steps to show. */
  private async open(): Promise<void> {
    // until the wizard is finished, Home offers it again ("Finish setup"): leaving it any other way than "Finish" does not lose it
    this.firstTime = this.prefs.get('setup') === 'new';
    if (this.firstTime) this.prefs.set('setup', 'skipped');
    try {
      const me = await this.api.request<ProfileDetails>('/profile');
      this.name.set(me.name ?? '');
      this.icon.set(me.icon);
      this.color.set(me.color);
      this.country.set(me.country ?? deviceCountry() ?? ''); // none yet: the country of the browser, phone or computer (the person can change it)
      this.language.set(me.language ?? '');
      this.hasPhoto.set(me.hasPicture || !!this.auth.user()?.photoURL);
      this.photo.set(me.hasPicture ? ((await this.api.request<ProfilePicture>('/profile/picture').catch(() => null))?.image ?? null) : (this.auth.user()?.photoURL ?? null));
    } catch {
      /* offline: the steps are all shown, and saving tells what is wrong */
    }
    await Promise.race([this.keys.refresh(), new Promise((resolve) => setTimeout(resolve, 3000))]); // do not wait for ever on the key
    // Everything that can be done in the browser is done there first; then the app is installed and the setup continues in it (a key, a notification
    // permission and a microphone permission belong to the place they were made in). A step that is already done is still shown, marked as done.
    const steps: SetupStep[] = [];
    if (this.install.separateApp) {
      steps.push('notify', 'friend', 'key'); // in the app: only what belongs to this device
    } else if (this.install.mobile) {
      steps.push('profile', 'friend', 'install'); // a phone browser: the account steps, then the app; notifications and the key follow in the app
    } else {
      steps.push('profile', 'friend', 'notify', 'key', ...(this.install.installed() ? [] : (['install'] as SetupStep[]))); // a computer: all of it, the app last
    }
    if (!this.friendsService.circle()) await this.friendsService.load().catch(() => undefined); // opened directly: the friends are not loaded yet
    // coming back from choosing a sound: the wizard opens at that step again
    const back = steps.indexOf(this.route.snapshot.queryParamMap.get('step') as SetupStep);
    if (back > 0) this.index.set(back);
    void this.invite.load();
    this.steps.set(steps);
  }

  /** Saves the "about you" step: only what is filled in (an empty name keeps the old one). */
  protected async saveProfile(): Promise<void> {
    if (await this.saveAbout()) this.next();
  }

  /** The picture is made on its own page: what is typed here is saved first, and the page returns to this step. */
  protected async pickPicture(): Promise<void> {
    if (await this.saveAbout()) await this.router.navigate(['/profile/picture'], { queryParams: { setup: 1 } });
  }

  private async saveAbout(): Promise<boolean> {
    this.busy.set(true);
    this.saveProblem.set(null);
    try {
      const name = this.name().trim();
      await this.api.request<ProfileDetails>('/profile', {
        method: 'PUT',
        body: JSON.stringify({ ...(name ? { name } : {}), icon: this.icon(), color: this.color(), country: this.country() || null, language: this.language() || null }),
      });
      this.lang.useAccount(this.language(), this.country()); // the app changes language at once
      return true;
    } catch (err: any) {
      this.saveProblem.set(err?.message ?? tr('setup.saveFailed', 'Could not save. Try again, or choose "Do it later".'));
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  // ---- the first friend and the app
  /** the install step is part of this wizard */
  protected readonly installLast = computed(() => this.steps()?.includes('install') ?? false);

  /** the last step shown: its "Next" is "Finish" */
  protected readonly isLast = computed(() => this.index() >= this.stepCount() - 1);

  /** A phone browser, and the person does not want the app: the steps that belong to this device are done here in the browser. */
  protected continueInBrowser(): void {
    this.steps.update((list) => (list ? [...list, 'notify', 'key', 'done'] : list));
    this.next();
  }

  /** "Add a friend": on the add page, which returns to the wizard afterwards */
  protected addFriend(): void {
    void this.router.navigate(['/friends/add'], { queryParams: { setup: 1 } });
  }

  protected async installApp(): Promise<void> {
    await this.install.install();
  }

  /** The notification step: for a new account the text of a message is kept off the lock screen (the switch in the list can turn it back on). */
  protected async hideTextForNewAccount(): Promise<void> {
    if (!this.firstTime) return;
    this.firstTime = false;
    if (!this.notices.notices()) await this.notices.load();
    const now = this.notices.notices();
    if (now && !now.hideText) await this.notices.save({ ...now, hideText: true });
  }

  protected readonly busy = signal(false);

  protected next(): void {
    this.index.update((i) => Math.min(i + 1, this.stepCount() - 1));
  }

  /** the encryption key step: while the secret words are on the screen there is no way to leave it */
  private readonly keySetup = viewChild(KeySetup);
  protected readonly showingWords = computed(() => this.keySetup()?.showingWords() ?? false);

  /** "Do it later": Home offers the setup again. */
  protected later(): void {
    this.prefs.set('setup', 'skipped');
    void this.router.navigateByUrl('/');
  }

  protected finish(to: string): void {
    this.prefs.set('setup', 'done');
    void this.router.navigateByUrl(to);
  }
}
