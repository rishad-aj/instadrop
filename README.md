# 📥 Instadrop

**Download Instagram media in one click — free, ad-free, no login required.**

Instadrop is a privacy-friendly, browser-based Instagram downloader. Paste a link and grab **reels, posts, carousels, profile pictures and story highlights** at the original quality — plus extract any reel's soundtrack as **MP3**. Everything runs in your browser: nothing is stored on any server, ever.

[Live demo](https://instadrop.web.app) · [Report a bug](https://github.com/yourname/instadrop/issues)

---

## ✨ Features

- 🎬 **Reels & posts** — single videos and photos at original quality
- 🖼️ **Carousels** — download every slide of a multi-image post in one go
- 👤 **Profile pictures** — original size, no login needed
- 🌟 **Story highlights** — public highlights with a couple of taps
- 🎵 **Audio → MP3** — extract any reel's soundtrack, converted right in the browser
- 🚫 **No ads, no trackers, no popups, no redirects** — just a download button
- 🔒 **Private by design** — your links and files never leave your device
- 📱 **Installable PWA** — "Add to Home Screen" on Android & iOS, works offline
- 🔗 **App shortcuts** — long-press the app icon for quick tasks: Download a reel, profile pic, or MP3
- 🌓 **Light / Dark / System** themes

## 🚀 How to use

1. Copy the URL of the reel, post, carousel, profile or public highlight from Instagram.
2. Paste it into the box (or tap **Paste** to grab it from your clipboard).
3. Press **Download** — the media is resolved in seconds.
4. Preview the result, hit **Save** — or grab the **MP3** of the audio.

> ℹ️ Works with `instagram.com/reel/…`, `instagram.com/name/p/…` and profile/highlight links. Profile pictures arrive at the size Instagram serves to anonymous visitors.

## 🛠️ Tech

- Vanilla JavaScript + CSS (no frameworks)
- [RippleUI](https://rippleui.com) component styles + Tailwind preflight
- [FFmpeg.wasm](https://ffmpegwasm.netlify.app/) for in-browser MP3 conversion
- Firebase Hosting (PWA: manifest + service worker for offline & install)

## 📁 Structure

```
├── firebase.json            hosting config (clean URLs, caching, headers)
├── .firebaserc              Firebase project id
└── public/
    ├── index.html           page + SEO/OG/JSON-LD metadata
    ├── styles.css           all styling
    ├── script.js            all logic
    ├── manifest.webmanifest PWA manifest (installable app)
    ├── sw.js                service worker (offline cache)
    ├── logo.png / brand.png / favicon.ico    branding
    ├── icon-192/512.png     PWA icons
    ├── og-image.png         social share card
    ├── robots.txt / sitemap.xml              SEO
    └── 404.html             custom 404
```

## ☁️ Deploy

**Option A — GitHub (no terminal):**
1. Push this repo to GitHub.
2. [console.firebase.google.com](https://console.firebase.google.com) → **Add project** (`instadrop`).
3. **Build → Hosting → Get started** → connect your GitHub repo → Deploy.
4. Your site is live at `https://instadrop.web.app`, auto-redeploying on every push.

**Option B — Firebase CLI:**
```sh
npm i -g firebase-tools
firebase login
firebase use --add   # pick the instadrop project
firebase deploy
```

## 🤖 Telegram Bot

Instadrop also ships a Telegram bot that sends reels/posts straight into a chat as video files. It reuses the **same** media-download endpoints the website uses — no second downloader — and lives in its own `functions/` folder so the website is untouched.

- Full setup: see **[BOT_SETUP.md](BOT_SETUP.md)**
- Bot backend: `functions/` (Firebase Cloud Functions, zero deps beyond the Firebase SDK)
- Secrets: `TELEGRAM_BOT_TOKEN` + `WEBHOOK_SECRET` via `firebase functions:secrets:set` (never committed)
- Webhook: `node scripts/setup-webhook.js`

## ⚠️ Notes

- **Downloading content:** only download media you have the right to — your own posts, or content the owner has explicitly shared for downloading. Respect creators' rights and Instagram's terms of service.
- Instadrop is **not affiliated with, endorsed by, or sponsored by** Meta / Instagram.
- The public Instagram/download API endpoints are CORS-restricted in browsers; if downloads fail in production, add a small serverless proxy (Cloudflare Worker or Firebase Function) — the code is structured so this is a one-file swap.

## 📄 License

[MIT](LICENSE) — do whatever you like with the code; the content you download through it is your responsibility.
