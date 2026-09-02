"use strict";

/*
 * Instadrop Telegram bot — Firebase Cloud Functions backend.
 *
 * Flow:  Telegram user sends an Instagram URL
 *        -> bot validates it and replies "⏳ Downloading..."
 *        -> bot reuses the SAME downloader endpoints the Instadrop website
 *           (public/script.js) uses to resolve media URLs
 *        -> bot downloads the media (streamed to /tmp, size-capped) and
 *           uploads it to Telegram via sendVideo/sendPhoto
 *        -> user receives the actual video in chat, not just a link.
 *
 * Secrets (never hard-coded, injected by Cloud Functions):
 *   TELEGRAM_BOT_TOKEN  — required
 *   WEBHOOK_SECRET      — required (must match the secret_token set on the webhook)
 */

const { onRequest } = require("firebase-functions/v2/https");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN || "";
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || "";
const TG_API = "https://api.telegram.org/bot" + BOT_TOKEN;

const MAX_MEDIA_BYTES = 47 * 1024 * 1024; // Telegram caps bot-sent files at 50 MB; stay under it
const TMP_DIR = "/tmp";
const MAX_ITEMS = 10; // max media items sent per post (carousels)
const RESOLVE_TIMEOUT_MS = 25000;
const MEDIA_TIMEOUT_MS = 90000;
const SEND_TIMEOUT_MS = 120000;
const MAX_REQS_PER_MIN = 8; // per-chat rate limit

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

class MediaTooLargeError extends Error {}

/* ------------------------ tiny in-memory caches ------------------------
   Best-effort, per warm instance only (Cloud Functions scale out means each
   instance has its own cache). Fine for dedup + repeat-request speedup. */
const processedUpdates = new Map(); // update_id -> ts
const resolutionCache = new Map();  // shortcode -> {items, ts}
const fileIdCache = new Map();      // shortcode -> {list: [{kind, file_id}], ts}
const inFlight = new Map();         // shortcode -> Promise (dedupe concurrent)
const chatBuckets = new Map();      // chat_id -> {tokens, ts}

const TTL = { update: 10 * 60 * 1000, resolve: 15 * 60 * 1000, file: 24 * 60 * 60 * 1000 };

function prune(map, ttl) {
  const now = Date.now();
  for (const [k, v] of map) if (now - (v && v.ts !== undefined ? v.ts : v) > ttl) map.delete(k);
}

// Logs NEVER include the bot token, full URLs, or user info.
function log(msg) {
  console.log(new Date().toISOString() + " " + msg);
}

/* ----------------------------- Telegram API ----------------------------- */

async function tg(method, payload, timeoutMs = 30000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(TG_API + "/" + method, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) throw new Error((j && j.description) || "HTTP " + res.status);
    return j.result;
  } finally {
    clearTimeout(timer);
  }
}

async function tgForm(method, form, timeoutMs = SEND_TIMEOUT_MS) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(TG_API + "/" + method, { method: "POST", body: form, signal: ctrl.signal });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j || !j.ok) throw new Error((j && j.description) || "HTTP " + res.status);
    return j.result;
  } finally {
    clearTimeout(timer);
  }
}

async function sendText(chatId, text) {
  return tg("sendMessage", { chat_id: chatId, text });
}

/* ------------------------- URL validation / parsing ------------------------- */

function shortcodeFromUrl(raw) {
  const s = String(raw || "").trim();
  const m = s.match(
    /(?:instagram\.com|instagr\.am)\/(?:[A-Za-z0-9._]{1,30}\/)?(?:reel|reels|p|tv)\/([A-Za-z0-9_-]+)/i
  );
  return m ? m[1] : null;
}

/* ----------- downloader chain (same endpoints as the website's script.js) -----------
   Reuses the existing Instadrop media-extraction APIs rather than reimplementing
   a downloader. Tries services in order until one returns media. */

function cleanUrl(u) {
  return String(u || "").replace(/\\\//g, "/").replace(/&amp;/g, "&");
}

function jsonToItems(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return []; }
  const items = [];
  const seen = new Set();
  const push = (raw, thumb, kind) => {
    const u = cleanUrl(raw);
    if (!/^https?:\/\//.test(u)) return;
    if (seen.has(u)) return;
    seen.add(u);
    items.push({
      kind: kind || (/\.mp4(\?|&|$)/i.test(u) ? "video" : "image"),
      thumb: thumb ? cleanUrl(thumb) : null,
      url: u,
    });
  };
  const scan = (o) => {
    if (!o || typeof o !== "object") return;
    if (typeof o.url === "string" && /^https?:\/\//.test(o.url)) push(o.url, o.thumb || o.thumbnail || o.img);
    if (typeof o.video === "string" && /^https?:\/\//.test(o.video)) push(o.video, o.thumbnail || o.thumb, "video");
    if (typeof o.video_url === "string" && /^https?:\/\//.test(o.video_url)) push(o.video_url, o.thumbnail || o.thumb || o.display_url, "video");
    if (typeof o.image_url === "string" && /^https?:\/\//.test(o.image_url)) push(o.image_url, o.image_url, "image");
    if (typeof o.display_url === "string") push(o.display_url, o.display_url, "image");
    if (typeof o.link === "string" && /^https?:\/\//.test(o.link)) push(o.link, o.thumbnail || o.thumb);
    if (typeof o.thumbnail === "string" && /^https?:\/\//.test(o.thumbnail)) push(o.thumbnail, o.thumbnail, "image");
    if (o.image_versions2 && Array.isArray(o.image_versions2.candidates)) {
      const c = o.image_versions2.candidates.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (c) push(c.url, c.url, "image");
    }
    if (Array.isArray(o.video_versions)) {
      const v = o.video_versions.slice().sort((a, b) => b.width * b.height - a.width * a.height)[0];
      if (v) push(v.url, v.url, "video");
    }
    // thakur-infopd style: image/video as arrays of plain URL strings
    if (Array.isArray(o.image)) for (const m of o.image) if (typeof m === "string") push(m, m);
    if (Array.isArray(o.video)) for (const m of o.video) if (typeof m === "string") push(m, m, "video");
    if (Array.isArray(o.media)) { for (const m of o.media) (typeof m === "string" ? push(m, m) : scan(m)); return; }
    if (Array.isArray(o.stories)) { for (const m of o.stories) (typeof m === "string" ? push(m, m) : scan(m)); return; }
    if (Array.isArray(o.items)) { for (const m of o.items) (typeof m === "string" ? push(m, m) : scan(m)); return; }
    if (Array.isArray(o.medias)) { for (const m of o.medias) (typeof m === "string" ? push(m, m) : scan(m)); return; }
    if (Array.isArray(o.data)) { for (const m of o.data) (typeof m === "string" ? push(m, m) : scan(m)); return; }
    if (Array.isArray(o.result)) { for (const m of o.result) (typeof m === "string" ? push(m, m) : scan(m)); return; }
    for (const v of Object.values(o)) if (v && typeof v === "object") scan(v);
  };
  scan(j);
  return items;
}

function mnBotsParse(text) {
  let j;
  try { j = JSON.parse(text); } catch (e) { return []; }
  if (!j || !j.success || !j.media) return [];
  return j.media
    .map((m) => ({
      kind: (m.type === "video" || /\.mp4/i.test(m.url || "")) ? "video" : "image",
      thumb: m.thumb || null,
      url: m.url || m.server2 || null,
    }))
    .filter((m) => m.url);
}

const SERVICES = [
  { name: "thakur-infopd", url: (u) => "https://insta.thakur-infopd.workers.dev/?url=" + encodeURIComponent(u), parse: jsonToItems },
  { name: "mn-bots", url: (u) => "https://instagram-downloader.mn-bots.workers.dev/?url=" + encodeURIComponent(u), parse: mnBotsParse },
  { name: "anon-social", url: (u) => "https://anon-social-info.vercel.app/igdl?key=igdl305&url=" + encodeURIComponent(u), parse: jsonToItems },
  { name: "ddvideo", url: (u) => "https://api.dd.video/api/instagram?url=" + encodeURIComponent(u), parse: jsonToItems },
  { name: "snapinsta", url: (u) => "https://snapinsta.app/api/instagram?url=" + encodeURIComponent(u), parse: jsonToItems },
  { name: "indown", url: (u) => "https://indown.io/api/info?url=" + encodeURIComponent(u), parse: jsonToItems },
];

async function resolveMedia(cleanInstagramUrl) {
  for (const s of SERVICES) {
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), RESOLVE_TIMEOUT_MS);
      let res;
      try {
        res = await fetch(s.url(cleanInstagramUrl), {
          signal: ctrl.signal,
          redirect: "follow",
          headers: { "User-Agent": "Mozilla/5.0" },
        });
      } finally {
        clearTimeout(timer);
      }
      if (!res.ok) continue;
      const text = await res.text();
      const items = s.parse(text);
      if (items && items.length) {
        log(s.name + " resolved " + items.length + " item(s) for " + cleanInstagramUrl.replace(/^https:\/\/www\.instagram\.com\//, ""));
        return items;
      }
    } catch (e) {
      // try the next service
    }
  }
  return [];
}

async function resolveOnce(shortcode) {
  const cached = resolutionCache.get(shortcode);
  if (cached) return cached.items;
  if (inFlight.has(shortcode)) return inFlight.get(shortcode); // concurrent same-post requests share one resolution
  const p = (async () => {
    const clean = "https://www.instagram.com/reel/" + shortcode + "/";
    const items = await resolveMedia(clean);
    if (items.length) resolutionCache.set(shortcode, { items, ts: Date.now() });
    return items;
  })().finally(() => inFlight.delete(shortcode));
  inFlight.set(shortcode, p);
  return p;
}

/* ----------------------------- media handling ----------------------------- */

async function downloadToFile(url, filePath) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), MEDIA_TIMEOUT_MS);
  let res;
  try {
    res = await fetch(url, {
      signal: ctrl.signal,
      redirect: "follow",
      headers: { "User-Agent": "Mozilla/5.0" },
    });
  } finally {
    clearTimeout(timer);
  }
  if (!res.ok || !res.body) throw new Error("media HTTP " + (res && res.status));
  let size = 0;
  const out = fs.createWriteStream(filePath);
  try {
    for await (const chunk of res.body) {
      size += chunk.length;
      if (size > MAX_MEDIA_BYTES) throw new MediaTooLargeError("media exceeds Telegram's 50 MB limit");
      if (!out.write(chunk)) await new Promise((r) => out.once("drain", r));
    }
  } finally {
    out.end();
  }
  return size;
}

function fileIdOf(result, kind) {
  if (!result) return null;
  if (kind === "image") {
    const p = result.photo;
    if (p && p.length) return p[p.length - 1].file_id;
  }
  if (kind === "video") return result.video && result.video.file_id;
  return result.document && result.document.file_id;
}

async function sendMediaByUpload(chatId, item, shortcode, index) {
  const ext = item.kind === "video" ? "mp4" : "jpg";
  const filePath = path.join(TMP_DIR, crypto.randomBytes(6).toString("hex") + "_" + shortcode + "_" + index + "." + ext);
  try {
    await downloadToFile(item.url, filePath);
    const buf = fs.readFileSync(filePath);
    const mime = item.kind === "video" ? "video/mp4" : "image/jpeg";
    const form = new FormData();
    form.append("chat_id", String(chatId));
    form.append(
      item.kind === "video" ? "video" : "photo",
      new Blob([buf], { type: mime }),
      "instadrop_" + shortcode + "_" + index + "." + ext
    );
    form.append("caption", "Downloaded with Instadrop");
    const result = await tgForm(item.kind === "video" ? "sendVideo" : "sendPhoto", form);
    return fileIdOf(result, item.kind);
  } finally {
    fs.promises.unlink(filePath).catch(() => {});
  }
}

async function sendMediaByUrl(chatId, item) {
  // Fallback: let Telegram's servers fetch the media URL directly.
  const key = item.kind === "video" ? "video" : "photo";
  const result = await tg(
    item.kind === "video" ? "sendVideo" : "sendPhoto",
    { chat_id: chatId, [key]: item.url, caption: "Downloaded with Instadrop" },
    SEND_TIMEOUT_MS
  );
  return fileIdOf(result, item.kind);
}

/* ----------------------------- per-chat rate limit ----------------------------- */

function rateLimit(chatId) {
  prune(chatBuckets, 60 * 1000);
  const now = Date.now();
  let b = chatBuckets.get(chatId);
  if (!b || now - b.ts > 60000) {
    b = { tokens: MAX_REQS_PER_MIN, ts: now };
    chatBuckets.set(chatId, b);
  }
  if (b.tokens <= 0) return false;
  b.tokens -= 1;
  return true;
}

/* ----------------------------- message handling ----------------------------- */

const HELP =
  "Send me an Instagram reel or post link and I'll send the video straight to you.\n\n" +
  "Examples:\n" +
  "https://www.instagram.com/reel/…\n" +
  "https://www.instagram.com/p/…\n\n" +
  "I only look at the link you send — nothing else is collected.";

async function sendFromFileIds(chatId, list) {
  for (const entry of list) {
    const key = entry.kind === "video" ? "video" : "photo";
    await tg(
      entry.kind === "video" ? "sendVideo" : "sendPhoto",
      { chat_id: chatId, [key]: entry.file_id, caption: "Downloaded with Instadrop" }
    );
  }
}

async function handleText(chatId, text) {
  const t = String(text || "").trim();
  if (!t) return;
  if (t.startsWith("/start") || t.startsWith("/help")) {
    await sendText(chatId, HELP);
    return;
  }

  const shortcode = shortcodeFromUrl(t);
  if (!shortcode) {
    await sendText(chatId, "❌ Please send a valid Instagram URL.");
    return;
  }
  if (!rateLimit(chatId)) {
    await sendText(chatId, "⏳ You're going too fast — wait a moment and try again.");
    return;
  }

  await sendText(chatId, "⏳ Downloading...");

  const cachedIds = fileIdCache.get(shortcode);
  if (cachedIds) {
    await sendFromFileIds(chatId, cachedIds.list);
    return;
  }

  const items = await resolveOnce(shortcode);
  if (!items.length) throw new Error("no media found");

  const ids = [];
  const slice = items.slice(0, MAX_ITEMS);
  for (let i = 0; i < slice.length; i++) {
    const item = slice[i];
    let fileId = null;
    try {
      fileId = await sendMediaByUpload(chatId, item, shortcode, i);
    } catch (e) {
      log("upload path failed for item " + i + " of " + shortcode + ": " + e.message);
      if (e instanceof MediaTooLargeError) throw e;
      try {
        fileId = await sendMediaByUrl(chatId, item);
      } catch (e2) {
        log("url path failed for item " + i + " of " + shortcode + ": " + e2.message);
      }
    }
    if (!fileId) throw new Error("couldn't send item " + i);
    ids.push({ kind: item.kind, file_id: fileId });
  }
  fileIdCache.set(shortcode, { list: ids, ts: Date.now() });
}

/* ----------------------------- webhook ----------------------------- */

exports.telegramWebhook = onRequest(
  {
    secrets: ["TELEGRAM_BOT_TOKEN", "WEBHOOK_SECRET"],
    memory: "512MiB",
    timeoutSeconds: 300,
  },
  async (req, res) => {
    if (WEBHOOK_SECRET && req.headers["x-telegram-bot-api-secret-token"] !== WEBHOOK_SECRET) {
      res.status(401).json({ ok: false });
      return;
    }
    if (!BOT_TOKEN) {
      log("TELEGRAM_BOT_TOKEN secret is not set — bot is idle.");
      res.status(200).json({ ok: true });
      return;
    }

    const update = req.body || {};
    const updateId = update.update_id;
    if (!updateId) {
      res.status(200).json({ ok: true });
      return;
    }

    // Telegram retries webhook calls that don't get a quick 2xx — dedupe by update_id.
    if (processedUpdates.has(updateId)) {
      res.status(200).json({ ok: true, deduped: true });
      return;
    }
    processedUpdates.set(updateId, Date.now());
    prune(processedUpdates, TTL.update);

    const msg = update.message || update.edited_message || null;
    const chatId = msg && msg.chat && msg.chat.id;
    if (typeof chatId !== "number") {
      res.status(200).json({ ok: true });
      return;
    }

    try {
      await handleText(chatId, msg.text);
    } catch (e) {
      log("handler error: " + e.message);
      try {
        await sendText(
          chatId,
          e instanceof MediaTooLargeError
            ? "❌ This media is larger than Telegram's 50 MB limit, so it can't be sent."
            : "❌ Couldn't download that media. Please try again."
        );
      } catch (e2) {
        // nothing else we can do
      }
    }
    res.status(200).json({ ok: true });
  }
);
