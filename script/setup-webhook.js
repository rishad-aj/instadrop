"use strict";

/*
 * Point the Telegram webhook at the deployed Instadrop bot function.
 *
 * Usage:
 *   1. Copy .env.example to .env and fill in TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET, FUNCTION_URL
 *   2. node scripts/setup-webhook.js
 *
 * The token is read from the environment (or .env) only — it is never hard-coded,
 * logged, or written anywhere in the repo.
 */

const https = require("https");
const fs = require("fs");
const path = require("path");

function loadDotEnv(file) {
  try {
    const txt = fs.readFileSync(file, "utf8");
    for (const line of txt.split("\n")) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m || m[1].startsWith("#")) continue;
      if (!(m[1] in process.env)) process.env[m[1]] = m[2];
    }
  } catch (e) {
    // no .env — fine, rely on real env vars
  }
}

loadDotEnv(path.join(__dirname, "..", ".env"));

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.WEBHOOK_SECRET;
const url = process.env.FUNCTION_URL;

if (!token || !secret || !url) {
  console.error("Missing required values. Fill in TELEGRAM_BOT_TOKEN, WEBHOOK_SECRET and FUNCTION_URL (in .env or the shell).");
  process.exit(1);
}
if (!/^https:\/\//.test(url)) {
  console.error("FUNCTION_URL must start with https:// (Telegram rejects plain http).");
  process.exit(1);
}

const body = JSON.stringify({
  url,
  secret_token: secret,
  allowed_updates: ["message"],
  max_connections: 40,
  drop_pending_updates: true,
});

const req = https.request(
  "https://api.telegram.org/bot" + token + "/setWebhook",
  {
    method: "POST",
    headers: { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) },
  },
  (res) => {
    let data = "";
    res.on("data", (c) => (data += c));
    res.on("end", () => {
      console.log(data);
      process.exit(res.statusCode >= 300 ? 1 : 0);
    });
  }
);
req.on("error", (e) => {
  console.error("Request failed: " + e.message);
  process.exit(1);
});
req.write(body);
req.end();
