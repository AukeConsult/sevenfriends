# Jingles

Drop your music jingles in this folder and they show up in **Settings → Sounds**, where each person can pick one
for a new message, a friend request or an answer to a request.

- **Formats:** `.mp3`, `.wav`, `.ogg`, `.m4a`, `.aac` (mp3 works everywhere).
- **The name of the file is the name in the list:** `Happy_birthday.mp3` shows as "Happy birthday".
- **Keep them short** (a few seconds up to about 15) and not too big: they are downloaded when played, on a phone too.
  Anything longer than 20 seconds is stopped.
- **It is picked up by itself** the next time you run `npm run dev:frontend` / build / deploy. By hand: `npm run sync:sounds`.
- The list `sounds.json` here is written by that script: do not edit it (it is not committed).
- Only use music you may use. Jingles are served to everybody who opens the app.

The choice is saved on each person's account (`file:<file name>`), so keep the file names: renaming or deleting a file
makes the people who chose it hear nothing until they choose again.
