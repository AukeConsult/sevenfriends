import { ActiveCircleService } from '../core/active-circle.service';
import { Component, computed, inject, signal, viewChild } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { TranslocoDirective, provideTranslocoScope } from '@jsverse/transloco';
import { tr } from '../core/i18n';
import { LanguageService, deviceCountry } from '../core/language.service';
import { ApiService } from '../core/api.service';
import { AuthService } from '../core/auth.service';
import { authMessage } from '../core/auth-errors';
import { InviteLinkService } from '../core/invite-link.service';
import { KeysService } from '../core/keys.service';
import { countries } from '../core/countries';
import { defaultLanguage, languagesFor } from '../models/shared/languages';
import { PROFILE_COLORS, ProfileDetails, ProfilePicture, profileColorHex } from '../models';
import { FriendsService } from '../core/friends.service';
import { InstallService } from '../core/install.service';
import { SoundService } from '../core/sound.service';
import { THEMES, UiPreferencesService } from '../core/ui-preferences';
import { KeySetup } from '../key-setup/key-setup';
import { NoticeControls } from '../notice-controls/notice-controls';

/** The steps of the setup wizard, in order. */
type SetupStep = 'profile' | 'email' | 'install' | 'notify' | 'sounds' | 'devices' | 'look' | 'key' | 'friend' | 'done';

/** a permission of the browser: allowed, blocked, or not asked yet */
type Permission = 'granted' | 'denied' | 'ask';

/**
 * The setup wizard: only what is needed for a first start, the rest stays in Settings. What can be done in the browser is done there first, then the
 * app is installed and the setup continues in it (a key and the notification and microphone permissions belong to the place they were made in):
 * - a computer browser: about you, verify the email, notifications, sounds, microphone and camera, text size and theme, the key, the first friend, install last;
 * - a phone browser: about you, verify the email, sounds, the first friend, then install (the rest follows in the app);
 * - inside the app (Android, Windows, a phone's home-screen app): notifications, microphone and camera, text size and theme, the key, done.
 * A step that is already done is still shown, marked as done, so "Next" just moves on. Home sends a new account here once (and offers it again while it is
 * "skipped"), and a freshly installed app without a key; every step can be left for later.
 */
@Component({
  selector: 'app-setup',
  imports: [KeySetup, NoticeControls, TranslocoDirective],
  providers: [provideTranslocoScope('setup')],
  templateUrl: './setup.html',
})
export class Setup {
  protected readonly w = inject(ActiveCircleService).words;
  protected readonly sounds = inject(SoundService);
  protected readonly install = inject(InstallService);
  protected readonly prefs = inject(UiPreferencesService);
  protected readonly themes = THEMES;
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);

  private readonly api = inject(ApiService);
  private readonly lang = inject(LanguageService);
  private readonly auth = inject(AuthService);
  private readonly keys = inject(KeysService);
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
  protected readonly country = signal('');
  /** the chosen language code, '' = the language of the country */
  protected readonly language = signal('');
  protected readonly languageChoices = computed(() => languagesFor(this.country()));
  protected readonly languageShown = computed(() => this.language() || defaultLanguage(this.country()));
  protected setCountry(country: string): void {
    this.country.set(country);
    if (!languagesFor(country).some((l) => l.code === this.language())) this.language.set(''); // a language this country does not offer is dropped
  }
  protected setLanguage(code: string): void {
    this.language.set(code === defaultLanguage(this.country()) ? '' : code); // the language of the country is not stored
  }
  /** a photo from the sign-in (Google) or one uploaded earlier: then no icon is offered */
  protected readonly hasPhoto = signal(false);
  /** the picture shown while there is one (uploaded, or from the sign-in) */
  protected readonly photo = signal<string | null>(null);
  protected readonly icons = [1, 2, 3, 4, 5, 6, 7];
  protected readonly colors = PROFILE_COLORS;
  /** the ring around my picture, in the chosen colour */
  protected readonly colorHex = computed(() => profileColorHex(this.color()));
  protected readonly initial = computed(() => (this.name().trim() || this.email() || '?')[0].toUpperCase());
  protected readonly countryList = countries();
  protected readonly saveProblem = signal<string | null>(null);

  // ---- verify the email
  protected readonly email = computed(() => this.auth.user()?.email ?? null);
  protected readonly emailSent = signal(false);
  protected readonly emailVerified = signal(false);
  protected readonly emailProblem = signal<string | null>(null);

  constructor() {
    void this.open();
  }

  /** Reads what is already done and decides which steps to show. */
  private async open(): Promise<void> {
    // until the wizard is finished, Home offers it again ("Finish setup"): leaving it any other way than "Finish" does not lose it
    if (this.prefs.get('setup') === 'new') this.prefs.set('setup', 'skipped');
    let verified = false;
    try {
      const me = await this.api.request<ProfileDetails>('/profile');
      this.name.set(me.name ?? '');
      this.icon.set(me.icon);
      this.color.set(me.color);
      this.country.set(me.country ?? deviceCountry() ?? ''); // none yet: the country of the browser, phone or computer (the person can change it)
      this.language.set(me.language ?? '');
      this.hasPhoto.set(me.hasPicture || !!this.auth.user()?.photoURL);
      this.photo.set(me.hasPicture ? ((await this.api.request<ProfilePicture>('/profile/picture').catch(() => null))?.image ?? null) : (this.auth.user()?.photoURL ?? null));
      verified = me.emailVerified;
    } catch {
      /* offline: the steps are all shown, and saving tells what is wrong */
    }
    this.emailVerified.set(verified);
    await Promise.race([this.keys.refresh(), new Promise((resolve) => setTimeout(resolve, 3000))]); // do not wait for ever on the key
    // Everything that can be done in the browser is done there first; then the app is installed and the setup continues in it (a key, a notification
    // permission and a microphone permission belong to the place they were made in). A step that is already done is still shown, marked as done.
    const steps: SetupStep[] = [];
    if (this.install.separateApp) {
      steps.push('notify', 'devices', 'look', 'key', 'friend'); // in the app: only what belongs to this device
    } else {
      steps.push('profile');
      if (this.email()) steps.push('email');
      if (this.install.mobile) steps.push('sounds', 'friend', 'install'); // a phone browser: the account steps, then install; the device steps follow in the app
      else steps.push('notify', 'sounds', 'devices', 'look', 'key', 'friend', ...(this.install.installed() ? [] : (['install'] as SetupStep[]))); // a computer: all of it, install last
    }
    if (!this.friendsService.circle()) await this.friendsService.load().catch(() => undefined); // opened directly: the friends are not loaded yet
    void this.sounds.loadJingles();
    void this.readDevices();
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

  // ---- install the app
  /** after the friend step: the install step when there is one, otherwise the wizard is finished */
  protected readonly installLast = computed(() => this.steps()?.includes('install') ?? false);

  /** A phone browser, and the person does not want the app: the steps that belong to this device are done here in the browser. */
  protected continueInBrowser(): void {
    this.steps.update((list) => (list ? [...list, 'notify', 'devices', 'look', 'key', 'done'] : list));
    this.next();
  }

  /** "Add a friend": on the add page; when the install step follows, that page returns to the wizard afterwards */
  protected addFriend(): void {
    if (this.installLast()) void this.router.navigate(['/friends/add'], { queryParams: { setup: 1 } });
    else this.finish('/friends/add');
  }

  /** "Next" (or "Finish") on the friend step */
  protected afterFriend(): void {
    if (this.installLast()) this.next();
    else this.finish('/');
  }

  protected async installApp(): Promise<void> {
    await this.install.install();
  }

  // ---- camera and microphone: asked now, from a tap, so the first photo or voice message does not have to
  protected readonly mic = signal<Permission>('ask');
  protected readonly cam = signal<Permission>('ask');

  private async readDevices(): Promise<void> {
    for (const [name, state] of [['microphone', this.mic], ['camera', this.cam]] as const) {
      try {
        const status = await navigator.permissions.query({ name: name as PermissionName });
        const read = () => state.set(status.state === 'prompt' ? 'ask' : status.state);
        read();
        status.onchange = read;
      } catch {
        /* the browser cannot say: the button just asks */
      }
    }
  }

  /** Asks for the microphone or the camera and lets go of it at once: only the permission is wanted. */
  protected async allow(kind: 'mic' | 'cam'): Promise<void> {
    const state = kind === 'mic' ? this.mic : this.cam;
    try {
      (await navigator.mediaDevices.getUserMedia(kind === 'mic' ? { audio: true } : { video: true })).getTracks().forEach((track) => track.stop());
      state.set('granted');
    } catch (err) {
      state.set((err as { name?: string }).name === 'NotAllowedError' ? 'denied' : 'ask');
    }
  }

  protected async sendEmail(): Promise<void> {
    this.emailProblem.set(null);
    try {
      await this.auth.sendVerificationEmail();
      this.emailSent.set(true);
    } catch (err) {
      this.emailProblem.set(authMessage(err, tr('setup.emailSendFailed', 'Could not send the email. Please try again.')));
    }
  }

  /** "I have opened the link": ask the server whether the email counts as verified now. */
  protected async checkEmail(): Promise<void> {
    this.emailProblem.set(null);
    try {
      await this.auth.refreshAccount();
      const me = await this.api.request<ProfileDetails>('/profile');
      this.emailVerified.set(me.emailVerified);
      if (!me.emailVerified) this.emailProblem.set(tr('setup.emailNotYet', 'Not verified yet. Open the link in the email we sent, then try again.'));
    } catch {
      this.emailProblem.set(tr('setup.emailCheckFailed', 'Could not check. Try again in a moment.'));
    }
  }
  protected readonly busy = signal(false);

  protected next(): void {
    this.sounds.stop();
    this.index.update((i) => Math.min(i + 1, this.stepCount() - 1));
  }

  /** the encryption key step: while the recovery words are on the screen there is no way to leave it */
  private readonly keySetup = viewChild(KeySetup);
  protected readonly showingWords = computed(() => this.keySetup()?.showingWords() ?? false);

  /** "Do it later": Home offers the setup again. */
  protected later(): void {
    this.sounds.stop();
    this.prefs.set('setup', 'skipped');
    void this.router.navigateByUrl('/');
  }

  protected finish(to: string): void {
    this.prefs.set('setup', 'done');
    void this.router.navigateByUrl(to);
  }
}
