# Contributing to Seven Friends

Thanks for wanting to help. Small, focused changes are the easiest to review.

1. **Open an issue first** for anything bigger than a fix, so we can agree on the idea.
2. **Fork, branch, change, pull request.** One topic per pull request.
3. **Read the project guide** [`CLAUDE.md`](CLAUDE.md) and the file in `docs/guide/` for the area you change. It explains the conventions
   (mobile first, one stylesheet, shared models, no pop-ups) that the code follows.
4. **Run the checks** before you push:
   - `npm test` for the backend (a rule change needs a test change as well);
   - `npm --prefix functions run build` and `npm --prefix frontend run build` must pass;
   - `npm run check:models` fails if the copied shared models are out of date.
5. **Never commit secrets**: `.env`, service account keys, keystores and `google-services.json` are ignored on purpose.
6. **Security problems** are reported privately, see [`SECURITY.md`](SECURITY.md).

By contributing you agree that your contribution is released under the project's license, the PolyForm Noncommercial License 1.0.0, and that Blueboot R&D AS may also license it under other terms (for example a commercial license). If you do not agree, please do not send a contribution.
