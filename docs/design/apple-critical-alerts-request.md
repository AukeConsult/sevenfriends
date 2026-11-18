# Apple: request for the Critical Alerts entitlement (text to paste)

Form: https://developer.apple.com/contact/request/notifications-critical-alerts-entitlement/ (the Account Holder of the Apple Developer account fills it in).
Fill in yourself: Team ID, contact name and email. The rest below can be pasted. Keep it short and concrete: Apple reads these quickly and says no to vague ones.

**App name:** Seven Friends

**Bundle ID:** io.sevenfriends.app

**Platform:** iOS

**What does your app do?**
Seven Friends is a private app for staying in touch with the seven people closest to you. Each person chooses at most seven friends. Messages, photos and a shared safebox are only visible to the people involved. There are no public profiles, no feed and no ads.

**How will your app use Critical Alerts?**
The app has one feature called a "poke". When a friend you have given one of your seven seats sends you a poke, your phone rings like an alarm, even when it is on silent or in a Focus. It is meant for the rare moment when something cannot wait: a family member needs you now, someone is stuck, or something urgent has happened. Critical Alerts are used only for a poke, never for ordinary messages, friend requests, reminders or marketing. Ordinary messages use normal notifications that respect the silent switch and Focus.

**Why do you need Critical Alerts, and why are normal or Time Sensitive notifications not enough?**
A poke is useless if it can be silenced by a phone that was muted for the night or by a Focus. People who rely on their closest friends and family for urgent contact need to be sure the phone rings. A normal notification is silent on mute and Time Sensitive does not pass the silent switch, so the person would miss exactly the contact they asked to be reachable for.

**How does the person stay in control?**
- Only a friend the person has accepted into one of their seven seats can poke them. Friends on the person's sleep list, strangers and pending requests cannot.
- The person must allow Critical Alerts in the permission prompt and in Settings, and can turn them off there at any time.
- Inside the app the person can pause pokes for 1 hour, 4 hours, until morning or 24 hours. While paused, pokes arrive as ordinary messages and their friends see the status "Silent".
- The person can put any friend on their sleep list, which stops that friend's pokes.
- A poke rings once, for at most 30 seconds. It cannot repeat endlessly, and a poke that could not be delivered expires after a limited time.
- Every poke shows who sent it.

**Examples of when a Critical Alert is sent**
1. A daughter pokes her father because her phone is about to die and she needs to be picked up.
2. A friend pokes a flatmate who has gone to bed because the flat is locked and they are outside.
3. A person pokes a close relative they cannot reach by calling.

**Is the app available on the App Store?**
Not yet. It is in development and will be submitted for review together with this entitlement. The feature is implemented so that, without the entitlement, a poke falls back to an ordinary notification.

**Anything else:**
Critical Alerts are requested in the first notification permission prompt, together with alerts, badges and sounds, and the sound is a short alarm-clock tone of 25 seconds in the app bundle. We can provide screen recordings of the poke flow and the pause setting on request.
