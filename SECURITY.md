# Security policy

Seven Friends locks messages and safebox files on the devices (end-to-end), so a weakness in the keys, the recovery steps or the
server checks matters. Thank you for telling us in a responsible way.

## Reporting a vulnerability

**Please do not open a public issue for a security problem.**

- Use GitHub's private reporting: the **Security** tab of this repository, **Report a vulnerability**, or
- write to **hey@blueboot.ai** with "Seven Friends security" in the subject.

Tell us what you found, how to repeat it, and what you think the effect is. We aim to answer within a week and to fix serious
problems before they are made public. Please give us a reasonable time to fix a problem before you tell others.

## What is in scope

The web app at sevenfriends.io, the Android, iPhone and Windows apps, and the code in this repository (the Cloud Function `api`,
the Firestore and Storage rules, the key handling in `frontend/src/app/core/`).

Never test with other people's accounts or data. Never commit keys or secrets: if you find one in the history, tell us at once.
