# Poke: a forced alarm on the phone

A **poke** makes a friend's phone ring like an alarm: loud, over the lock screen, until the person stops it, whatever their sound or notification settings say. This file is the one place that describes it: the rules (all platforms), what is built on Android, and the plan for iPhone (not built).

## The rules (the same on every platform, decided)
1. **A poke is a message sent with `poke: true`.** The sender taps the **🔔 Poke** button in the header of the friend's page (a separate function, on every page of the friend, not in the writing field). It opens an expandable frame under the header (`PokeFrame`, `friend-page/poke-frame.ts`) that says "This rings <name>'s phone like an alarm, even when it is silent" with **Cancel** and **Send poke**. The frame also says, in one line, that for now a poke rings like an alarm on Android phones and in the Windows app (`friendPage.pokeNote`; change the line when the iPhone alarm is built). Send poke sends a normal message with the text 🔔 (locked like any message) and `poke: true`; it shows in both feeds.
2. **Only a friend who has a seat for me can poke me.** The seat is the consent: a person agrees to be poked by putting me on their list of 7; nothing is asked per poke, and no one who has not accepted me (a request, the waiting list) or who has me on the sleep list can poke. If I have the sender on my **sleep list**, their poke is ignored: the message arrives quietly like their other messages (no push, no sound, not stored as a poke). The server enforces it (`conversation.ts`: `poked` is false when the receiver's entry is `asleep`); the button is only shown for a confirmed friend who has a seat for me (`FriendContext.canPoke`: `status === 'confirmed'` and not `sleepsMe`); for a friend who has me on their sleep list the header already says so. A poke is only possible inside a confirmed friendship, like every message.
3. **No switch.** The receiver cannot turn pokes off: not the notification switches, not "No sound", not a setting for the friend. (If this ever has to change, it is a product decision: the stores look closely at an app that can force a phone to ring, see "Store review" below.)
4. **It always says who.** The alarm shows the sender's name (`name · group` for a group) and the text of the message. A poke about another circle than the one the app is in still names the sender (an ordinary push for another circle only says "Activity in ...").
5. **It is short lived.** A poke that cannot be delivered within **10 minutes** (phone off or offline) is dropped: an alarm an hour late is worse than none. An alarm rings until stopped, or at most **2 minutes**.
6. **Stop, or Open.** Stop silences it. Open silences it and opens that friend's page.

## What the server sends (`functions/src/push.ts`)
`sendPush(uid, { ..., poke: true })`:
- It is sent whatever `noticePreferences` and the sound choice say (`!push.force && !push.poke && !notices[kind]`), and never `silent`.
- The data carries `poke: "1"`, `title` (the sender), `body` (the text; if the receiver chose "hide the text on the lock screen" it is "New message", as for any message: that setting still holds, the sender's name does not hide), `url` (the friend's page), `id`, `circle`.
- **Android:** no `notification` block, only the data, `priority: "high"`, `ttl` 10 minutes (`POKE_TTL_SECONDS`). Only a data message runs the app's own code while the app is closed.
- **Web and iPhone** today: the ordinary push (alert with sound), also with the 10 minute expiry (the same `ttl` is used for `apns-expiration`).

## Android (built)
Files in `client-wrappers/android/app/src/main/`:
- `PokeMessagingService.java` extends the Capacitor push plugin's `MessagingService`; for `poke=1` it starts `PokeService`, everything else goes to the plugin. The manifest removes the plugin's own service (`tools:node="remove"`). `app/build.gradle` adds `firebase-messaging` (the plugin keeps it private).
- `PokeService.java`: a foreground service (`mediaPlayback`) that loops the phone's alarm sound with `USAGE_ALARM`, raises the alarm volume to the maximum and puts it back, vibrates, and shows a high-priority notification (channel `poke_alarm`, `setBypassDnd(true)`, category alarm) with a full-screen intent and a Stop button. It stops after 2 minutes and tells the screen to close (`POKE_DONE` broadcast).
- `PokeActivity.java`: shown over the lock screen, turns the screen on; the sender's name big, the text, **Stop** and **Open**.
- Manifest: `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_MEDIA_PLAYBACK`, `USE_FULL_SCREEN_INTENT`, `VIBRATE`. Texts in `res/values*/strings.xml` (`poke_*`: English, Norwegian, French, Spanish).
- Known limits: from Android 14 a full-screen screen over the lock screen may need the person to allow it in the app's settings (the sound and the notification still work); Do Not Disturb is only bypassed when the person has given Do Not Disturb access; phone makers' battery savers can delay a push (the person may have to exempt the app).
- Not tested on a phone yet.

## Windows (built, compiles, not tried on a PC yet)
The Windows app (`client-wrappers/windows`) has no push service (WNS is not done), so a poke reaches it through the live connection of the web page, which keeps running while the window is **hidden in the tray**. So it rings **only while the app is running** (not when it was quit from the tray, or the computer is off or asleep).
- `realtime.service.ts` (`tellWindowsAppAboutPokes`): a new message with `poke: true` (not older than 10 minutes, not the first snapshot) is sent to the app with `window.chrome.webview.postMessage({ type: 'poke', id, name, text, url })`, only in the Windows app (`SevenFriendsWindows` in the user agent).
- `MainWindow.xaml.cs` (`WebMessageReceived`): accepts it only from the app's own pages and a path that starts with `/`, and opens `PokeWindow`.
- `PokeWindow.cs`: a window over everything (`Topmost`), the sender's name big, the text, **Stop** and **Open**; the Windows alert sound repeats every 1.4 s until Stop, Open, or 2 minutes. A second poke while it rings updates the same window. Open brings the main window forward on that friend's page.
- Windows has no silent switch to get past; the sound follows the volume of the computer (it is not raised). A computer that is muted does not ring.
- Later, with WNS and an MSIX app: a poke as a toast with `scenario="alarm"` for the time the app is not running.

## iPhone (not built): the plan
**The hard fact:** an iPhone app cannot ring over the silent switch or a Focus by itself. There is no foreground service and a push cannot run code that plays a sound (a notification service extension can change a push but not make it loop or override the mute switch). The only ways are the ones Apple provides.

### The way to use: Critical Alerts
A push with `interruption-level: critical` and a sound plays **at a volume of the app's choice, even with the silent switch on and in any Focus / Do Not Disturb**, and shows on the lock screen. This is the way for a remote push. It needs:
1. **Apple's entitlement** `com.apple.developer.usernotifications.critical-alerts`. It is NOT in the normal developer portal list: the account holder applies on Apple's form ("Critical Alerts" request) and explains why. Apple usually approves health, home safety and security apps; a "friend can wake you" app has to argue its case (see "Store review"). Until it is approved, the app cannot be built with the entitlement for the store, so the iPhone poke waits for it. Do this first: it can take weeks.
2. **The person's permission**: ask with `UNAuthorizationOptions.criticalAlert` together with alert, sound and badge; iOS shows a separate "Critical alerts" switch in the app's notification settings.
3. **A sound file** in the app bundle (a `.caf` of at most 30 seconds; a longer one is cut). Make a loud, clear "poke" sound and put it with the jingles (`npm run ios:sounds` makes `.caf` files from the Android mp3 files; see `client-wrappers/ios/README.md`). A critical push plays the sound once (30 seconds at most): it does not loop.
4. **The push (backend):** the same `deliver()` in `push.ts`, with `apns.payload.aps`:
   ```
   alert: { title: <sender>, body: <text> }
   sound: { critical: 1, name: "poke.caf", volume: 1.0 }
   "interruption-level": "critical"
   "thread-id": <circle>
   ```
   plus `apns-priority: 10`, `apns-push-type: alert`, and `apns-expiration` of 10 minutes (already set from `POKE_TTL_SECONDS`). Android needs a data-only message and iPhone needs the alert, so `sendEachForMulticast` cannot serve both with one message once the iPhone part differs: either keep one multicast (the `apns` part is ignored by Android, the `android` part by iPhone: this already works today) or add a `platform` field to the registered device. Prefer the first.
5. **Repeating:** to make it hard to miss, the backend may send the same poke **again after 20 and 40 seconds** (same `apns-collapse-id` = the poke's message id, so the phone shows one notification) until the message is read or the 2 minutes are over. Decide after a test on a phone; it must stop when the person opens the chat on any device.

### What the app does
- On `registerForRemoteNotifications` the app already registers the token (`docs/guide/live-and-notifications.md`). Add the `criticalAlert` option to the permission request and an explanation text before it (one line: "Pokes from your friends ring even when your phone is silent").
- A tap on the poke opens the friend's page (`url`), like any push.
- `App.entitlements`: add the critical-alerts key (after Apple approves); `Info.plist` already has the `remote-notification` background mode.
- **Foreground:** when the app is open, iOS does not show the push by default. In `userNotificationCenter(_:willPresent:)` return `[.banner, .sound]` for a poke so it still rings, and show the same "Poke from <name>" screen the web page can draw (a full-screen page, no pop-up).

### Fall-backs (if Apple says no)
- **Time Sensitive notification** (`interruption-level: time-sensitive`, entitlement "Time Sensitive Notifications", granted without review): breaks through Focus / scheduled summary, but **not** the silent switch. The poke then rings with sound only when the phone is not on silent.
- **AlarmKit (iOS 26)**: a real alarm that rings through Silent and Focus, but it is scheduled **on the device** by the app, so a friend's push cannot start it. Not a fit for a remote poke.
- **CallKit / PushKit** (the poke shown as an incoming call): Apple requires a real call and rejects apps that use it for something else. Do not.

### Store review
Both stores treat "another person can force my phone to ring" as a risk. Be ready to explain: pokes only come from a confirmed friend (one of 7), the receiver can put a friend on the sleep list to stop it, there is a hard limit of 2 minutes, and the person is told about it when the app asks for the permission. Keep rule 2 (sleep list stops a poke); that is the receiver's control, even though there is no setting to turn pokes off for everyone.

## What to build for iPhone, in order
1. Apply for the Critical Alerts entitlement (Apple's form, from the developer account).
2. Make `poke.caf` (loud, at most 30 s) and add it to the iPhone app.
3. `push.ts`: for a poke, the `apns` part with `sound: { critical: 1, name: "poke.caf", volume: 1 }` and `interruption-level: critical`; a test in `functions/test` that the message built for a poke has it (the sending itself is mocked).
4. The app: the `criticalAlert` permission option, the explanation, `willPresent` for the foreground.
5. A test on a real iPhone with the silent switch on and a Focus on, screen locked.
6. Decide on repeating (see above) after step 5.

## Not done
The iPhone poke (everything under "iPhone"). A test of the Android alarm on a phone. Windows and the browser show the ordinary push for a poke.
