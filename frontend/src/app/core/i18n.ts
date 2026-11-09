import { TranslocoService } from '@jsverse/transloco';

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
  return (translator?.translate(key, params) as string | undefined) || fallback.replace(/\{\{\s*(\w+)\s*\}\}/g, (_, name: string) => String(params?.[name] ?? ''));
}

/** The language the app is shown in now ('en' until the language service has started). */
export const activeLang = (): string => translator?.getActiveLang() ?? 'en';
