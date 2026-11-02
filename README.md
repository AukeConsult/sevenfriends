# sevenfriends
**Message feed** (confirmed connections only): `GET/POST /api/circles/:circleId/friends/:friendId/messages` (read the feed / send `{ text }`) and `POST .../messages/read` (mark the other person's messages read). A message is stored once per person with the same id; deleting the connection deletes the feed.

## Shared models
The API types are written once in `functions/src/models/shared/` and copied into `frontend/src/app/models/shared/` by `scripts/sync-models.mjs`, automatically before every frontend start and build (or `npm run sync:models`). Edit the source, never the copy. See "Conventions" in CLAUDE.md.
