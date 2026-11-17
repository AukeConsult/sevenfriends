# Security audit – Seven Friends (run-1)

## Run scope and limits (read first)
- **Profile:** `quick`, whole repository (functions/, frontend/, firebase config, android/, windows/, ios/ lightly). **This is a partial pass, not a clean bill of health.**
- **Source ref:** commit 9ae2c27 plus a dirty working tree (117 modified/untracked files).
- **Execution:** source-only. No OS sandbox exists on this Windows host, so **no target code was run** and nothing was reproduced locally. Because the skill reserves `confirmed` for findings with a local observed result, **no finding is `confirmed`**. Findings below are `source_verified`: a fresh verifier re-read the code and could not refute them; none was executed.
- **Agents:** 23 of a budget of 30 (4 recon, 8 hunters, 1 critic, 10 verifiers). In `quick` the candidate-validation and final-record-verification passes are merged (one fresh verifier per candidate).
- **Deviations from the skill:** (1) hunters/verifiers were told to read the skill's attack-class blocks from the files instead of receiving verbatim copies; (2) `validate-findings.cjs` and `validate-coverage-ledger.cjs` **could not run** (they refuse to run on Windows without no-follow file support, and WSL has no Node), so `findings.json` and `coverage-ledger.json` are **not schema-validated**; (3) `source_verified` is a non-schema verdict used in place of `confirmed`; (4) the ledger was updated at summary level.
- **Prior runs:** none.
- **Deferred coverage (critic, not hunted in this quick run):** client E2E signature verification (message-lock.service.ts, device-list.ts); reencrypt.ts / safebox.ts participant writes of enc/wraps; group add/remove/history flows in depth; client login/token/URL-parameter handling (api.service.ts, friend-link, auth-action, phone-auth, account-registry); routers sync/signals/notifications/preferences/circle-profile/paths/own-request; hosting headers/APK distribution and iOS.

## Security posture
The server side is carefully built. All routers authenticate; uid always comes from the verified token; per-resource checks fail closed; Firestore/Storage rules deny all client get/write; media access, upload sniffing and downloads held up; the SSRF guard for link previews held (including DNS rebinding and redirects); no secrets are committed. The weaknesses found are low severity: one theme of **unverified identifiers used as identity** (invites, erase), **missing origin boundaries around embedded third-party pages** (Android bridge, Windows allowlist, unescaped names), and **non-enforced browser hardening** (CSP is Report-Only; no HSTS, nosniff, Referrer-Policy or frame protections).

## Source-verified findings (not executed)
| Severity | Title | Boundary | Result (from source) |
|---|---|---|---|
| low | Pending invitations can be claimed via unverified email / typed phone | stranger → another person's invitation | Claimant is linked and the real invitee blocked; warning suppressed when claimant has any verified detail |
| low | Account erase deletes others' pending invitations matching unverified identifiers | user → other users' pending entries | Typed phone/unverified email makes erase delete unlinked pending entries, requests, signals, safebox of others |
| low | Android JS bridges reachable from third-party preview iframes | third-party web page → native bridge | Device name/model/notification state readable; nuisance UI; no credentials |
| low | Windows wrapper treats any *.firebaseapp.com as in-app | attacker site → in-app window | In-app phishing window; no permissions, no bridge |
| low | Friend-request sender name rendered via [innerHTML] | stranger → recipient's notification card | Link/tracking-image injection; no script |

Each is detailed in `FINDINGS-DETAIL.md`-style form in `findings.json` (trace, conditions, fix, regression test). No `medium`+ finding survived verification, so `FINDINGS-DETAIL.md` has no entries.

### Smallest fixes
- **Invites + erase:** use `verifiedIdentity()` (email_verified, SMS-verified phone only) in `syncIncomingInvites` (functions/src/invites.ts:25-29) and `eraseUser` step 3 (functions/src/erase.ts:113); drop typed `account.phone`/`phoneKey` from probes; make `unverifiedDetails` flag a typed phone.
- **Android bridge:** replace `addJavascriptInterface` (MainActivity.java:68) with `WebViewCompat.addWebMessageListener` restricted to `https://sevenfriends.io`; restrict `embedUrl` to allowlisted players.
- **Windows:** replace `firebaseapp.com` in `Inside` (MainWindow.xaml.cs:27) with `sevenfriends.firebaseapp.com`.
- **Names:** render `fromName` as text (or `esc()`) in notifications.html:152, pending.html:25, friend-recovery.html:35.

## Needs validation (no severity)
`friends-lookup-enumeration-weak-limit` – see `NEEDS-VALIDATION.md`.

## Rejected / hardening (not findings)
- Login-only device-list restart/key wipe: documented accepted limit (default-key.md Step 3, recovery rule 10). Owner note: restart sends no push to old devices and has no cooling-off.
- Friend recovery wraps for all published keys: exactly fixed rule 5/9; not challenged.
- Legacy accounts without a signed list: documented legacy behaviour.
- Own-origin framing via redirect: no demonstrated effect; hardening only.

Hardening notes: enforce CSP (convert Report-Only) and add HSTS, X-Content-Type-Options, Referrer-Policy, frame-ancestors/X-Frame-Options (firebase.json:16); `verifyIdToken` without `checkRevoked` and fail-open deleted-login lookup (auth.ts); in-memory per-instance rate limits throughout; `RECOVERY_ASKS_PER_DAY` defaults to 0 (unlimited) – confirm production value; `/accounts/check` limiter keys on `req.ip` without `trust proxy`; chunk-finish can overwrite a user's own object of another kind (media.ts:96-132); 1-year immutable cache of message files after deletion; IPv6 private-range list in link-preview narrow (6to4, multicast); Android MainActivity `url` extra and broad FileProvider paths; `.gitignore` covers `ios/App/App/GoogleService-Info.plist` but the tracked file is `ios/App/GoogleService-Info.plist` (public client config, confirm API key restrictions); a Firebase service-account key file sits on disk at the repo root; it is gitignored and untracked (rotate it if it was ever shared or if git history ever contained it; history was not checked); mail trigger (invite email relay) is dormant but unsafe to enable as is.

## Coverage summary (ledger, quick profile)
8 units: covered with no candidate: media/safebox, link-preview SSRF; candidate: API access control, invites, erase/config, frontend DOM, native wrappers, keys/recovery. Final critic: proposed 6 gaps, recorded as deferred; no clean-coverage claim. Deployment facts not visible in source (App Check, IAM/invoker, Auth console settings, deployed rules and headers, API-key restrictions) are unverified.
