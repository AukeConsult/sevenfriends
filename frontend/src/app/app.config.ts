import { provideHttpClient, withFetch } from '@angular/common/http';
import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { RouteReuseStrategy, TitleStrategy, provideRouter, withRouterConfig } from '@angular/router';

import { isDevMode } from '@angular/core';
import { TRANSLOCO_MISSING_HANDLER, provideTransloco } from '@jsverse/transloco';
import { LANGUAGES } from './models/shared/languages';
import { startLanguage } from './core/language.service';
import { TranslocoHttpLoader } from './core/transloco-loader';
import { EmptyMissingHandler } from './core/transloco-missing.handler';
import { routes } from './app.routes';
import { AppTitleStrategy } from './core/app-title.strategy';
import { FriendLinkService } from './core/friend-link.service';
import { ParamsRouteReuseStrategy } from './core/params-route-reuse.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAppInitializer(() => inject(FriendLinkService).capture()), // a friend link in the address is kept before the router can redirect it away
    provideRouter(routes, withRouterConfig({ paramsInheritanceStrategy: 'always' })), // the pages under a friend's page read the friend id of the address
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    { provide: RouteReuseStrategy, useClass: ParamsRouteReuseStrategy },
    provideHttpClient(withFetch()), // the texts of the app are files (public/i18n)
    provideTransloco({
      config: { availableLangs: LANGUAGES, defaultLang: startLanguage(), fallbackLang: 'en', reRenderOnLangChange: true, prodMode: !isDevMode() },
      loader: TranslocoHttpLoader,
    }),
    { provide: TRANSLOCO_MISSING_HANDLER, useClass: EmptyMissingHandler }, // a missing text is '' so the English text next to the key is shown
  ]
};
