# Mayor of Luckhead — app project

This is the real project version of the game: a Vite + React setup instead of
the single `.jsx` artifact. It builds to an installable PWA (add-to-home-screen,
works offline) and is the same starting point Capacitor will need later for an
actual App Store build.

## What's in here

- `src/Luckhead.jsx` — the game itself, unchanged from the artifact version
- `src/main.jsx` — mounts it
- `vite.config.js` — build config + PWA plugin (manifest, service worker, and
  offline caching for the two music loops served from jsDelivr)
- `public/icons/` — placeholder app icon in the game's own palette. Fine for
  friend testing. Swap before App Store submission — Apple wants a clean
  1024×1024 with no transparency and no rounded corners baked in (they round
  it themselves).

## Run it locally

```
npm install
npm run dev
```

## Deploy it (free, ~10 minutes)

1. Push this folder to a new **public** GitHub repo (Capacitor will want the
   same repo later, so keep it — call it something like `luckhead-app`).
2. Go to vercel.com, sign in with GitHub, click "Add New Project," pick the
   repo. Vercel auto-detects Vite — leave every setting on default and click
   Deploy.
3. You get a URL like `luckhead-app.vercel.app`. That's the link to send
   friends.
4. On a phone, opening that link and choosing "Add to Home Screen" (iOS
   Safari share sheet, or the install prompt on Android Chrome) installs it
   like an app: full-screen, own icon, works offline after the first load.

Every push to the GitHub repo's main branch auto-redeploys — so a bug fix is
just a `git push` away from being live for your testers.

## Later: App Store

When you're ready:
1. `npm install @capacitor/core @capacitor/ios @capacitor/android`
2. `npx cap init` then `npx cap add ios` / `npx cap add android`
3. iOS build needs Xcode on a Mac and an Apple Developer account ($99/yr).
   Android build needs Android Studio and a Google Play account ($25 once).
4. TestFlight (iOS) or the Play Console's internal testing track becomes your
   beta channel instead of the raw Vercel link.

Nothing above touches `src/Luckhead.jsx` — the game code stays exactly what
you've been iterating on this whole time.
