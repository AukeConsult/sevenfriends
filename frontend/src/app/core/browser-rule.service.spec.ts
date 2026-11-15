import { TestBed } from '@angular/core/testing';
import { BrowserRuleService } from './browser-rule.service';
import { REQUIRED_BROWSER, RequiredBrowser } from './in-app-browser';

/** Is this place the wrong one to make an account in? The one exception: an iPhone Safari tab, where the person may choose to go on in Safari. */
describe('BrowserRuleService', () => {
  const make = (need: RequiredBrowser | null) => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ providers: [{ provide: REQUIRED_BROWSER, useValue: need }] });
    return TestBed.inject(BrowserRuleService);
  };
  beforeEach(() => localStorage.removeItem('sf-ui'));
  afterEach(() => localStorage.removeItem('sf-ui'));

  it('the right browser: nothing blocks', () => {
    expect(make(null).blocking()).toBe(false);
  });

  it('every wrong place blocks, an iPhone Safari tab too, until the person chooses', () => {
    for (const need of ['safari', 'chrome', 'browser', 'home-screen'] as RequiredBrowser[]) expect(make(need).blocking()).withContext(need).toBe(true);
  });

  it('"Continue in Safari instead" lifts the block for an iPhone Safari tab, and the choice is kept on the device', () => {
    const rule = make('home-screen');
    rule.continueInSafari();
    expect(rule.blocking()).toBe(false);
    expect(make('home-screen').blocking()).toBe(false); // a new start of the app: the choice is still there
  });

  it('the choice lifts nothing else: Messenger\'s browser, Chrome on an iPhone, Android and Windows stay blocked', () => {
    make('home-screen').continueInSafari();
    for (const need of ['safari', 'chrome', 'browser'] as RequiredBrowser[]) expect(make(need).blocking()).withContext(need).toBe(true);
  });
});
