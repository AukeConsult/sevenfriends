import { inject, signal, Signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { TranslocoService } from '@jsverse/transloco';
import { filter } from 'rxjs';

type Params = Record<string, unknown>;

let translator: TranslocoService | null = null;

/** Called once by the LanguageService, so code that is not a component (auth-errors, time-ago, ...) can translate too. */
export function registerTranslator(service: TranslocoService): void {
  translator = service;
}

/**
 * The text for a key in the language of the app, or the English `fallback` when there is none (the file is not loaded yet, or the
 * key is not translated). The same `key || 'English'` rule as in the templates, for TypeScript.
 */
export function tr(key: string, fallback: string, params?: Params): string {
  const english = () => fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params?.[name] ?? ''));
  if (!translator || !isLoaded(translator, key)) return english(); // the file of this part is not loaded yet (a text read while the app starts): the English text, no warning
  return (translator.translate(key, params) as string | undefined) || english();
}

/** The part of the file a key belongs to (`safebox.common.file` -> `safebox`) is loaded for the language of the app. */
function isLoaded(service: TranslocoService, key: string): boolean {
  try {
    const loaded = service.getTranslation(service.getActiveLang()) as Record<string, unknown> | undefined;
    return !!loaded && key.split('.')[0] in loaded;
  } catch {
    return false;
  }
}

/** The language the app is shown in now ('en' until the language service has started). */
export const activeLang = (): string => translator?.getActiveLang() ?? 'en';

/**
 * A signal that changes each time a language file has been loaded. A text that is made once (a list of kinds with their names) and read through `tr()` while the
 * file is still on its way would stay English; a `computed` that reads this signal is made again when the file arrives. Call it in a field of a component.
 */
export function translationsLoaded(): Signal<number> {
  const tick = signal(0);
  inject(TranslocoService)
    .events$.pipe(filter((event) => event.type === 'translationLoadSuccess'), takeUntilDestroyed())
    .subscribe(() => tick.update((n) => n + 1));
  return tick;
}
