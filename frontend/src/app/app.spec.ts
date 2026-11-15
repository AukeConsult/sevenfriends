import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { TRANSLOCO_MISSING_HANDLER, provideTransloco } from '@jsverse/transloco';
import { App } from './app';
import { routes } from './app.routes';
import { TranslocoHttpLoader } from './core/transloco-loader';
import { EmptyMissingHandler } from './core/transloco-missing.handler';
import { LANGUAGES } from './models/shared/languages';
import { REQUIRED_BROWSER, RequiredBrowser } from './core/in-app-browser';

describe('App', () => {
  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [App],
      providers: [
        provideRouter(routes),
        provideHttpClient(),
        provideHttpClientTesting(), // the texts are files: no real request in a test
        provideTransloco({ config: { availableLangs: LANGUAGES, defaultLang: 'en', fallbackLang: 'en', prodMode: true }, loader: TranslocoHttpLoader }),
        { provide: TRANSLOCO_MISSING_HANDLER, useClass: EmptyMissingHandler },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(App);
    expect(fixture.componentInstance).toBeTruthy();
  });

  /** the browser is not the right one (Messenger's, Chrome on an iPhone ...) and nobody is signed in: the person sees only the page that says which browser to use */
  describe('in the wrong browser', () => {
    const open = async (need: RequiredBrowser | null, url = '/') => {
      TestBed.resetTestingModule();
      await TestBed.configureTestingModule({
        imports: [App],
        providers: [
          provideRouter(routes),
          provideHttpClient(),
          provideHttpClientTesting(),
          provideTransloco({ config: { availableLangs: LANGUAGES, defaultLang: 'en', fallbackLang: 'en', prodMode: true }, loader: TranslocoHttpLoader }),
          { provide: TRANSLOCO_MISSING_HANDLER, useClass: EmptyMissingHandler },
          { provide: REQUIRED_BROWSER, useValue: need },
        ],
      }).compileComponents();
      const fixture = TestBed.createComponent(App);
      fixture.detectChanges();
      void TestBed.inject(Router).navigateByUrl(url); // not waited for: the whole app never settles in a test (it asks the server, listens ...), and the decision is made at once
      await new Promise((resolve) => setTimeout(resolve, 100));
      fixture.detectChanges();
      return fixture.nativeElement as HTMLElement;
    };

    for (const need of ['safari', 'chrome', 'browser', 'home-screen'] as RequiredBrowser[]) {
      for (const url of ['/', '/login', '/login/email', '/welcome', '/welcome/friends', '/friends1']) {
        it('(' + need + ') ' + url + ': only the browser page, no sign-in page, no menu, no other page', async () => {
          const page = await open(need, url);
          expect(page.querySelector('app-in-app-notice')).not.toBeNull();
          expect(page.querySelector('router-outlet')).toBeNull();
          expect(page.querySelector('app-login, app-login-email, app-welcome, app-friends-welcome')).toBeNull();
          expect(page.querySelector('app-bottom-nav')).toBeNull();
          expect(page.querySelector('input[type="password"], input[type="email"]')).toBeNull();
        });
      }
    }

    it('in the right browser the app is as before: the pages are there, and the browser page is not', async () => {
      const page = await open(null, '/login');
      expect(page.querySelector('app-in-app-notice')).toBeNull();
      expect(page.querySelector('router-outlet')).not.toBeNull();
    });
  });
});
