# Friend statistics (later)

Status: considerations only, nothing is built. Date: 2026-11-08.

The profile page of a friend (`/friends/:id/profile`, under the header of the friend page) is where this will be shown. The page exists now with the profile only.

## What it should show
- **Last seen**: when the friend was last active in the app.
- **How active we are**: the number of messages in the last day, the last week, the last month and overall (a count only, never the text), and the same for pictures, videos and voice messages if we want it.
- Possibly **who writes more** (my share of the messages) and **the last message** (when).

## Must be possible to wipe
The person must be able to delete the statistics, and nothing else, whenever they want:
- **Wipe for one friend** (a button on that friend's profile page), and **wipe for all friends** (Settings).
- Wiping sets the counts and the last-seen to zero. It never deletes messages, and deleting messages never changes a count after it was kept (see below).
- A switch **"Keep statistics"** (per person, default to be decided: off is the privacy-friendly choice). When it is off, nothing is counted from then on, and what was counted is deleted.
- Statistics are deleted with the friendship and with the account (the erase function must cover them).

## Things to decide before building
1. **Whose numbers are they?** Each person keeps their own copy under their own friend entry. My statistics are never readable by my friend, and the server does not combine them. The profile shows what *I* have counted.
2. **Last seen is about the friend, so it needs their consent.** Showing "last seen" to a friend tells them when I was active. It should be a setting of the person it is about ("Let my friends see when I was last here", with the same choice as the active/passive/offline status we already have), not of the person looking. Today we show only active / passive / offline.
3. **Counted when, or computed when?** Computing from the messages is simple but the numbers change when messages are deleted ("clean up") and cannot be wiped separately. Counters kept next to the friend entry (`stats: { day, week, month, total, since }`) survive deleting messages and can be wiped on their own. Counters are the better fit for "must be possible to wipe". The day, week and month windows need either a rolling list of daily counts (30 numbers) or computing the windows from daily buckets.
4. **Locked messages.** The server can count a locked message (it knows it exists, who wrote it and when) but not read it, so counts do not weaken the encryption. They are metadata, though: the more we keep, the more the server knows. Keep them as few and as coarse as possible (counts per day, no per-message list), and say so in the privacy text.
5. **GDPR.** This is personal data about the other person's behaviour. The privacy page must say what is counted, that it stays with me, that it can be switched off and wiped, and that it is deleted with the account. Include it in the "What is stored about you" list and the delete section.
6. **Sleeping friends.** A friend on the sleep list produces no notification sounds; counting does not change that. Decide whether a sleeping friend's profile shows statistics (I think yes, it is the same data).
7. **Cost.** A counter update on every send adds one write to the friend entry (the entry is already updated with `lastMessageAt`), so it is cheap. Do not add a read to the Home check.

## Where it fits in the code
- Data: `stats` on each person's friend entry (`circles/{circle}/friends/{id}`), next to `lastMessageAt`; updated in the same batch as the message in `conversation.ts` (send), not on edit or delete.
- Server: `GET .../friends/:id/stats`, `DELETE .../friends/:id/stats` (wipe one), `DELETE /stats` (wipe all), and the preference "keep statistics" in the profile preferences.
- App: a section on the profile page (`friend-profile.html`) with the numbers and the wipe button; Settings for the global switch and wipe-all; the privacy page text.
- Tests: counting on send (not on edit), windows, wipe, switch off, erase, and that my friend cannot read my numbers.
