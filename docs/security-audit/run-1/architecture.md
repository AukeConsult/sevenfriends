# Architecture – Seven Friends (run-1, quick, source-only)
Source ref 9ae2c27 (+ dirty worktree, 117 modified/untracked files). No OS sandbox on this Windows host: no target code executed; all findings are source-evidence only, so none can be "confirmed" by local execution without a verifier's source-trace sign-off; decisive-runtime facts go to needs_validation.

## Product, principals, protected resources
Social app: 7 closest friends per user. Principals: unauthenticated caller (3 routes: /api/health, POST /api/accounts/check, GET /api/invite-public/:code); authenticated user (own uid only); confirmed friend; group member; friend-request sender; other devices of same login (same Firebase token, device identity = client-asserted key id). Protected: messages, safebox (notes/files/secrets), media in Storage sf-cache/<uid>/, device keys and recovery backups, contact info (email/phone), push tokens.

## Stack
Angular 20 frontend (Firebase Hosting), Capacitor Android/iOS wrapper loading live https://sevenfriends.io, WPF/WebView2 Windows wrapper, Node 22 Express 4 backend as one public Cloud Function `api` (functions/src/index.ts:13 invoker public), Firestore + Storage accessed only through Admin SDK; rules deny all client get/write (firestore.rules, storage.rules) except owner `list` on 4 collections. Scheduled `safeboxReminders`. Mail trigger not exported.

## Entry surfaces / key paths
~150 Express routes under /api; requireAuth per router (functions/src/auth.ts:40-57; verifyIdToken without checkRevoked; deleted-login lookup fails open). uid always from token; circle via loadCircle (circles.ts); connection via connectionOf (conversation.ts:59-88). Media: raw upload magic-byte sniff, `locked=1` skips content checks (media.ts:49), download mayRead (media.ts:171-190), inline Content-Disposition. link-preview.ts: server-side fetch with DNS private-IP guard, stores final redirect URL as embedUrl, framed by chat.html with sandbox allow-scripts allow-same-origin. Keys: keys.ts (publish, signed device list, restart:true, remove with client-asserted `by`), own-recovery.ts (client-asserted `me`; /works, /trust), recovery.ts (friend recovery), reencrypt.ts, box-encryption.ts. Invites: invite.ts (/invite/lookup returns full email/phone, no rate limit found), accounts.ts (per-IP in-memory rate limit, no trust proxy). Friends add/lookup enumeration. Push: push.ts + frontend/public/firebase-messaging-sw.js (openWindow/navigateByUrl of payload url). Native: Android MainActivity exported, "url" extra to window.location.assign, addJavascriptInterface bridges (SevenFriendsAndroid, SfInsets), broad FileProvider paths; Windows MainWindow.xaml.cs host suffix match, permissions.

## Trust boundaries and strongest controls
Per-user data scoping by token uid + confirmed-friend entry; Firestore/Storage default-deny; CORS allowlist; magic-byte sniffing; E2E encryption with signed device lists (server only relays ciphertext + wraps); Storage via Admin SDK.

## Starting paths
functions/src/{auth,app,index,circles,friends,conversation,messages,media,sf-cache,safebox,box-encryption,keys,own-recovery,recovery,reencrypt,invite,invites,accounts,friend-requests,groups,group-members,group-history,link-preview,push,erase,outbox,mail}.ts; firestore.rules; storage.rules; firebase.json; frontend/src/app/{chat,core,notifications,pending,friend-recovery,safebox}, frontend/public/firebase-messaging-sw.js; android/app/src/main/{AndroidManifest.xml,java}; windows/MainWindow.xaml.cs.

## Prior coverage
No prior run. No compatible ledger.

## Deployment facts not visible
App Check, IAM/invoker binding, Auth console settings, API key restrictions, deployed rules/headers, secrets, RECOVERY_ASKS_PER_DAY. CSP is Report-Only; no HSTS/XFO/nosniff/Referrer headers in firebase.json. Service-account key and firebase-export-* dirs on disk but gitignored/untracked.

## Companion selection
DATA-ISOLATION-AND-LIFECYCLE (per-user objects, deletion), WEB-PROTOCOL-AND-AUTH (account transitions, sessions), CLIENT-SIDE (DOM, service worker, iframe), DESKTOP-MOBILE-AND-LOCAL-IPC (Android/Windows webview, exported component), CLOUD-AND-DEPLOYMENT (ingress, config/secret). Excluded: MEMORY-SAFETY-AND-BINARY (no native parsers in scope), AI-AND-LLM (no LLM), PROTOCOLS-RPC-AND-MESSAGING (no broker/RPC server), SUPPLY-CHAIN-AND-RELEASE (no workflow beyond stock deno.yml), RESOURCE-EXHAUSTION-AND-AVAILABILITY (live availability testing prohibited).
