import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners, provideZoneChangeDetection } from '@angular/core';
import { RouteReuseStrategy, TitleStrategy, provideRouter } from '@angular/router';

import { routes } from './app.routes';
import { AppTitleStrategy } from './core/app-title.strategy';
import { FriendLinkService } from './core/friend-link.service';
import { ParamsRouteReuseStrategy } from './core/params-route-reuse.strategy';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZoneChangeDetection({ eventCoalescing: true }),
    provideAppInitializer(() => inject(FriendLinkService).capture()), // a friend link in the address is kept before the router can redirect it away
    provideRouter(routes),
    { provide: TitleStrategy, useClass: AppTitleStrategy },
    { provide: RouteReuseStrategy, useClass: ParamsRouteReuseStrategy },
  ]
};
