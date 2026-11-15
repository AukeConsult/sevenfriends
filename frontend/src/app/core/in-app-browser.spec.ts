import { BrowserEnv, requiredBrowser } from './in-app-browser';

const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)';
const SAFARI_IPHONE = `${IPHONE} Version/17.4 Mobile/15E148 Safari/604.1`;
const HOME_SCREEN_IPHONE = `${IPHONE} Mobile/15E148`; // the app on the home screen: no "Safari" in its identity
const MESSENGER_IPHONE = `${IPHONE} Mobile/15E148 [FBAN/MessengerForiOS;FBAV/450.0;FBBV/1;FBDV/iPhone14,2;FBMD/iPhone;FBSN/iOS;FBSV/17.4;FBLC/en_US;FBOP/5]`;
const INSTAGRAM_IPHONE = `${IPHONE} Mobile/15E148 Instagram 320.0.0 (iPhone14,2; iOS 17_4)`;
const CHROME_IPHONE = `${IPHONE} Version/17.4 Mobile/15E148 CriOS/124.0 Safari/604.1`;
const FIREFOX_IPHONE = `${IPHONE} Mobile/15E148 FxiOS/125.0 Safari/605.1.15`;
const EDGE_IPHONE = `${IPHONE} Version/17.4 Mobile/15E148 EdgiOS/124.0 Safari/605.1.15`;
const WHATSAPP_IPHONE = `${IPHONE} Mobile/15E148`; // WhatsApp, Telegram, Signal, Gmail ...: a web view, so no Safari in its identity
const IPAD_AS_MAC = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

const ANDROID = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko)';
const CHROME_ANDROID = `${ANDROID} Chrome/124.0.0.0 Mobile Safari/537.36`;
const MESSENGER_ANDROID = `${ANDROID.replace('Android 14; Pixel 8', 'Android 14; Pixel 8; wv')} Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36 [FB_IAB/MESSENGER;FBAV/450.0]`;
const WEBVIEW_ANDROID = `${ANDROID.replace('Android 14; Pixel 8', 'Android 14; Pixel 8; wv')} Version/4.0 Chrome/124.0.0.0 Mobile Safari/537.36`;
const SAMSUNG_ANDROID = `${ANDROID} SamsungBrowser/24.0 Chrome/117.0.0.0 Mobile Safari/537.36`;
const FIREFOX_ANDROID = 'Mozilla/5.0 (Android 14; Mobile; rv:125.0) Gecko/125.0 Firefox/125.0';
const EDGE_ANDROID = `${CHROME_ANDROID} EdgA/124.0.0.0`;

const WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)';
const CHROME_WINDOWS = `${WINDOWS} Chrome/124.0.0.0 Safari/537.36`;
const EDGE_WINDOWS = `${CHROME_WINDOWS} Edg/124.0.0.0`;
const FIREFOX_WINDOWS = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:125.0) Gecko/20100101 Firefox/125.0';
const WINDOWS_APP = `${EDGE_WINDOWS} SevenFriendsWindows/1.0`;
const MAC_SAFARI = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15';

const env = (over: Partial<BrowserEnv> = {}): BrowserEnv => ({ native: false, standalone: false, touchMac: false, ...over });

/** An account is made, and signed in to, in the right browser only: Safari on iPhone / iPad, Chrome on Android, a real browser on Windows. */
describe('requiredBrowser: which browser a device must use', () => {
  describe('iPhone and iPad: Safari', () => {
    it('Safari is the right one', () => expect(requiredBrowser(SAFARI_IPHONE, env())).toBeNull());
    it('the app on the home screen is Safari too (it has no "Safari" in its identity, the page says it is standalone)', () => {
      expect(requiredBrowser(HOME_SCREEN_IPHONE, env({ standalone: true }))).toBeNull();
    });
    it('the browser inside Messenger or Instagram is NOT: Safari is required', () => {
      expect(requiredBrowser(MESSENGER_IPHONE, env())).toBe('safari');
      expect(requiredBrowser(INSTAGRAM_IPHONE, env())).toBe('safari');
    });
    it('a web view with no Safari in it (and not on the home screen) is NOT', () => {
      expect(requiredBrowser(HOME_SCREEN_IPHONE, env({ standalone: false }))).toBe('safari');
    });
    it('WhatsApp, Telegram, Signal, Gmail and any other app with a web view are NOT (they are caught without being named)', () => {
      expect(requiredBrowser(WHATSAPP_IPHONE, env())).toBe('safari');
      expect(requiredBrowser(`${WHATSAPP_IPHONE} WhatsApp/24.8.80`, env())).toBe('safari');
      expect(requiredBrowser(`${WHATSAPP_IPHONE} Telegram-iOS/10.9`, env())).toBe('safari');
    });
    it('Chrome, Firefox and Edge on an iPhone are NOT: Safari is required', () => {
      for (const ua of [CHROME_IPHONE, FIREFOX_IPHONE, EDGE_IPHONE]) expect(requiredBrowser(ua, env())).withContext(ua).toBe('safari');
    });
    it('an iPad (it says it is a Mac) is held to the same rule', () => {
      expect(requiredBrowser(IPAD_AS_MAC, env({ touchMac: true }))).toBeNull();
      expect(requiredBrowser(`${IPAD_AS_MAC} [FBAN/FBIOS]`, env({ touchMac: true }))).toBe('safari');
    });
    it('a real Mac with Safari is just a computer', () => expect(requiredBrowser(MAC_SAFARI, env())).toBeNull());
  });

  describe('Android: Chrome', () => {
    it('Chrome is the right one', () => expect(requiredBrowser(CHROME_ANDROID, env())).toBeNull());
    it('the browser inside Messenger and any other web view is NOT: Chrome is required', () => {
      expect(requiredBrowser(MESSENGER_ANDROID, env())).toBe('chrome');
      expect(requiredBrowser(WEBVIEW_ANDROID, env())).toBe('chrome');
    });
    it('WhatsApp, Telegram and every other app with a web view are NOT (a web view is marked as one)', () => {
      expect(requiredBrowser(`${WEBVIEW_ANDROID} WhatsApp/2.24`, env())).toBe('chrome');
      expect(requiredBrowser(`${WEBVIEW_ANDROID} Telegram-Android/10.9`, env())).toBe('chrome');
    });
    it('Samsung Internet, Firefox and Edge are NOT: Chrome is required', () => {
      for (const ua of [SAMSUNG_ANDROID, FIREFOX_ANDROID, EDGE_ANDROID]) expect(requiredBrowser(ua, env())).withContext(ua).toBe('chrome');
    });
    it('the Android app of Seven Friends (a web view, but our own) is always fine', () => {
      expect(requiredBrowser(WEBVIEW_ANDROID, env({ native: true }))).toBeNull();
    });
  });

  describe('Windows and the rest: a real browser', () => {
    it('Chrome, Edge and Firefox are all fine', () => {
      for (const ua of [CHROME_WINDOWS, EDGE_WINDOWS, FIREFOX_WINDOWS]) expect(requiredBrowser(ua, env())).withContext(ua).toBeNull();
    });
    it('the Windows app of Seven Friends is fine', () => expect(requiredBrowser(WINDOWS_APP, env())).toBeNull());
    it('a program with its own web view, or something that does not say it is a browser, is not a regular browser', () => {
      expect(requiredBrowser(`${CHROME_WINDOWS} Electron/30.0.0`, env())).toBe('browser');
      expect(requiredBrowser(`${CHROME_WINDOWS} Outlook/16.0`, env())).toBe('browser');
      expect(requiredBrowser('SomeProgram/1.0 (Windows NT 10.0)', env())).toBe('browser');
      expect(requiredBrowser('', env())).toBe('browser');
    });
    it('Opera, Vivaldi, Brave (says Chrome), Firefox on Linux and Safari on a Mac are regular browsers', () => {
      for (const ua of [`${CHROME_WINDOWS} OPR/110.0`, `${CHROME_WINDOWS} Vivaldi/6.7`, 'Mozilla/5.0 (X11; Linux x86_64; rv:125.0) Gecko/20100101 Firefox/125.0', MAC_SAFARI]) {
        expect(requiredBrowser(ua, env())).withContext(ua).toBeNull();
      }
    });
    it('the browser of another app (any known one) is not a browser', () => {
      expect(requiredBrowser(`${CHROME_WINDOWS} Instagram 320.0`, env())).toBe('browser');
      for (const app of ['WhatsApp/2.24', 'Telegram/5.0', 'Slack/4.38', 'Discord/1.0', 'Teams/1.6']) expect(requiredBrowser(`${CHROME_WINDOWS} ${app}`, env())).withContext(app).toBe('browser');
    });
  });
});

