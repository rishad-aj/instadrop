/* ============================================================
   Instadrop - script.js
   Standalone application logic — powered by InstaDrop API
   ============================================================ */

const INSTADROP_API = "https://instadrop.rishu-rishad2019.workers.dev/?url=";

/* Network helper: uses Perchance's superFetch proxy when available,
   otherwise falls back to the browser's native fetch. */
const fetchLike = (typeof window.root !== 'undefined' && window.root && window.root.superFetch)
  ? window.root.superFetch.bind(window.root)
  : window.fetch.bind(window);

const FFMPEG_CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js";
const FFMPEG_WASM = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm";

/* ---------- helpers ---------- */

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function withTimeout(promise, ms, msg) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(msg || "Request timed out.")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

function cleanUrl(u) { return String(u || "").replace(/\\\//g, "/").replace(/&amp;/g, "&"); }

function isValidUrl(u) { return typeof u === "string" && /^https?:\/\//.test(u); }

/* ---------- URL parsing ---------- */

function extractShortcode(url) {
  const m = String(url).trim().match(/instagram\.com\/(?:[A-Za-z0-9._]{1,30}\/)?(?:reel|p|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function parseInput(raw) {
  const s = String(raw).trim();

  // /s/{base64} share URLs
  if (/instagram\.com\/s\//.test(s)) return { kind: "share", url: s };

  // Highlights
  if (/instagram\.com\/stories\/highlights\//.test(s)) return { kind: "highlight", url: s };
  if (/instagram\.com\/highlight\//.test(s)) return { kind: "highlight", url: s };

  // Stories
  if (/instagram\.com\/stories\//.test(s)) return { kind: "story", url: s };

  // Posts / Reels
  const code = extractShortcode(s);
  if (code) return { kind: "post", code, url: s };

  // Profile / DP
  const prof = s.match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:\?.*)?$/);
  if (prof && !/^(reel|p|reels|tv|stories|highlights|s|explore|accounts|direct|about|developer)$/.test(prof[1])) {
    return { kind: "dp", username: prof[1] };
  }
  if (/^[A-Za-z0-9._]{1,30}$/.test(s)) return { kind: "dp", username: s };

  return { kind: "unknown" };
}

/* ---------- InstaDrop API ---------- */

async function callInstadropApi(url) {
  const apiUrl = INSTADROP_API + encodeURIComponent(url);
  const res = await withTimeout(fetchLike(apiUrl), 60000, "The download service timed out.");
  if (!res.ok) {
    let msg = "Server error (HTTP " + res.status + ").";
    try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
    throw new Error(msg);
  }
  const data = await res.json();
  if (data && data.error && !data.p) throw new Error(data.error);
  if (data && data.p === false) throw new Error(data.message || data.error || "Unable to download this content.");
  return data;
}

/* Convert API response → items array [{kind, thumb, url}] */
function apiResponseToItems(data) {
  const items = [];
  const seen = new Set();
  const push = (url, thumb, kind) => {
    const u = cleanUrl(url);
    if (!isValidUrl(u) || seen.has(u)) return;
    seen.add(u);
    items.push({
      kind: kind || (/\.mp4(\?|&|$)/i.test(u) ? "video" : "image"),
      thumb: thumb ? cleanUrl(thumb) : null,
      url: u,
    });
  };

  if (!data || typeof data !== "object") return items;

  // Collection (story/highlight with items array)
  if (Array.isArray(data.items)) {
    for (const item of data.items) {
      const sub = apiResponseToItems(item);
      for (const m of sub) push(m.url, m.thumb, m.kind);
    }
    return items;
  }

  // Video array
  if (Array.isArray(data.video)) {
    for (const v of data.video) {
      if (typeof v === "string" && isValidUrl(v)) { push(v, null, "video"); continue; }
      if (v && typeof v === "object") {
        const videoUrl = v.video || v.url || v.video_url || v.download_url;
        const cover = v.cover || v.cover_url || v.thumbnail || v.thumbnail_url;
        if (isValidUrl(videoUrl)) push(videoUrl, cover, "video");
      }
    }
  }

  // Single video string
  if (typeof data.video === "string" && isValidUrl(data.video)) {
    push(data.video, data.cover, "video");
  }

  // Image array
  if (Array.isArray(data.image)) {
    for (const img of data.image) {
      if (typeof img === "string" && isValidUrl(img)) { push(img, img, "image"); continue; }
      if (img && typeof img === "object") {
        const imageUrl = img.image || img.url || img.image_url;
        if (isValidUrl(imageUrl)) push(imageUrl, imageUrl, "image");
      }
    }
  }

  // Single image string
  if (typeof data.image === "string" && isValidUrl(data.image)) {
    push(data.image, data.image, "image");
  }

  // Profile pic (DP response)
  if (data.profile_pic_url_hd || data.profile_pic_url) {
    push(data.profile_pic_url_hd || data.profile_pic_url, null, "image");
  }

  return items;
}

/* Fetch media (posts, reels, carousels, stories, highlights, share URLs) */
async function fetchMedia(url) {
  const data = await callInstadropApi(url);
  const items = apiResponseToItems(data);
  if (!items.length) {
    throw new Error("No downloadable media was found — the content may be private, deleted, or the session expired.");
  }
  const code = extractShortcode(url) || "media";
  return { code, items, data };
}

/* Fetch profile picture */
async function resolveAvatar(username) {
  const profileUrl = "https://www.instagram.com/" + username;
  const data = await callInstadropApi(profileUrl);
  const items = apiResponseToItems(data);
  if (!items.length) throw new Error("Couldn't find a profile picture for @" + username + ".");
  return { url: items[0].url, src: "instadrop", data };
}

/* ---------- blob download ---------- */

async function fetchBlob(url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await withTimeout(fetchLike(url), 60000, "The media host is busy right now.");
      if (!res.ok) throw new Error("Download failed (HTTP " + res.status + ").");
      return await res.blob();
    } catch (e) {
      lastErr = e;
    }
    if (i < tries - 1) await sleep(2500);
  }
  throw lastErr;
}

function triggerSave(blob, filename) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 15000);
}

function fmtDuration(sec) {
  if (!isFinite(sec) || sec <= 0) return "";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return m + ":" + String(s).padStart(2, "0");
}

function showError(msg) {
  errorEl.textContent = msg;
  errorEl.classList.remove("hidden");
}
function setBusy(on, text) {
  downloadBtn.disabled = on;
  if (text) spinnerText.textContent = text;
  spinnerCtn.classList.toggle("hidden", !on);
}
function scrollToResults() {
  resultCtn.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* ---------- DOM refs ---------- */

const urlInput = document.getElementById("urlInput");
const downloadBtn = document.getElementById("downloadBtn");
const spinnerCtn = document.getElementById("spinnerCtn");
const spinnerText = document.getElementById("spinnerText");
const errorEl = document.getElementById("errorEl");
const resultCtn = document.getElementById("result");
const histRow = document.getElementById("histRow");

/* ---------------- themes ---------------- */

function applyTheme(dark) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
}
function currentThemeChoice() {
  let cur = null;
  try { cur = localStorage.getItem("instadrop_theme"); } catch (e) {}
  return (cur === "light" || cur === "dark" || cur === "system") ? cur : "light";
}
function systemPrefersDark() {
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}
function applyChoice(choice) {
  if (choice === "system") applyTheme(systemPrefersDark());
  else applyTheme(choice === "dark");
}
function initThemes() {
  applyChoice(currentThemeChoice());
  const items = document.querySelectorAll(".theme-dd .dd-item, .side-theme-item");
  const syncActive = () => {
    const c = currentThemeChoice();
    for (const it of items) it.classList.toggle("dd-active", it.dataset.themeChoice === c);
  };
  for (const it of items) {
    it.addEventListener("click", () => {
      const c = it.dataset.themeChoice;
      try { localStorage.setItem("instadrop_theme", c); } catch (e) {}
      applyChoice(c);
      syncActive();
      const btn = document.querySelector(".theme-dd .dd-btn");
      if (btn) btn.blur();
    });
  }
  syncActive();
  const mq = window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)");
  if (mq && mq.addEventListener) {
    mq.addEventListener("change", (e) => { if (currentThemeChoice() === "system") applyTheme(e.matches); });
  }
}
initThemes();

/* navbar scroll border + section scrollspy */
const siteNav = document.getElementById("siteNav");
const onNavScroll = () => { if (siteNav) siteNav.classList.toggle("scrolled", window.scrollY > 35); };
window.addEventListener("scroll", onNavScroll, { passive: true });
onNavScroll();

const spySections = ["downloader", "features", "how", "faq"];
const navSpy = new IntersectionObserver((entries) => {
  for (const en of entries) {
    if (!en.isIntersecting) continue;
    for (const link of document.querySelectorAll(".nav-link")) {
      link.classList.toggle("navbar-active", link.getAttribute("href") === "#" + en.target.id);
    }
  }
}, { rootMargin: "-35% 0px -55% 0px" });
for (const id of spySections) {
  const el = document.getElementById(id);
  if (el) navSpy.observe(el);
}

/* ---------------- mobile hamburger menu ---------------- */
const hamburgerBtn = document.getElementById("hamburgerBtn");
const sideNav = document.getElementById("sideNav");
const sideOverlay = document.getElementById("sideOverlay");
const setSideOpen = (open) => {
  if (!sideNav) return;
  sideNav.classList.toggle("open", open);
  sideNav.setAttribute("aria-hidden", String(!open));
  if (sideOverlay) {
    sideOverlay.classList.toggle("visible", open);
    sideOverlay.setAttribute("aria-hidden", String(!open));
  }
  if (hamburgerBtn) {
    hamburgerBtn.classList.toggle("hamburger-open", open);
    hamburgerBtn.setAttribute("aria-expanded", String(open));
  }
  document.body.style.overflow = open ? "hidden" : "";
};
if (hamburgerBtn) {
  hamburgerBtn.addEventListener("click", () => setSideOpen(!sideNav.classList.contains("open")));
  if (sideOverlay) sideOverlay.addEventListener("click", () => setSideOpen(false));
  if (sideNav) sideNav.addEventListener("click", (e) => { if (e.target.closest("a")) setSideOpen(false); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") setSideOpen(false); });
  window.addEventListener("resize", () => { if (window.innerWidth > 1023) setSideOpen(false); });
}

/* ---------------- scroll reveal ---------------- */
const revealEls = document.querySelectorAll(".reveal");
if ("IntersectionObserver" in window) {
  const revealObs = new IntersectionObserver((entries, obs) => {
    for (const en of entries) {
      if (!en.isIntersecting) continue;
      en.target.classList.add("in-view");
      obs.unobserve(en.target);
    }
  }, { threshold: 0.12, rootMargin: "0px 0px -6% 0px" });
  for (const el of revealEls) revealObs.observe(el);
} else {
  for (const el of revealEls) el.classList.add("in-view");
}

/* ---------------- header search + demo chips ---------------- */

const scrollToCardBtn = document.getElementById("scrollToCardBtn");
if (scrollToCardBtn) {
  scrollToCardBtn.addEventListener("click", () => {
    urlInput.scrollIntoView({ behavior: "smooth", block: "center" });
    setTimeout(() => urlInput.focus(), 500);
  });
}

const focusDownloader = () => {
  urlInput.scrollIntoView({ behavior: "smooth", block: "center" });
  setTimeout(() => urlInput.focus(), 500);
};
if (["reel", "profile", "audio"].includes((location.hash || "").replace(/^#/, ""))) {
  setTimeout(focusDownloader, 100);
}

const inputWrap = document.querySelector(".input-wrap");
const phScroll = document.querySelector(".ph-scroll");
const phMarquee = document.querySelector(".ph-marquee");
if (inputWrap && urlInput) {
  const syncPh = () => inputWrap.classList.toggle("has-val", urlInput.value.length > 0);
  urlInput.addEventListener("input", syncPh);
  syncPh();
}
if (phScroll && phMarquee) {
  const syncMarq = () => phMarquee.classList.toggle("marq-on", phMarquee.scrollWidth > phScroll.clientWidth);
  window.addEventListener("resize", syncMarq);
  syncMarq();
}

const pasteBtn = document.getElementById("pasteBtn");
if (pasteBtn) {
  pasteBtn.addEventListener("click", async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text || !text.trim()) {
        showError("Clipboard is empty — copy an Instagram link first, then press Paste.");
        return;
      }
      urlInput.value = text.trim();
      if (inputWrap) inputWrap.classList.add("has-val");
      errorEl.classList.add("hidden");
      if (parseInput(urlInput.value).kind !== "unknown") downloadBtn.click();
    } catch (e) {
      showError("Couldn't read the clipboard — press Ctrl+V inside the box instead.");
      urlInput.focus();
    }
  });
}

/* ---------------- prefill via ?url= (Apple Shortcuts / share sheet) ---------------- */

function prefillFromQuery() {
  const params = new URLSearchParams(location.search);
  const raw = params.get("url") || params.get("u");
  if (!raw) return;
  const val = String(raw).trim();
  if (!/^https?:\/\//i.test(val) || /shortcut[- ]?input/i.test(val)) return;
  urlInput.value = val;
  if (inputWrap) inputWrap.classList.add("has-val");
  errorEl.classList.add("hidden");
  history.replaceState(null, "", location.pathname + location.hash);
  setTimeout(() => downloadBtn.click(), 350);
}
prefillFromQuery();

const copyShortcutUrlBtn = document.getElementById("copyShortcutUrlBtn");
if (copyShortcutUrlBtn) {
  copyShortcutUrlBtn.addEventListener("click", async () => {
    const codeEl = document.getElementById("shortcutUrlCode");
    try {
      await navigator.clipboard.writeText(codeEl ? codeEl.textContent : "https://instadrop.web.app/?url=");
      copyShortcutUrlBtn.textContent = "Copied ✓";
      setTimeout(() => { copyShortcutUrlBtn.textContent = "Copy URL template"; }, 2500);
    } catch (e) {
      showError("Couldn't copy — long-press the URL above instead.");
    }
  });
}

for (const faq of document.querySelectorAll("details.accordion")) {
  faq.addEventListener("toggle", () => faq.classList.toggle("accordion-open", faq.open));
}

/* ---------------- history ---------------- */

function loadHistory() {
  try { return JSON.parse(localStorage.getItem("instadrop_history") || "[]"); } catch (e) { return []; }
}
function saveHistory(h) {
  try { localStorage.setItem("instadrop_history", JSON.stringify(h.slice(0, 8))); } catch (e) {}
}
function addHistory(entry) {
  const h = loadHistory().filter(x => !(x.kind === entry.kind && x.label === entry.label));
  h.unshift(entry);
  saveHistory(h);
  renderHistory();
}
function renderHistory() {
  const h = loadHistory();
  histRow.classList.toggle("hidden", h.length === 0);
  histRow.innerHTML = "";
  if (!h.length) return;
  const lbl = document.createElement("span");
  lbl.className = "lbl";
  lbl.textContent = "Recent:";
  histRow.appendChild(lbl);
  for (const entry of h) {
    const c = document.createElement("button");
    c.className = "chip";
    c.textContent = entry.label;
    c.addEventListener("click", () => {
      urlInput.value = entry.input;
      if (inputWrap) inputWrap.classList.add("has-val");
      downloadBtn.click();
    });
    histRow.appendChild(c);
  }
  const cl = document.createElement("button");
  cl.className = "chip clear";
  cl.textContent = "clear";
  cl.addEventListener("click", () => { saveHistory([]); renderHistory(); });
  histRow.appendChild(cl);
}
renderHistory();

/* ---------------- ffmpeg (audio -> mp3) ---------------- */

let ffmpegReady = null;

function getFfmpeg() {
  if (ffmpegReady) return ffmpegReady;
  ffmpegReady = (async () => {
    const coreJs = await (await fetch(FFMPEG_CORE)).text();
    const coreUrl = URL.createObjectURL(new Blob([coreJs], { type: "text/javascript" }));
    const frag = btoa(JSON.stringify({ wasmURL: FFMPEG_WASM, workerURL: "" }));
    const msbo = coreUrl + "#" + frag;
    const src =
      "importScripts(" + JSON.stringify(coreUrl) + ");\n" +
      "self.onmessage = async (e) => {\n" +
      "  if (e.data.load) {\n" +
      "    try { self.__mod = await createFFmpegCore({ mainScriptUrlOrBlob: " + JSON.stringify(msbo) + " }); self.postMessage({ ok: true }); }\n" +
      "    catch (err) { self.postMessage({ err: String(err) }); }\n" +
      "  } else if (e.data.data) {\n" +
      "    try {\n" +
      "      const mod = self.__mod;\n" +
      "      mod.FS.writeFile(e.data.input, new Uint8Array(e.data.data));\n" +
      "      const ret = mod.exec(...e.data.args);\n" +
      "      const out = mod.FS.readFile(e.data.output);\n" +
      "      const buf = out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);\n" +
      "      self.postMessage({ mp3: buf }, [buf]);\n" +
      "    } catch (err) { self.postMessage({ err: String(err) }); }\n" +
      "  }\n" +
      "};\n";
    const worker = new Worker(URL.createObjectURL(new Blob([src], { type: "text/javascript" })));
    await new Promise((resolve, reject) => {
      worker.onmessage = (e) => e.data && e.data.ok ? resolve() : reject(new Error((e.data && e.data.err) || "Failed to start audio converter."));
      worker.onerror = (e) => reject(new Error(e.message));
      worker.postMessage({ load: true });
    });
    return worker;
  })();
  ffmpegReady.catch(() => { ffmpegReady = null; });
  return ffmpegReady;
}

let audioQueue = Promise.resolve();

function convertToMp3(bytes) {
  const run = audioQueue.then(async () => {
    const worker = await getFfmpeg();
    return await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Audio conversion timed out.")), 240000);
      worker.onmessage = (e) => {
        if (e.data && e.data.mp3) { clearTimeout(timeout); resolve(new Uint8Array(e.data.mp3)); }
        else if (e.data && e.data.err) { clearTimeout(timeout); reject(new Error(e.data.err)); }
      };
      worker.onerror = (e) => { clearTimeout(timeout); reject(new Error(e.message)); };
      worker.postMessage({
        input: "in.mp4",
        output: "out.mp3",
        args: ["-i", "in.mp4", "-vn", "-acodec", "libmp3lame", "-q:a", "4", "out.mp3"],
        data: bytes,
      }, [bytes.buffer]);
    });
  });
  audioQueue = run.catch(() => {});
  return run;
}

/* ---------------- UI renderers ---------------- */

function metaBar(rowEl) {
  const meta = document.createElement("div");
  meta.className = "meta";
  const row = document.createElement("div");
  row.className = "row";
  row.appendChild(rowEl);
  meta.appendChild(row);
  return meta;
}

function wrapResult(htmlEl) {
  const card = document.createElement("div");
  card.className = "result-card";
  card.appendChild(htmlEl);
  return card;
}

async function renderItems(data, opts, input) {
  const who = document.createElement("span");
  who.className = "who";

  // Build label from API data if available
  let label = opts.label || (data.items.length > 1 ? data.items.length + " media items" : "1 media item");
  if (data.data && data.data.username) {
    label = "@" + data.data.username + " · " + label;
  }
  if (data.data && data.data.highlight_title) {
    label = "✨ " + data.data.highlight_title + " · " + label;
  }
  who.textContent = label;

  const open = document.createElement("a");
  open.className = "open";
  open.href = opts.openUrl;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = opts.openLabel || "Open ↗";
  const metaEl = metaBar(who);
  metaEl.querySelector(".row").appendChild(open);
  const card = wrapResult(metaEl);
  resultCtn.appendChild(card);

  // Show details button if we have engagement data
  if (data.data && (data.data.caption || data.data.like_count !== undefined || data.data.follower_count !== undefined)) {
    const detailsRow = document.createElement("div");
    detailsRow.className = "dl-row";
    const detailsBtn = document.createElement("button");
    detailsBtn.className = "dl-btn alt";
    detailsBtn.textContent = "📋 Details";
    detailsBtn.style.marginBottom = "12px";
    detailsBtn.addEventListener("click", () => {
      const d = data.data;
      const lines = [];
      if (d.username) lines.push("👤 @" + d.username);
      if (d.full_name) lines.push("📛 " + d.full_name);
      if (d.is_verified) lines.push("✅ Verified");
      if (d.is_private) lines.push("🔒 Private account");
      if (d.is_business) lines.push("💼 Business account");
      if (d.category) lines.push("🏷️ " + d.category);
      if (d.bio) lines.push("\n📝 " + d.bio);
      if (d.follower_count !== undefined) lines.push("\n👥 Followers: " + d.follower_count);
      if (d.following_count !== undefined) lines.push("👤 Following: " + d.following_count);
      if (d.post_count !== undefined) lines.push("📦 Posts: " + d.post_count);
      if (d.caption) lines.push("\n📝 Caption:\n" + d.caption);
      if (d.taken_at) lines.push("\n📅 Posted: " + d.taken_at);
      if (d.like_count !== undefined) {
        if (d.like_count_disabled) lines.push("\n❤️ Likes: Hidden by creator");
        else lines.push("\n❤️ Likes: " + d.like_count);
      }
      if (d.comment_count !== undefined) {
        if (d.comments_disabled) lines.push("💬 Comments: Turned off");
        else lines.push("💬 Comments: " + d.comment_count);
      }
      if (d.view_count > 0) lines.push("👀 Views: " + d.view_count);
      if (d.play_count > 0) lines.push("▶️ Plays: " + d.play_count);
      if (d.highlight_title) lines.push("\n✨ Highlight: " + d.highlight_title);

      alert(lines.join("\n"));
    });
    detailsRow.appendChild(detailsBtn);
    card.appendChild(detailsRow);
  }

  data.items.forEach((item, i) => {
    const box = document.createElement("div");
    box.className = "item";
    const ext = item.kind === "video" ? "mp4" : "jpg";
    const filename = opts.filePrefix + (data.items.length > 1 ? "_" + (i + 1) : "") + "." + ext;

    const frame = document.createElement("div");
    frame.className = "media-frame";
    const hint = document.createElement("div");
    hint.className = "frame-hint";
    hint.innerHTML = '<div class="spinner"></div><span>Loading preview…</span>';
    frame.appendChild(hint);
    box.appendChild(frame);

    const row = document.createElement("div");
    row.className = "dl-row";

    const saveBtn = document.createElement("button");
    saveBtn.className = "dl-btn";
    saveBtn.disabled = true;
    saveBtn.textContent = "Download";
    saveBtn.title = "Downloads straight to your device.";
    row.appendChild(saveBtn);

    const audioBtn = item.kind === "video" ? document.createElement("button") : null;
    if (audioBtn) {
      audioBtn.className = "dl-btn alt";
      audioBtn.disabled = true;
      audioBtn.textContent = "Audio (MP3)";
      audioBtn.title = "Extracts audio as MP3.";
      row.appendChild(audioBtn);
    }
    box.appendChild(row);

    card.appendChild(box);

    frame.innerHTML = "";
    if (item.kind === "video") {
      const v = document.createElement("video");
      v.controls = true;
      v.playsInline = true;
      v.src = item.url;
      const badge = document.createElement("span");
      badge.className = "media-badge hidden";
      v.addEventListener("loadedmetadata", () => {
        badge.textContent = fmtDuration(v.duration) + " · " + v.videoWidth + "×" + v.videoHeight;
        badge.classList.remove("hidden");
      });
      frame.appendChild(v);
      frame.appendChild(badge);
    } else {
      const im = document.createElement("img");
      im.src = item.url;
      im.alt = "Instagram image";
      frame.appendChild(im);
    }

    fetchBlob(item.url).then(async (blob) => {
      const mb = (blob.size / 1048576).toFixed(1);
      const bytes = item.kind === "video" ? new Uint8Array(await blob.arrayBuffer()) : null;
      saveBtn.disabled = false;
      saveBtn.textContent = "Download (" + mb + " MB)";
      saveBtn.onclick = () => triggerSave(blob, filename);
      if (audioBtn) {
        audioBtn.disabled = false;
        audioBtn.onclick = async () => {
          audioBtn.disabled = true;
          audioBtn.textContent = "Preparing audio…";
          if (!ffmpegReady) {
            spinnerCtn.classList.remove("hidden");
            spinnerText.textContent = "Downloading audio converter (one-time)…";
          }
          try {
            const mp3 = await convertToMp3(bytes);
            spinnerCtn.classList.add("hidden");
            triggerSave(new Blob([mp3], { type: "audio/mpeg" }), filename.replace(/\.mp4$/, ".mp3"));
            audioBtn.textContent = "MP3 saved ✓";
            setTimeout(() => { audioBtn.textContent = "Audio (MP3)"; audioBtn.disabled = false; }, 4000);
          } catch (e) {
            spinnerCtn.classList.add("hidden");
            showError("Audio failed: " + e.message);
            audioBtn.textContent = "Audio (MP3)";
            audioBtn.disabled = false;
          }
        };
      }
    }).catch(() => {
      const note = document.createElement("div");
      note.className = "frame-hint";
      note.textContent = "Preview shown above. Media host is busy — use the Download button.";
      frame.appendChild(note);
      saveBtn.textContent = "Download (busy)";
      if (audioBtn) {
        audioBtn.textContent = "Audio (needs preview)";
      }
    });
  });
  addHistory({ kind: opts.historyKind || "post", label: opts.historyLabel, input });
}

async function renderPost(data, input) {
  await renderItems(data, {
    openUrl: "https://www.instagram.com/reel/" + data.code + "/",
    label: data.items.length > 1 ? data.items.length + " media items" : "1 media item",
    filePrefix: "instagram_" + data.code,
    historyKind: "post",
    historyLabel: data.code,
  }, input);
}

async function renderDp(username, input) {
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = "Profile picture of @" + username;
  const open = document.createElement("a");
  open.className = "open";
  open.href = "https://www.instagram.com/" + encodeURIComponent(username) + "/";
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = "Open profile ↗";
  const metaEl = metaBar(who);
  metaEl.querySelector(".row").appendChild(open);
  const card = wrapResult(metaEl);
  resultCtn.appendChild(card);

  const box = document.createElement("div");
  box.className = "item";
  const frame = document.createElement("div");
  frame.className = "media-frame dp-avatar";
  const hint = document.createElement("div");
  hint.className = "frame-hint";
  hint.innerHTML = '<div class="spinner"></div><span>Fetching profile…</span>';
  frame.appendChild(hint);
  box.appendChild(frame);
  const row = document.createElement("div");
  row.className = "dl-row";
  const btn = document.createElement("button");
  btn.className = "dl-btn";
  btn.disabled = true;
  btn.textContent = "Preparing…";
  row.appendChild(btn);
  box.appendChild(row);
  card.appendChild(box);

  const avatar = await resolveAvatar(username);
  frame.innerHTML = "";
  const im = document.createElement("img");
  im.src = avatar.url;
  im.alt = "@" + username + " profile picture";
  frame.appendChild(im);
  const badge = document.createElement("span");
  badge.className = "media-badge";
  badge.textContent = "…";
  frame.appendChild(badge);
  const dims = await new Promise((res) => {
    const probe = new Image();
    probe.onload = () => res({ w: probe.naturalWidth, h: probe.naturalHeight });
    probe.onerror = () => res(null);
    probe.src = avatar.url;
  });
  const nw = dims ? dims.w : "?";
  const nh = dims ? dims.h : "?";
  badge.textContent = nw + "×" + nh + (dims ? " · original" : "");
  btn.disabled = false;
  btn.textContent = "Download profile pic (" + nw + "×" + nh + ")";
  btn.onclick = async () => {
    try {
      const blob = await withTimeout(fetchBlob(avatar.url, 1), 25000, "Download timed out.");
      triggerSave(blob, username + "_profile_pic_" + nw + "x" + nh + ".jpg");
    } catch (e) {
      window.open(avatar.url, "_blank");
      showError("Your browser blocked direct download. Opened picture in new tab — right click and save image.");
    }
  };

  // Show profile details button
  if (avatar.data && (avatar.data.full_name || avatar.data.follower_count !== undefined)) {
    const d = avatar.data;
    const detailsRow = document.createElement("div");
    detailsRow.className = "dl-row";
    const detailsBtn = document.createElement("button");
    detailsBtn.className = "dl-btn alt";
    detailsBtn.textContent = "📋 Profile Details";
    detailsBtn.style.marginTop = "8px";
    detailsBtn.addEventListener("click", () => {
      const lines = [];
      if (d.username) lines.push("👤 @" + d.username);
      if (d.full_name) lines.push("📛 " + d.full_name);
      if (d.is_verified) lines.push("✅ Verified");
      if (d.is_private) lines.push("🔒 Private account");
      if (d.is_business) lines.push("💼 Business account");
      if (d.category) lines.push("🏷️ " + d.category);
      if (d.bio) lines.push("\n📝 " + d.bio);
      if (d.follower_count !== undefined) lines.push("\n👥 Followers: " + d.follower_count);
      if (d.following_count !== undefined) lines.push("👤 Following: " + d.following_count);
      if (d.post_count !== undefined) lines.push("📦 Posts: " + d.post_count);
      if (d.external_url) lines.push("🌐 " + d.external_url);
      alert(lines.join("\n"));
    });
    detailsRow.appendChild(detailsBtn);
    card.appendChild(detailsRow);
  }

  addHistory({ kind: "dp", label: "@" + username, input });
}

/* ---------------- main action ---------------- */

downloadBtn.addEventListener("click", async () => {
  const input = urlInput.value.trim();
  errorEl.classList.add("hidden");
  resultCtn.classList.add("hidden");
  resultCtn.innerHTML = "";

  const parsed = parseInput(input);
  if (parsed.kind === "unknown") {
    showError("Paste a full Instagram link (reel/post, story or highlight), a profile link, or a bare username.");
    return;
  }

  resultCtn.classList.remove("hidden");

  // Posts, reels, stories, highlights, share URLs — all go through the same API
  if (parsed.kind === "post" || parsed.kind === "story" || parsed.kind === "highlight" || parsed.kind === "share") {
    const loadingText =
      parsed.kind === "story" ? "Looking up the story…" :
      parsed.kind === "highlight" ? "Looking up the highlight…" :
      parsed.kind === "share" ? "Resolving the shared link…" :
      "Resolving the post…";
    setBusy(true, loadingText);
    try {
      const data = await fetchMedia(input);
      const id = parsed.code ||
        ((parsed.url || "").match(/highlights\/(\d+)/) || [])[1] ||
        ((parsed.url || "").match(/highlight\/(\d+)/) || [])[1] ||
        "media";
      await renderItems(data, {
        openUrl: parsed.url || ("https://www.instagram.com/reel/" + data.code + "/"),
        label:
          (parsed.kind === "highlight" ? "Highlight" :
           parsed.kind === "story" ? "Story" :
           parsed.kind === "share" ? "Shared media" :
           data.items.length > 1 ? "Carousel" : "Post") +
          " · " + (data.items.length > 1 ? data.items.length + " media items" : "1 media item"),
        filePrefix:
          parsed.kind === "highlight" ? "highlight_" + id :
          parsed.kind === "story" ? "story" :
          parsed.kind === "share" ? "instadrop_" + id :
          "instagram_" + data.code,
        historyKind: parsed.kind,
        historyLabel:
          parsed.kind === "highlight" ? "highlight " + id :
          parsed.kind === "story" ? "story" :
          parsed.kind === "share" ? "shared " + id :
          data.code,
      }, input);
      scrollToResults();
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
    return;
  }

  // Profile / DP
  if (parsed.kind === "dp") {
    setBusy(true, "Looking up @" + parsed.username + "…");
    try {
      await renderDp(parsed.username, input);
      scrollToResults();
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
    return;
  }
});

document.addEventListener("DOMContentLoaded", () => {
  if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0 && location.hostname.indexOf("perchance") === -1) {
    navigator.serviceWorker.register("sw.js").catch(() => {});
  }
});
urlInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") downloadBtn.click();
});
