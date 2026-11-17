# Project notes

## TODO

- [ ] **Share into Seven Friends (hold: do not publish to users until the owner has accepted it).**
  Built so far, not accepted yet: the web page `/share-in` (`frontend/src/app/share-in/`, the `draft` start text in `friend-send.ts`, texts in `shareIn.json`) and the Windows MSIX share target (`client-wrappers/windows/SharedContent.cs`, `msix/AppxManifest.xml`).
  Before it goes to users:
  - the owner tries and accepts it (install the MSIX with the test certificate trusted, share a link from Edge, check `/share-in` on a phone-sized screen);
  - the MSIX is **not** put on the website downloads (`windows:release` only builds it into `client-wrappers/windows/msix/output/`, so nothing is published by that);
  - the web page `/share-in` goes online with the next `npm run deploy:hosting` (and `windows:release` runs that by default): deploy it only after the acceptance, or take the route out of `app.routes.ts` until then;
  - later steps, not built: Android share target, iPhone share extension, the browser's Web Share Target, and keeping the shared text through the sign-in when the person is signed out.
