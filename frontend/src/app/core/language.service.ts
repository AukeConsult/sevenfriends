import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { TranslocoService } from '@jsverse/transloco';
import { countries } from './countries';
import { defaultLanguage, isLanguage, languagesFor } from '../models/shared/languages';
import { ApiService } from './api.service';
import { AuthService } from './auth.service';
import { registerTranslator } from './i18n';
import { UiPreferencesService } from './ui-preferences';

/** The languages that are written from right to left. */
export const RTL_LANGUAGES: readonly string[] = ['ar'];

/** The browser's own codes for languages that have another code here (Norwegian Bokmål and Nynorsk are `nb`). */
const BROWSER_ALIASES: Record<string, string> = { no: 'nb', nn: 'nb' };

/**
 * The country of this device, for an account that has none: the region of the language the browser, the phone (Android, iPhone) or the
 * computer (Windows) is set to, for example `nb-NO` gives `NO`. The web view of the Android, iPhone and Windows apps reports the language
 * of the device in the same way. null when no region is set (a plain `en` or `nb`) or the country is not in the list of the app.
 */
export function deviceCountry(): string | null {
  const known = new Set(countries().map((c) => c.code));
  const tags = [...(navigator.languages ?? []), navigator.language, Intl.DateTimeFormat().resolvedOptions().locale];
  for (const tag of tags) {
    try {
      const region = tag ? new Intl.Locale(tag).region : undefined;
      if (region && known.has(region)) return region;
    } catch {
      /* not a language tag: the next one */
    }
  }
  return null;
}

/** The language of the browser or device (`nb-NO` gives `nb`), if the app has it. */
function deviceLanguage(): string | null {
  const code = (navigator.language || '').split('-')[0].toLowerCase();
  const mapped = BROWSER_ALIASES[code] ?? code;
  return isLanguage(mapped) ? mapped : null;
}

/**
 * The language to start in, before anything is known about the person: the one chosen on this device (UiPreferences, read straight
 * from storage because this runs before the app starts), else the browser's, else English.
 */
export function startLanguage(): string {
  try {
    const saved = (JSON.parse(localStorage.getItem('sf-ui') ?? 'null') as { language?: unknown } | null)?.language;
    if (typeof saved === 'string' && isLanguage(saved)) return saved;
  } catch {
    /* storage not available or damaged: the browser's language is used */
  }
  const browser = (navigator.language || 'en').split('-')[0].toLowerCase();
  const code = BROWSER_ALIASES[browser] ?? browser;
  return isLanguage(code) ? code : 'en';
}

/**
 * The language of the texts of the app, in this order: the language on the account, else the language of the account's country
 * (`defaultLanguage`), else what this device remembers, else the browser's, else English. Signed in, the profile is read and the
 * language follows it; a change in Profile or Setup calls `useAccount` so the app changes language at once. The page's `lang` and
 * `dir` follow the language, and the language is remembered on this device so the next start (and the sign-in pages) use it at once.
 */
@Injectable({ providedIn: 'root' })
export class LanguageService {
  private readonly transloco = inject(TranslocoService);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly prefs = inject(UiPreferencesService);

  /** the language shown now (for `Intl` and date formats) */
  readonly lang = signal(startLanguage());

  constructor() {
    registerTranslator(this.transloco);
    this.apply(this.lang());
    effect(() => {
      const user = this.auth.user();
      untracked(() => {
        if (user) void this.pull();
      });
    });
  }

  /** The language the account has (or its country's), read from the profile. */
  private async pull(): Promise<void> {
    try {
      const profile = await this.api.request<{ language?: string | null; country?: string | null }>('/profile');
      this.useAccount(profile.language ?? '', profile.country ?? '');
    } catch {
      /* not reachable now: the language of this device stays */
    }
  }

  /**
   * The account's language and country as saved: the chosen language, or the country's when none is chosen. An account with no country
   * uses the country of the device (see `deviceCountry`): the language of the device when that country offers it, else the country's own.
   */
  useAccount(language: string | null, country: string | null): void {
    if (language && isLanguage(language)) return this.use(language);
    if (country) return this.use(defaultLanguage(country));
    const where = deviceCountry();
    if (!where) return this.use(deviceLanguage() ?? this.lang());
    const own = deviceLanguage();
    this.use(own && languagesFor(where).some((l) => l.code === own) ? own : defaultLanguage(where));
  }

  /** Shows the app in this language and remembers it on this device. */
  use(code: string): void {
    if (!isLanguage(code)) return;
    this.apply(code);
    this.prefs.set('language', code);
  }

  private apply(code: string): void {
    this.lang.set(code);
    this.transloco.setActiveLang(code);
    document.documentElement.lang = code;
    document.documentElement.dir = RTL_LANGUAGES.includes(code) ? 'rtl' : 'ltr';
  }
}
