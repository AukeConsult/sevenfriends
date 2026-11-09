# Notifications

## The push rules (all in one place)
1. **Delivery.** `sendPush(uid, ...)` in `functions/src/push.ts` sends through Firebase Cloud Messaging (Admin SDK, `sendEachForMulticast`) to EVERY device of the person: browsers and installed web apps by the Web Push protocol (HTTP, through the browser's own push service), Android by its native Firebase connection. It never throws; tokens FCM says are gone are removed. The Windows app has no push while it is closed.
2. **What is sent is decided by the account**, for all devices: a kind (`message`, `request`, `answer`, `removed`) switched off is not sent (the test push ignores that); "hide the text" sends "New message" instead of the text.
3. **Lifetime (TTL).** A push waits for a device that is off or offline for `PUSH_TTL_DAYS` (setting in `functions/.env`, default 28, 1 to 28; 0 = send no TTL and Firebase keeps it its own 4 weeks). Firebase never keeps one longer, there is no "forever". Web Push is sent with `Urgency: high`; Android with high priority. The same event id is shown once (the tag on the notification).
4. **ONE sound for everything.** The sound is the person's choice per kind, saved once on the account (`soundPreferences`), the same in every circle. The ids are in ONE list, `functions/src/models/shared/sounds.ts` (`SOUNDS`, `androidKeyOf`); the server names the Android channel `friends_<kind>_<androidKey>` from it, the Android app gets the same list as the generated `SoundIds.java` (`npm run sync:android-sounds`, run by itself before every frontend start / build / watch and before `android:sync` / `android:open`; `functions/test/sounds.test.ts` guards it). A choice saved under an older file name still finds its jingle by the name in it.
5. **A push plays that sound whatever circle it is about.** A device in the circle gets the text; a device in ANOTHER circle gets only "Activity in <circle>" (no text) with the SAME chosen message sound. Only "No sound" silences it. (A muted circle will be the one exception; not built.)
6. **Android:** the OS shows the push from the channel, so the app can be closed or hidden and the jingle still plays. The page stays quiet while the app is hidden and push is on (`pushCovers()`), or everything would sound twice. The page tells Android the sounds only once they are the person's own (chosen here or read from the account), never the defaults. A push for a channel the phone does not have is shown by Firebase's own "Miscellaneous" channel (no chosen sound): the app makes the channels at start and whenever the choice changes.
7. **Browser and installed web app:** the push is data only; the service worker (`public/firebase-messaging-sw.js`) shows it, except when a window of the app is visible AND focused: then the page shows it itself (sound, list, note for another circle). A browser notification can only play the system's default sound, or be silent (`silent: "1"` = "No sound"): it can NOT play the chosen jingle. Only the open page can, and only while the browser keeps the page running (after the first tap or key press; a frozen or discarded hidden tab hears nothing). A hidden tab that is still alive can give the page sound AND the system notification. Needs HTTPS, notification permission and a registered device; on iPhone only the installed web app.
8. **A tap** brings the app to the front and opens the page of the push (`?incircle=` for a push about the circle the app is in, `?opencircle=` for "Activity in <circle>", which switches the circle at once).

## What is sent
`functions/src/push.ts` `sendPush(uid, {id,title,body,url,kind})`. `kind` is `message`, `request`, `answer` or `removed`.

| Device | How it is shown |
|---|---|
| Web / installed web app | data-only FCM message (Web Push over HTTP), shown by `public/firebase-messaging-sw.js` (system sound or silent only, see rule 7) |
| Android app | FCM `notification` block with `channelId`; the OS shows it even when the app is closed |
| Windows app | the page shows a tray balloon while the app runs. WNS push (app closed) is NOT done: needs a Microsoft registration, MSIX packaging, a device kind in `push.ts` and WNS credentials |

## What the person chooses (saved on the account, holds for every device)
- `GET /preferences` returns `{sounds, notices}`; `PUT /preferences/notices` saves five booleans: `message`, `request`, `answer`, `removed`, `hideText`.
- A kind switched off is not sent (the test notification ignores this).
- `hideText` replaces a message body with "New message".
- Sound choice "none" uses the Android channel `silent` and sends `silent:"1"` for the web service worker.
- Android: a push is shown in channel `friends_<kind>_<sound>` (`friends_message_drill`, `friends_request_silent`, `friends_removed_default`...). There is ONE set of channels for the ONE app, whichever circle a push is about: one channel per kind, with the sound chosen in the app, so Android's own settings show the same four entries in one group. `push.ts` `channelFor` and `Channels.java` must match. `Channels.ensure` deletes the groups of the other circles that earlier versions made. Android never changes the sound of an existing channel, so when a sound changes, `Channels.sync` replaces the kind's channel by the one of the new sound (a kind switched off in Android stays off). The page tells the app the sounds at start, on change and on return (`android-channels.service.ts`). A push for a channel the phone does not have yet (sound changed on another device) lands in the `default` channel until the app is opened.

## Test
Settings -> "Send me a test notification" calls `POST /push/test` and shows how many devices were reached.

## Several circles
- The device tells the server which circle the app is in (`POST /push/devices { token, app, circle }` when it registers, `PUT /push/devices/circle { token, circle }` at every switch of circle: `PushService`). The server keeps it as `circleId` on the device.
- `sendPush` (push.ts): a device in the circle the push is about (or one that never told) gets the push as it is: the text, the sound the person chose for that kind, url with `?incircle=<type>` (if the app is not in that circle after all, it asks before switching). A device in ANOTHER circle gets only "Activity in <Circle>": no text, the person's own message sound (the ONE sound for all circles: the channel of the chosen message sound, silent only for No sound), url with `?opencircle=<type>`. A tap on it switches the app to that circle at once and opens the page (`CircleSwitch`). The switches (message / request / answer / removed) decide for both. The web app shows nothing for a push while it is in front (it hears every circle itself).
- The push text is still English: the backend texts are translated in the last step.

## Badge
`AttentionService` sets the app icon count (`navigator.setAppBadge`) from unread messages + waiting requests in the circle in use, plus one for each other circle with activity (the total across circles). The Android launcher shows its own dot for the notifications it has.

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
- The old channels (`silent`, `sound_*`, and the former fallback `default`) are deleted by `Channels.ensure`, so Android's list shows exactly the four kinds. The manifest names no default channel: every push names its kind's channel (a push for a channel the phone does not have yet is shown by Firebase's own "Miscellaneous" channel).

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
