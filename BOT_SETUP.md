# 🤖 Instadrop Telegram Bot

A lightweight Telegram bot that sends Instagram reels/posts directly into a chat as video files.

```
Telegram user → Telegram Bot API (webhook) → Cloud Function (this bot)
                → reuses Instadrop's existing downloader endpoints
                → downloads the media (streamed to /tmp, size-capped)
                → uploads the actual video/photo back to Telegram
```

The bot **does not** reimplement media extraction — it calls the **same downloader
services the Instadrop website uses** (`public/script.js`), in the same fallback order.
It adds no new download logic, just the server-side glue (validate → resolve → fetch →
send) plus error handling, caching, timeouts, dedup and rate limiting.

---

## Files added / changed (everything else untouched)

| File | Purpose |
|---|---|
| `functions/index.js` | The whole bot: webhook handler, URL validation, downloader chain, media download, Telegram send |
| `functions/package.json` | Zero runtime deps beyond the official `firebase-functions` SDK |
| `.github/workflows/deploy-bot.yml` | CI that deploys **only** the Cloud Function on push |
| `.gitignore` | Ignores `.env`, `node_modules`, logs — secrets never reach GitHub |
| `.env.example` | Template for local webhook setup (no real secrets) |
| `scripts/setup-webhook.js` | One-command `setWebhook` with secret token |
| `BOT_SETUP.md` | This file |

`public/` (the website), `firebase.json`, and `.github/workflows/deploy.yml` (hosting
deploy) are **not modified**. Hosting and bot deploy independently; a bot-only push
doesn't touch the site and vice-versa.

---

## Prerequisites

- **Firebase Blaze (pay-as-you-go) plan.** Cloud Functions requires billing enabled
  (the free Spark plan only covers Hosting). Functions have a generous free tier
  (2M invocations/mo), so a small bot typically costs nothing, but a card is required.
  → `console.firebase.google.com` → project **instadrop-d0a23** → *Upgrade project*.
- `firebase-tools` CLI installed locally for the one-time secret setup:
  `npm i -g firebase-tools` and `firebase login`.

---

## 1. Create the bot & get the token

1. Message [@BotFather](https://t.me/BotFather) → `/newbot` → choose a name/handle.
2. Copy the `TELEGRAM_BOT_TOKEN` (format `123456:ABC...`).
3. Generate a webhook secret: `openssl rand -hex 32`.

## 2. Set the secrets (server-side, never in the repo)

```sh
firebase login
cd functions && npm install && cd ..

firebase functions:secrets:set TELEGRAM_BOT_TOKEN   # paste the BotFather token
firebase functions:secrets:set WEBHOOK_SECRET       # paste the hex you generated
```

Secrets are stored in Google Cloud Secret Manager, injected into the function's
environment at runtime, and are **not** readable from the deployed code or repo.

## 3. Deploy the function

```sh
firebase deploy --only functions --project instadrop-d0a23
```

After it finishes, note the URL printed, e.g.:
`https://us-central1-instadrop-d0a23.cloudfunctions.net/telegramWebhook`

> The included GitHub workflow (`.github/workflows/deploy-bot.yml`) redeploys the
> function automatically on every push that touches `functions/` or `scripts/`,
> reusing the `FIREBASE_SERVICE_ACCOUNT` secret already configured for hosting.
> (Run the manual deploy above the first time so the secrets exist.)

## 4. Point the webhook at the function

```sh
cp .env.example .env      # fill in the three values
node scripts/setup-webhook.js
```

This calls `setWebhook` with `secret_token` = `WEBHOOK_SECRET`, `allowed_updates=["message"]`,
`max_connections=40` and drops pending updates. Verify with:

```sh
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getWebhookInfo"
# → last_error_message should be empty, url should be your function
```

---

## Required environment variables

| Variable | Where it lives | Required | Notes |
|---|---|---|---|
| `TELEGRAM_BOT_TOKEN` | Firebase secret | ✅ | From @BotFather |
| `WEBHOOK_SECRET` | Firebase secret | ✅ | Must match `secret_token` on the webhook (defense against forged updates) |

The function reads both via `process.env` (injected by Cloud Functions). `.env` /
`.env.example` are only used by the **local** setup script and are git-ignored.

## Webhook behavior

- `secret_token` header is verified on every request (`X-Telegram-Bot-Api-Secret-Token`).
- Always replies `200` (Telegram stops retrying) and dedupes by `update_id` so
  Telegram's automatic retries never cause duplicate downloads.
- Only `message` updates are delivered; nothing else (no join/left/callback noise).

## How the bot behaves

| User sends | Bot does |
|---|---|
| `/start`, `/help` | Short help text |
| Valid `instagram.com/reel/…` or `…/p/…` link | `⏳ Downloading...` → resolves via the existing API chain → streams the media to `/tmp` → sends the actual video/photo with caption `Downloaded with Instadrop` |
| Any other text | `❌ Please send a valid Instagram URL.` |
| Private/deleted post, or all services fail | `❌ Couldn't download that media. Please try again.` |
| Media larger than Telegram's 50 MB limit | Dedicated "too large for Telegram" message |

### Safety / performance details

- **Timeouts:** resolution 25s, media download 90s, Telegram send 120s — nothing runs forever.
- **Size cap:** downloads stop at 47 MB (Telegram's 50 MB bot limit) and the partial file is deleted.
- **Temp cleanup:** media is streamed to a unique `/tmp` file (never permanent storage) and `unlink`ed in a `finally`.
- **Concurrency:** each update is processed independently; in-flight dedup means two users requesting the *same* post share one resolution, while different posts run fully in parallel.
- **Caching:** resolved media URLs (15 min) and Telegram `file_id`s (24 h) are cached per warm instance, so repeat requests are instant and don't re-download.
- **Rate limit:** 8 requests/min per chat, with a friendly "slow down" message.
- **Privacy:** the bot only reads the message text and the chat id needed to reply. It stores no usernames, IPs, or any other personal data, and never logs the token or full URLs.
- **Fallback:** if downloading the media in the function fails (e.g. an Instagram CDN blocks datacenter IPs), the bot falls back to handing the media URL to Telegram's `sendVideo`, which lets Telegram's servers fetch and deliver it — the user still receives the file in chat, not a link.

---

## Testing

1. Deploy + set the webhook (steps above).
2. Open the bot in Telegram → send `/start`.
3. Send a public reel URL, e.g. `https://www.instagram.com/reel/…` → you should see
   `⏳ Downloading...` then the video file in chat.
4. Send a random string → expect `❌ Please send a valid Instagram URL.`
5. Send the same URL twice → the second reply should be near-instant (cached file_id).
6. Watch logs with `firebase functions:log` (or the Functions console) — you should
   only see which service resolved the post and any errors; never secrets.

Local emulator (optional, needs your secrets exported):
```sh
cd functions && npm run serve
curl -X POST http://127.0.0.1:5001/instadrop-d0a23/us-central1/telegramWebhook \
  -H 'Content-Type: application/json' \
  -d '{"update_id":1,"message":{"chat":{"id":123},"text":"https://www.instagram.com/reel/abc123/"}}'
```

---

## Known limitations

- **Telegram bot file limit is 50 MB.** Larger reels can't be delivered via the Bot
  API at all (by upload *or* by URL) — the bot says so instead of crashing.
- **Instagram CDN URLs from the downloader services expire** (typically minutes to a
  few hours) and may be geo/rate-restricted. The cache TTLs above keep re-sends safe,
  and the URL-passthrough fallback handles cases where the function can't reach a CDN.
- **Free downloader services come and go.** The bot tries the same six services the
  website uses, in the same order, so it degrades gracefully as they change. If one
  dies, the others still work.
- **Caches are per-instance** (Cloud Functions scale-out). They're best-effort: they
  speed up repeat requests but don't guarantee cross-instance dedup. That's the
  right trade-off for keeping the bot lightweight; add a shared store (e.g. Firestore)
  only if you later need it.
- The bot currently handles reels/posts (video + photo + carousels, up to 10 items).
  Profile-picture, story and MP3 features from the website are out of scope for v1.

## Security notes

- The bot token is **never** in code, HTML, client JS, or `.env` committed files —
  it lives only in Secret Manager and your local (git-ignored) `.env`.
- The webhook endpoint verifies `secret_token`, so only Telegram can deliver updates.
- No credentials, API keys or internal endpoints are ever shown to Telegram users.
- The downloader services used are public, keyless endpoints — nothing sensitive to leak.

## Alternatives

If you'd rather not enable billing, the same `functions/index.js` logic can run as a
**Cloudflare Worker** (free tier, 100k req/day) with `wrangler secret put
TELEGRAM_BOT_TOKEN` — the handler is just a `fetch` event. The only change is the
entry-point wrapper; the resolver/download/send logic is platform-agnostic.
