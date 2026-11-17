# Needs validation

## friends-lookup-enumeration-weak-limit (no severity assigned)
- **Trace:** functions/src/friends.ts:247 (POST /lookup) → friends.ts:43 (tooManySearches, in-memory Map per uid per instance, 30/h) → functions/src/signals.ts:10 (findAccounts: existence by emailLower/phoneKey, non-private accounts).
- **Blocker:** whether Firebase Auth sign-up is open/throttled and whether App Check or similar abuse controls are enforced (console facts not in source). Existence is the documented purpose of the lookup; only the strength of the limit is in question.
- **Local next step:** emulator test: call lookup 31 times with one uid (expect 429), then with a fresh uid.
- **Owner-observed check:** in the Firebase console, check Auth sign-up throttling/providers and App Check enforcement.
