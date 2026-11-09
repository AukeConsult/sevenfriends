import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { Translation, TranslocoLoader } from '@jsverse/transloco';
import { of } from 'rxjs';
import { catchError } from 'rxjs/operators';

/**
 * Loads the texts of the app from `public/i18n/<language>/<scope>.json`.
 *
 * Transloco asks for a page's texts as "scope/language" (for example "setup/nb"), and for the texts that every page uses as just
 * "language": those are the `common` file. A file that cannot be read gives no texts, not an error, so the English text that every
 * template keeps next to its key is shown.
 */
@Injectable({ providedIn: 'root' })
export class TranslocoHttpLoader implements TranslocoLoader {
  private readonly http = inject(HttpClient);

  getTranslation(langOrScope: string) {
    const parts = langOrScope.split('/');
    const path = parts.length === 2 ? `/i18n/${parts[1]}/${parts[0]}.json` : `/i18n/${parts[0]}/common.json`;
    return this.http.get<Translation>(path).pipe(
      catchError((err) => {
        console.error('Could not load the texts', path, err);
        return of({});
      }),
    );
  }
}
