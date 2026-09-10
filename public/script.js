/* ============================================================
   Instadrop - script.js
   Standalone application logic.
   ============================================================ */

/* Network helper: plain browser fetch. */
const fetchLike = window.fetch.bind(window);

/* ---------- single API (your Cloudflare Worker) ----------
   Handles: reels, posts, carousels, stories, highlights, profile pics.
   GET https://instadrop.rishu-rishad2019.workers.dev/?url=<instagram url>
   JSON shapes:
     - post/reel/story: { p:true, image:[urls], video:[{video,cover}], caption, username,
                          taken_at, like_count, comment_count, view_count, play_count, ... }
     - profile (dp):    { p:true, type:"dp", image:[hdUrl], username, full_name, bio,
                          bio_links, follower_count, following_count, post_count,
                          is_private, is_verified, profile_pic_url, profile_pic_url_hd }
     - highlight:       { p:true, type:"highlight", username, highlight_title,
                          highlight_cover, count, items:[{image, video, caption, ...}] }
     - errors:          HTTP 404 with { error: "message" }   */
const MY_API = "https://instadrop.rishu-rishad2019.workers.dev/?url=";

function cleanUrl(u) { return String(u || "").replace(/\\\//g, "/").replace(/&amp;/g, "&"); }

async function myApi(url) {
  let res;
  try {
    res = await withTimeout(fetchLike(MY_API + encodeURIComponent(url)), 60000, "The download service timed out.");
  } catch (e) {
    throw new Error(e && e.message ? e.message : "The download service is unreachable.");
  }
  let j = null;
  try { j = await res.json(); } catch (e) {}
  if (j && typeof j === "object" && j.error) throw new Error(j.error);
  if (!res.ok) throw new Error("The download service returned HTTP " + res.status + ".");
  if (!j || typeof j !== "object") throw new Error("The download service returned an empty response.");
  return j;
}

/* Convert any API response into a uniform item list:
   [{ kind:"image", thumb, url }, { kind:"video", thumb, url }]
   Each video's cover/poster is kept in `thumb` AND added as its own image
   item (so a reel's cover shows up in the media list too), unless an image
   with the same URL is already present. */
function normalizeApi(j) {
  const items = [];
  const seen = new Set();
  const add = (image, video) => {
    const imgs = Array.isArray(image) ? image : [];
    for (const u of imgs) {
      const cu = cleanUrl(u);
      if (/^https?:\/\//.test(cu) && !seen.has(cu)) { seen.add(cu); items.push({ kind: "image", thumb: cu, url: cu }); }
    }
    const vids = Array.isArray(video) ? video : [];
    for (const v of vids) {
      if (!v || typeof v !== "object" || !v.video) continue;
      const vu = cleanUrl(v.video);
      if (!/^https?:\/\//.test(vu) || seen.has(vu)) continue;
      seen.add(vu);
      const cover = v.cover ? cleanUrl(v.cover) : null;
      items.push({ kind: "video", thumb: cover, url: vu });
      if (cover && /^https?:\/\//.test(cover) && !seen.has(cover)) {
        seen.add(cover);
        items.push({ kind: "image", thumb: cover, url: cover, isCover: true });
      }
    }
  };
  if (j.type === "highlight" && Array.isArray(j.items)) {
    for (const it of j.items) add(it.image, it.video);
  } else {
    add(j.image, j.video);
  }
  return items;
}

async function fetchMedia(url) {
  const code = extractShortcode(url);
  if (!code) throw new Error("That doesn't look like an Instagram reel/post link.");
  const cleanUrl_ = "https://www.instagram.com/reel/" + code + "/";
  const j = await myApi(cleanUrl_);
  const items = normalizeApi(j);
  if (!items.length) throw new Error("No downloadable media was found in that post — it may be private or deleted.");
  return {
    code,
    items,
    meta: {
      caption: j.caption,
      username: j.username,
      likeCount: j.like_count,
      commentCount: j.comment_count,
      playCount: j.play_count,
    },
  };
}

async function fetchStoryHighlight(url) {
  const j = await myApi(url);
  const items = normalizeApi(j);
  if (!items.length) throw new Error("No downloadable media was found there — it may be private or expired.");
  return {
    items,
    meta: {
      type: j.type,
      title: j.highlight_title,
      count: j.count,
      caption: j.caption,
      username: j.username,
    },
  };
}

async function fetchProfile(username) {
  const j = await myApi("https://www.instagram.com/" + encodeURIComponent(username) + "/");
  if (j.type !== "dp" && !j.profile_pic_url_hd && !j.profile_pic_url) {
    throw new Error("Couldn't find a profile picture for @" + username + ".");
  }
  return j;
}

const FFMPEG_CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js";
const FFMPEG_WASM = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm";

const urlInput = document.getElementById("urlInput");
const downloadBtn = document.getElementById("downloadBtn");
const spinnerCtn = document.getElementById("spinnerCtn");
const spinnerText = document.getElementById("spinnerText");
const errorEl = document.getElementById("errorEl");
const resultCtn = document.getElementById("result");
const histRow = document.getElementById("histRow");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

function withTimeout(promise, ms, msg) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, rej) => { timer = setTimeout(() => rej(new Error(msg || "Request timed out.")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

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

/* ---------------- helpers ---------------- */

function extractShortcode(url) {
  const m = String(url).trim().match(/instagram\.com\/(?:[A-Za-z0-9._]{1,30}\/)?(?:reel|p|reels|tv)\/([A-Za-z0-9_-]+)/);
  return m ? m[1] : null;
}

function parseInput(raw) {
  const s = String(raw).trim();
  if (/instagram\.com\/stories\/highlights\//.test(s)) return { kind: "highlight", url: s };
  if (/instagram\.com\/stories\//.test(s)) return { kind: "story", url: s };
  const code = extractShortcode(s);
  if (code) return { kind: "post", code };
  const prof = s.match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/?(?:\?.*)?$/);
  if (prof && !/^(reel|p|reels|tv|stories|highlights)$/.test(prof[1])) return { kind: "dp", username: prof[1] };
  if (/^[A-Za-z0-9._]{1,30}$/.test(s)) return { kind: "dp", username: s };
  return { kind: "unknown" };
}

/* Some Instagram CDN hosts serve media with `Cross-Origin-Resource-Policy:
   same-origin` and no CORS headers, so a direct fetch() of the bytes is
   blocked. These CORS-friendly proxies re-serve the file server-side and are
   only tried when the direct fetch (and its retry) both fail. */
const MEDIA_PROXIES = [
  { name: "allorigins", build: (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u) },
  { name: "codetabs",   build: (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u) },
];

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
  for (const proxy of MEDIA_PROXIES) {
    try {
      const res = await withTimeout(fetchLike(proxy.build(url)), 45000, proxy.name + " timed out.");
      if (!res.ok) continue;
      const b = await res.blob();
      if (b && b.size > 0) return b;
    } catch (e) { lastErr = e; }
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

function fmtCount(n) {
  if (n == null || !isFinite(n) || n <= 0) return "";
  if (n >= 1000000) return (n / 1000000).toFixed((n % 1000000) ? 1 : 0) + "M";
  if (n >= 1000) return (n / 1000).toFixed((n % 1000) ? 1 : 0) + "K";
  return String(n);
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

const COPY_ICON = '<svg class="ic-copy" viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M4 1.5H3a2 2 0 0 0-2 2V14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V3.5a2 2 0 0 0-2-2h-1v1h1a1 1 0 0 1 1 1V14a1 1 0 0 1-1 1H3a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1h1v-1z"/><path d="M9.5 1a.5.5 0 0 1 .5.5v1a.5.5 0 0 1-.5.5h-3a.5.5 0 0 1-.5-.5v-1a.5.5 0 0 1 .5-.5h3zm-3-1A1.5 1.5 0 0 0 5 1.5v1A1.5 1.5 0 0 0 6.5 4h3A1.5 1.5 0 0 0 11 2.5v-1A1.5 1.5 0 0 0 9.5 0h-3z"/></svg>';
const CHECK_ICON = '<svg class="ic-check" viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M13.485 1.431a1.473 1.473 0 0 1 2.104 2.062l-7.84 9.801a1.473 1.473 0 0 1-2.12.04L.431 8.138a1.473 1.473 0 0 1 2.084-2.083l4.111 4.112 6.82-8.69a.486.486 0 0 1 .039-.046z"/></svg>';

async function copyText(text) {
  const value = String(text == null ? "" : text);
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return true;
    }
  } catch (e) { /* fall through to the legacy path below */ }
  try {
    const ta = document.createElement("textarea");
    ta.value = value;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.top = "-1000px";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, value.length);
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch (e) {
    return false;
  }
}

function addMetaExtra(metaEl, data) {
  if (!data || !data.meta) return;
  const bits = [];
  if (data.meta.title) bits.push("Highlight: " + data.meta.title);
  if (data.meta.likeCount > 0) bits.push("Likes: " + fmtCount(data.meta.likeCount));
  if (data.meta.commentCount > 0) bits.push("Comments: " + fmtCount(data.meta.commentCount));
  if (data.meta.playCount > 0) bits.push("Plays: " + fmtCount(data.meta.playCount));
  if (bits.length) {
    const stats = document.createElement("div");
    stats.className = "meta-extra";
    stats.textContent = bits.join("  ·  ");
    metaEl.querySelector(".row").appendChild(stats);
  }
  if (data.meta.caption) {
    const full = String(data.meta.caption);
    const cap = document.createElement("div");
    cap.className = "meta-extra caption";

    const text = document.createElement("span");
    text.className = "caption-text";
    text.textContent = full.length > 220 ? full.slice(0, 220) + "…" : full;

    const copyBtn = document.createElement("button");
    copyBtn.type = "button";
    copyBtn.className = "copy-btn";
    copyBtn.title = "Copy caption";
    copyBtn.setAttribute("aria-label", "Copy caption to clipboard");
    copyBtn.innerHTML = COPY_ICON + CHECK_ICON + '<span class="copy-label">Copy</span>';
    copyBtn.addEventListener("click", async () => {
      const ok = await copyText(full);
      const label = copyBtn.querySelector(".copy-label");
      clearTimeout(copyBtn._resetTimer);
      copyBtn.classList.toggle("copied", ok);
      label.textContent = ok ? "Copied" : "Copy failed";
      copyBtn._resetTimer = setTimeout(() => {
        copyBtn.classList.remove("copied");
        label.textContent = "Copy";
      }, 2000);
    });

    cap.appendChild(text);
    cap.appendChild(copyBtn);
    metaEl.appendChild(cap);
  }
}

function wrapResult(htmlEl) {
  const card = document.createElement("div");
  card.className = "result-card";
  card.appendChild(htmlEl);
  return card;
}

/* Profile pics are fetched through a chain of CORS-friendly proxies.
   Instagram serves profile pics (scontent.cdninstagram.com) with
   `Cross-Origin-Resource-Policy: same-origin` and no CORS headers, so the
   browser blocks BOTH the cross-origin <img> preview (the blank box /
   ERR_BLOCKED_BY_RESPONSE.NotSameOrigin, and why the size showed "?x?")
   AND any direct fetch() of the bytes. Each proxy below fetches the image
   server-side and re-serves it with permissive CORS headers, so the bytes
   come back fine. `direct` is tried first in case a CDN host allows it. */
const PIC_PROXIES = [
  { name: "direct",     build: (u) => u },
  { name: "allorigins", build: (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u) },
  { name: "wsrv",       build: (u) => "https://images.weserv.nl/?url=" + encodeURIComponent(u.replace(/^https?:\/\//, "")) },
];

async function fetchProfilePicBytes(url) {
  for (const proxy of PIC_PROXIES) {
    try {
      const res = await withTimeout(fetchLike(proxy.build(url)), 20000, proxy.name + " timed out.");
      if (!res.ok) continue;
      const b = await res.blob();
      if (!b || b.size < 512) continue;
      if (b.type && !/^image\//.test(b.type)) continue; // skip HTML/JSON error pages
      return b;
    } catch (e) { /* try next proxy */ }
  }
  return null;
}

async function renderItems(data, opts, input) {
  const who = document.createElement("span");
  who.className = "who";
  who.textContent = opts.label || (data.items.length > 1 ? data.items.length + " media items" : "1 media item");
  const open = document.createElement("a");
  open.className = "open";
  open.href = opts.openUrl;
  open.target = "_blank";
  open.rel = "noopener noreferrer";
  open.textContent = opts.openLabel || "Open ↗";
  const metaEl = metaBar(who);
  metaEl.querySelector(".row").appendChild(open);
  addMetaExtra(metaEl, data);
  const card = wrapResult(metaEl);
  resultCtn.appendChild(card);

  data.items.forEach((item, i) => {
    const box = document.createElement("div");
    box.className = "item";
    const ext = item.kind === "video" ? "mp4" : "jpg";
    const filename = opts.filePrefix + (data.items.length > 1 ? "_" + (i + 1) : "") + "." + ext;

    const frame = document.createElement("div");
    frame.className = "media-frame";
    const hint = document.createElement("div");
    hint.className = "frame-hint loading";
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
    const isVideo = item.kind === "video";
    const media = document.createElement(isVideo ? "video" : "img");
    media.className = "media-el";
    media.referrerPolicy = "no-referrer";
    if (isVideo) {
      media.controls = true;
      media.playsInline = true;
      media.setAttribute("playsinline", "");
    } else {
      media.alt = item.isCover ? "Reel cover image" : "Instagram image";
    }

    const badge = document.createElement("span");
    badge.className = "media-badge hidden";
    if (isVideo) {
      media.addEventListener("loadedmetadata", () => {
        if (!media.videoWidth) return;
        badge.textContent = fmtDuration(media.duration) + " · " + media.videoWidth + "×" + media.videoHeight;
        badge.classList.remove("hidden");
      });
    } else {
      badge.textContent = item.isCover ? "Cover" : "Photo";
      badge.classList.remove("hidden");
    }

    frame.appendChild(media);
    frame.appendChild(badge);
    frame.appendChild(hint);
    const dropHint = () => hint.remove();
    media.addEventListener(isVideo ? "loadeddata" : "load", dropHint, { once: true });

    if (isVideo && item.thumb) {
      fetchBlob(item.thumb, 1).then((b) => { media.poster = URL.createObjectURL(b); dropHint(); }).catch(() => {});
    }
    media.src = item.url;

    fetchBlob(item.url).then(async (blob) => {
      const mb = (blob.size / 1048576).toFixed(1);
      const bytes = isVideo ? new Uint8Array(await blob.arrayBuffer()) : null;
      media.src = URL.createObjectURL(blob);
      dropHint();
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

async function renderDp(username, input) {
  const profile = await fetchProfile(username);
  const pic = (Array.isArray(profile.image) && profile.image[0]) || profile.profile_pic_url_hd || profile.profile_pic_url;
  if (!pic) throw new Error("Couldn't find a profile picture for @" + username + ".");

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

  const details = document.createElement("div");
  details.className = "profile-info";
  const head = document.createElement("div");
  head.className = "profile-head";
  head.textContent = (profile.full_name || "@" + username) + (profile.is_verified ? " ✓" : "");
  details.appendChild(head);
  const stats = document.createElement("div");
  stats.className = "profile-stats";
  const statParts = [];
  if (profile.follower_count != null) statParts.push(profile.follower_count.toLocaleString() + " followers");
  if (profile.following_count != null) statParts.push(profile.following_count.toLocaleString() + " following");
  if (profile.post_count != null) statParts.push(profile.post_count.toLocaleString() + " posts");
  stats.textContent = statParts.join("  ·  ");
  details.appendChild(stats);
  if (profile.bio) {
    const bio = document.createElement("div");
    bio.className = "profile-bio";
    bio.textContent = profile.bio;
    details.appendChild(bio);
  }
  if (profile.external_url) {
    const ext = document.createElement("a");
    ext.className = "profile-link";
    ext.href = profile.external_url;
    ext.target = "_blank";
    ext.rel = "noopener noreferrer";
    ext.textContent = profile.external_url;
    details.appendChild(ext);
  }
  metaEl.appendChild(details);

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

  /* Instagram serves profile pics with `Cross-Origin-Resource-Policy:
     same-origin`, so browsers block direct cross-origin <img> loads (that's
     the ERR_BLOCKED_BY_RESPONSE.NotSameOrigin error, and why the preview was
     blank, the size showed "?x?", and the button fell back to opening a new
     tab). Fix: pull the bytes through the PIC_PROXIES chain (server-side
     CORS proxies), then show them as a same-origin blob URL so preview,
     resolution and a direct download all work. If every proxy fails too,
     fall back to opening the picture in a new tab — top-level navigation
     isn't blocked by CORP. */
  let blob = null;
  let blobUrl = null;
  blob = await fetchProfilePicBytes(pic);
  if (blob) blobUrl = URL.createObjectURL(blob);

  frame.innerHTML = "";
  const im = document.createElement("img");
  im.src = blobUrl || pic;
  im.alt = "@" + username + " profile picture";
  frame.appendChild(im);
  const badge = document.createElement("span");
  badge.className = "media-badge";
  badge.textContent = "…";
  frame.appendChild(badge);

  let nw = "?", nh = "?";
  let dims = null;
  if (blobUrl) {
    dims = await new Promise((res) => {
      const probe = new Image();
      probe.onload = () => res({ w: probe.naturalWidth, h: probe.naturalHeight });
      probe.onerror = () => res(null);
      probe.src = blobUrl;
    });
    if (dims) { nw = dims.w; nh = dims.h; }
  }
  badge.textContent = nw + "×" + nh + (dims ? " · original" : "");

  btn.disabled = false;
  if (blob) {
    btn.textContent = "Download profile pic (" + nw + "×" + nh + ")";
    btn.onclick = () => triggerSave(blob, username + "_profile_pic_" + nw + "x" + nh + ".jpg");
  } else {
    const note = document.createElement("div");
    note.className = "frame-hint";
    note.textContent = "Preview blocked by Instagram. Use the button below to open the picture.";
    frame.appendChild(note);
    btn.textContent = "Open profile pic";
    btn.onclick = () => window.open(pic, "_blank");
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

  const busyText = parsed.kind === "post" ? "Resolving the post…"
    : parsed.kind === "highlight" ? "Looking up the highlight…"
    : parsed.kind === "story" ? "Looking up the story…"
    : "Looking up @" + parsed.username + "…";
  setBusy(true, busyText);
  try {
    resultCtn.classList.remove("hidden");
    if (parsed.kind === "post") {
      const data = await fetchMedia(input);
      await renderItems(data, {
        openUrl: "https://www.instagram.com/reel/" + data.code + "/",
        label: data.items.length > 1 ? data.items.length + " media items" : "1 media item",
        filePrefix: "instagram_" + data.code,
        historyKind: "post",
        historyLabel: data.code,
      }, input);
    } else if (parsed.kind === "story" || parsed.kind === "highlight") {
      const data = await fetchStoryHighlight(parsed.url);
      const id = parsed.kind === "highlight" ? ((parsed.url.match(/highlights\/(\d+)/) || [])[1] || "highlight") : "story";
      const label = (data.meta && data.meta.title)
        ? "Highlight · " + data.meta.title
        : (parsed.kind === "highlight" ? "Highlight" : "Story") + " · " + (data.items.length > 1 ? data.items.length + " media items" : "1 media item");
      await renderItems(data, {
        openUrl: parsed.url,
        label,
        filePrefix: parsed.kind === "highlight" ? "highlight_" + id : "story",
        authorUrl: null,
        historyKind: parsed.kind,
        historyLabel: parsed.kind === "highlight" ? "highlight " + id : "story",
      }, input);
    } else {
      await renderDp(parsed.username, input);
    }
    scrollToResults();
  } catch (e) {
    showError(e && e.message ? e.message : String(e));
  } finally {
    setBusy(false);
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
