import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import { TRANSLOCO_MISSING_HANDLER, provideTransloco } from '@jsverse/transloco';
import { App } from './app';
import { routes } from './app.routes';
import { TranslocoHttpLoader } from './core/transloco-loader';
import { EmptyMissingHandler } from './core/transloco-missing.handler';
import { LANGUAGES } from './models/shared/languages';

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
});
