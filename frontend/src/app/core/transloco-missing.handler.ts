import { TranslocoConfig, TranslocoMissingHandler } from '@jsverse/transloco';

/**
 * A text that is missing gives '' (not the key, which Transloco gives by default).
 *
 * Every template writes `{{ t('setup.title') || 'Set up your profile' }}`: the English text sits next to the key. The key itself is
 * a text that is never empty, so with the default handler the `||` would never use the English text and the page would show
 * "setup.title". With '' the English text is shown for a language, a file or a key that does not exist yet.
 */
export class EmptyMissingHandler implements TranslocoMissingHandler {
  handle(key: string, config: TranslocoConfig): string {
    if (!config.prodMode) console.warn(`[i18n] missing text: ${key}`);
    return '';
  }
}
