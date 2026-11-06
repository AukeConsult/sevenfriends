# Notifications

## What is sent
`functions/src/push.ts` `sendPush(uid, {id,title,body,url,kind})`. `kind` is `message`, `request`, `answer` or `removed`.

| Device | How it is shown |
|---|---|
| Web / installed web app | data-only FCM message, shown by `public/firebase-messaging-sw.js` |
| Android app | FCM `notification` block with `channelId`; the OS shows it even when the app is closed |
| Windows app | the page shows a tray balloon while the app runs. WNS push (app closed) is NOT done: needs a Microsoft registration, MSIX packaging, a device kind in `push.ts` and WNS credentials |

## What the person chooses (saved on the account, holds for every device)
- `GET /preferences` returns `{sounds, notices}`; `PUT /preferences/notices` saves five booleans: `message`, `request`, `answer`, `removed`, `hideText`.
- A kind switched off is not sent (the test notification ignores this).
- `hideText` replaces a message body with "New message".
- Sound choice "none" uses the Android channel `silent` and sends `silent:"1"` for the web service worker.
- Android: a push is shown in channel `<kind>_<sound>` (`message_drill`, `request_silent`, `removed_default`...). There is ONE channel per kind, with the sound chosen in the app, so Android's own settings show the same four entries. `push.ts` `channelFor` and `Channels.java` must match. Android never changes the sound of an existing channel, so when a sound changes, `Channels.sync` replaces the kind's channel by the one of the new sound (a kind switched off in Android stays off). The page tells the app the sounds at start, on change and on return (`android-channels.service.ts`). A push for a channel the phone does not have yet (sound changed on another device) lands in the `default` channel until the app is opened.

## Test
Settings -> "Send me a test notification" calls `POST /push/test` and shows how many devices were reached.

## Badge
`AttentionService` sets the app icon count (`navigator.setAppBadge`) from unread messages + waiting requests.

## Not done
Sleep / quiet hours handling (postponed); Windows WNS.

## The Android screen
Inside the Android app, Settings has "Open the notification screen" and "Android's own settings".
- `NativeNotices.java` is a dialog with the same five switches and a test button. It holds no data and no sign-in.
- The page (`settings.ts`) is the only owner: it calls `SevenFriendsAndroid.open(json)`; the dialog hands every change back through `window.sfNotices.set(json)` / `test()`; the page saves with `PUT /preferences/notices` and answers with `saved(ok, json)` / `tested(text)`. A failed save puts the switch back.
- "Android's own settings" opens the system page for the app: notifications allowed, and sound / importance of each channel.
- A new notification choice must be added in both `settings.html` and `NativeNotices.java` (`KEYS`, `LABELS`).
- Not compiled here: build with `.\gradlew assembleDebug` (or `publishApk`) in `android/`.

### Android settings and the account
- The account switches decide what the server sends (all devices). Android's switches (group or channel) decide what this phone shows.
- An app cannot switch a channel back on. Under each switch the native screen shows what Android has for this phone ("on · sound: Drill" or "OFF"), and a tap opens that channel's page in Android. It refreshes when the app is resumed.
- The old channels (`silent`, `sound_*`) are deleted by `Channels.ensure`; `default` stays as the manifest's fallback.

### The check bar (Android)
A dark bar at the top of the Android app ("Seven Friends · Android", button **Notifications**) opens `NativeCheck.java`: a plain report that the Java code reads from Android itself, with no web page or bridge involved: notifications allowed, per kind the channel / on or OFF / sound, all channels, and what the web page last told the app (`Channels.sync`; "never" = the bridge call from the page has not arrived). Remove the bar with `CHECK_BAR = false` in `MainActivity.java`.

The check screen also has **Send this to the app**: Java reads each kind (on / off) from Android, calls `window.sfAndroid.fromAndroid(json)`; the page (`android-channels.service.ts`) loads the account's choices, replaces the four kinds, keeps "hide text", saves with `PUT /preferences/notices` (`NoticesService`) and answers `SevenFriendsAndroid.pushed(ok, text)`, which the screen shows. So the account stores it as it does for a switch on the Settings page.

### Debug builds read the web app fresh
`MainActivity.loadFresh()`: when the app is a debug build (Android Studio, and `publishApk` which makes a debug APK), the WebView cache and the service worker cache are emptied and not used, and the page is reloaded at start, so a deployed change shows at once. Sign-in and stored settings are kept. A release build keeps the normal cache.

### "Notify this device" on the Android screen
The native notification screen starts with the same switch as the Settings page. It calls `window.sfAndroid.device(on)`; the page (`android-channels.service.ts`) runs `PushService.setEnabled(on)` (asks the phone's permission, registers or forgets the device token on the server) and answers `SevenFriendsAndroid.deviceSet(enabledNow, problem)`, so the switch shows the real state and a refusal (permission blocked) is written under it.

### The check form and the volume
`NativeCheck.java` is a form of cards with labelled fields (This phone: Android version, notifications allowed, **notification volume** as % with a bar; one card per kind: channel, state, importance, sound; all channels; what the page last told). "Send this to the app" also sends `volume` (the phone's notification volume, `AudioManager.STREAM_NOTIFICATION`); the page keeps it in `AndroidChannelsService.phoneVolume` and Settings shows it under the Volume card. It is only shown, not stored on the account. Android has no microphone volume to read.

### The check form reads the app's push settings too
The card **In the app (push settings)** is asked from the page: `NativeNotices.readApp()` calls `window.sfAndroid.read()`, the page (`android-channels.service.ts`, `readOut`) loads the account's choices and answers `SevenFriendsAndroid.appState(json)` with `{device, notices, sounds, volume}`. The card shows "Notify this device", each kind on/off with its sound, "hide the text" and the app's volume. A kind that is on in the app but OFF in Android (or the reverse) is marked in red. "No answer from the app page" after 10 s = the bridge call did not arrive.

### One form for the Android check (final layout)
`NativeCheck.java`: **This phone** (Android version, allowed, notification volume, and **Notify this device** with a button that turns it on or off through the page: `NativeNotices.setDevice` -> `sfAndroid.device` -> `PushService.setEnabled` -> `deviceSet`), one card per kind with *In the app* next to *Android* (a difference is marked, and a tap on the card opens Android's page for it), **Other** (hide text, app volume, when the page last told Android), and **Send to the app**. On the Settings page of the Android app the "Notify this device" switch is replaced by a button to this screen.

### Android and the app always agree
The check form shows ONE value per kind (Android's; the app follows). Whatever Android has is stored in the app (`PUT /preferences/notices`, through the page) when the form is closed and when the Android app is resumed (e.g. back from Android's settings). `NativeNotices.pushToApp` skips the request when the on/off state is the same as the last one the page stored (`lastPushed`).

### Compact check form
At the top: **Set in Android** (Android's notification page for the app). Then one card **Notifications** with a line per kind ("On · Hyper" / "OFF · ..."; a tap opens that kind in Android), then one card **This phone** (allowed, notification volume with bar, Notify this device with a Turn on/off button, hide text, app volume, when the page last told Android).

### The Settings page inside the Android app
In the Android app the Settings page keeps only the Sounds section (volume and the sound of each kind). Everything else (which kinds, "Notify this device", hide the text, test notification) is set on the notification screen of the app (`NativeCheck.java`), opened by the button on the page (`SevenFriendsAndroid.openCheck()`) or by the bar at the top of the app. That screen asks the page for what it needs and the page does the saving: `window.sfAndroid` = `read`, `device`, `hideText`, `test`, `fromAndroid` (`android-channels.service.ts`, using `NoticesService` and `PushService`). In the browser the page is unchanged.

### The app's volume follows the phone's notification volume (Android)
`pushToApp` sends the notification volume (0-100) together with the on/off state of the kinds; the request is skipped only when both are the same as last time. The page stores the kinds and calls `SoundService.setVolume(volume)`, which saves the app's volume on the account like the slider does. On the Android app the Volume card of the Settings page is therefore read-only (a bar). Note: the app's own sounds are played as media, so the media volume of the phone still applies on top of this percentage.

### Languages of the Android screens
The texts of the Java screens (`NativeCheck`, `Channels`, the bar in `MainActivity`) are in `android/app/src/main/res/values/strings.xml` (English, also the fallback) and translated in `values-nb` (Norwegian bokmål), `values-fr` and `values-es`. Android uses the language of the phone; on Android 13+ the person can also pick a language for this app in the phone's settings (`res/xml/locales_config.xml`, `android:localeConfig` in the manifest). The names of the notification channels follow the language too (`Channels.ensure` renames existing channels at start). To add a language: copy `values/strings.xml` to `values-<code>/`, translate it, and add the code to `locales_config.xml`. Texts that come from the web page (the result of the test, the reason a phone could not be registered) are still English: the web app has no translations yet.
