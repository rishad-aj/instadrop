/* ============================================================
   Instadrop - script.js
   Standalone application logic.
   ============================================================ */

/* Network helper: uses Perchance's superFetch proxy when available,
   otherwise falls back to the browser's native fetch. */
const fetchLike = (typeof window.root !== 'undefined' && window.root && window.root.superFetch)
  ? window.root.superFetch.bind(window.root)
  : window.fetch.bind(window);

/* Optional Cloudflare Worker proxy configuration */
function proxyResolve(path, body) {
  if (PROXY) {
    return fetch(PROXY + path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }).then(async (res) => {
      if (!res.ok) {
        let msg = "Proxy error (HTTP " + res.status + ").";
        try { const j = await res.json(); if (j.error) msg = j.error; } catch (e) {}
        throw new Error(msg);
      }
      return res.json();
    }).catch((err) => {
      if (typeof window !== "undefined" && window.root && window.root.superFetch) {
        return resolveLocally(path, body);
      }
      throw err;
    });
  }
  if (typeof window !== "undefined" && window.root && window.root.superFetch) {
    return resolveLocally(path, body);
  }
  return null;
}
function proxyFileUrl(url) { return PROXY ? PROXY + "/file?url=" + encodeURIComponent(url) : url; }

/* ---------- local resolution (perchance preview) ---------- */

function deepFindKey(o, key) {
  if (!o || typeof o !== "object") return null;
  if (key in o) return o[key];
  for (const v of Object.values(o)) {
    const r = deepFindKey(v, key);
    if (r !== null && r !== undefined) return r;
  }
  return null;
}
function jsonScriptBlocks(html) {
  return (html.match(/<script type="application\/json"[^>]*>([\s\S]*?)<\/script>/g) || []).map((raw) => {
    const m = raw.match(/^<script type="application\/json"[^>]*>([\s\S]*?)<\/script>$/);
    return m ? m[1] : "";
  });
}
function largestCandidate(list) {
  return list ? list.reduce((a, b) => (a.height * a.width >= b.height * b.width ? a : b)) : null;
}
function normalizeItems(it) {
  const out = [];
  if (!it || typeof it !== "object") return out;
  const img = it.image_versions2 ? largestCandidate(it.image_versions2.candidates) : null;
  const thumb = img ? img.url : it.display_url || null;
  const vid = it.video_versions ? largestCandidate(it.video_versions) : null;
  const videoUrl = vid ? vid.url : it.video_url || null;
  if (videoUrl) out.push({ kind: "video", thumb, url: videoUrl });
  else if (thumb) out.push({ kind: "image", thumb, url: thumb });
  if (Array.isArray(it.carousel_media)) for (const c of it.carousel_media) out.push(...normalizeItems(c));
  return out;
}
function itemsFromConnection(conn) {
  const items = [];
  for (const e of conn.edges || []) for (const it of (e.node && e.node.items) || []) items.push(...normalizeItems(it));
  return items;
}
function resolvePageFromHtml(html, keys) {
  for (const b of jsonScriptBlocks(html)) {
    let j;
    try { j = JSON.parse(b); } catch (e) { continue; }
    for (const key of keys) {
      const found = deepFindKey(j, key);
      if (!found) continue;
      if (key === "xdt_api__v1__feed__reels_media__connection") return itemsFromConnection(found);
      if (key === "xdt_api__v1__media__shortcode__web_info") {
        const items = [];
        for (const it of found.items || []) items.push(...normalizeItems(it));
        return items;
      }
      if (key === "xdt_shortcode_media") return normalizeItems(found);
    }
  }
  return [];
}
async function resolveLocally(path, body) {
  if (path === "/profile") {
    const html = await fetchLike("https://www.instagram.com/" + encodeURIComponent(body.username) + "/").then((r) => r.text());
    let user = null;
    for (const b of jsonScriptBlocks(html)) {
      let j;
      try { j = JSON.parse(b); } catch (e) { continue; }
      user = deepFindKey(j, "xig_user_by_username");
      if (user) break;
    }
    if (!user || !user.profile_pic_url) throw new Error("Couldn't find that profile.");
    return { username: user.username, fullName: user.full_name, profilePicUrl: user.profile_pic_url };
  }
  const keys = path === "/story"
    ? ["xdt_api__v1__feed__reels_media__connection"]
    : ["xdt_api__v1__media__shortcode__web_info", "xdt_shortcode_media", "xdt_api__v1__feed__reels_media__connection"];
  const html = await fetchLike(body.url).then((r) => r.text());
  const items = resolvePageFromHtml(html, keys);
  if (!items.length) throw new Error("No downloadable media was returned — the post/highlight may be private or deleted.");
  return { items };
}

const API = "https://api.downloadgram.org/media";
const PROXY = "";
const FFMPEG_CORE = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.js";
const FFMPEG_WASM = "https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.6/dist/umd/ffmpeg-core.wasm";

/* ---------- free keyless fetch helpers ---------- */

const CORS_PROXIES = [
  (u) => "https://corsproxy.io/?url=" + encodeURIComponent(u),
  (u) => "https://api.allorigins.win/raw?url=" + encodeURIComponent(u),
  (u) => "https://api.codetabs.com/v1/proxy?quest=" + encodeURIComponent(u),
];

const HAS_SUPERFETCH = typeof window !== "undefined" && !!window.root && !!window.root.superFetch;

async function serverFetch(url, opts) {
  try {
    return await fetchLike(url, opts);
  } catch (e) {
    if (HAS_SUPERFETCH) throw e;
  }
  let lastErr = "Network error";
  for (const build of CORS_PROXIES) {
    try {
      const res = await withTimeout(fetchLike(build(url)), 8000, "proxy timed out");
      if (res && res.ok) return res;
      lastErr = "HTTP " + (res && res.status);
    } catch (e) {
      lastErr = String(e && e.message || e);
    }
  }
  throw new Error(lastErr);
}

async function getText(url) {
  const res = await serverFetch(url);
  return await res.text();
}
async function postText(url, body) {
  const res = await withTimeout(fetchLike(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }), 25000, "service timed out");
  if (!res || !res.ok) throw new Error("HTTP " + (res && res.status || "error"));
  return await res.text();
}

function cleanUrl(u) { return String(u || "").replace(/\\\//g, "/").replace(/&amp;/g, "&"); }

/* Normalize JSON responses from APIs */
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
    items.push({ kind: kind || (/\.mp4(\?|&|$)/i.test(u) ? "video" : "image"), thumb: thumb ? cleanUrl(thumb) : null, url: u });
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
      const c = o.image_versions2.candidates.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
      if (c) push(c.url, c.url, "image");
    }
    if (Array.isArray(o.video_versions)) {
      const v = o.video_versions.slice().sort((a, b) => (b.width * b.height) - (a.width * a.height))[0];
      if (v) push(v.url, v.url, "video");
    }
    if (Array.isArray(o.media)) { for (const m of o.media) scan(m); return; }
    if (Array.isArray(o.stories)) { for (const m of o.stories) scan(m); return; }
    if (Array.isArray(o.items)) { for (const m of o.items) scan(m); return; }
    if (Array.isArray(o.medias)) { for (const m of o.medias) scan(m); return; }
    if (Array.isArray(o.data)) { for (const m of o.data) scan(m); return; }
    if (Array.isArray(o.result)) { for (const m of o.result) scan(m); return; }
    for (const v of Object.values(o)) if (v && typeof v === "object") scan(v);
  };
  scan(j);
  return items;
}

/* Try APIs in order until one returns data */
async function firstWorking(candidates) {
  for (const c of candidates) {
    try {
      const t = await withTimeout(c.fetch(), 25000, c.name + " timed out");
      const items = c.parse(t);
      if (items && items.length) return items;
    } catch (e) {
      // try next candidate
    }
  }
  return [];
}

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

function decodeDgResponse(body) {
  let html = null;
  try {
    const loader = { style: {} };
    const fakeDoc = {
      getElementById(id) {
        if (id === "div_download") return { set innerHTML(v) { html = v; } };
        return { remove() {} };
      },
    };
    new Function("loader", "document", "showAd", body)(loader, fakeDoc, () => {});
  } catch (e) {}
  return html;
}

function extractItems(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items = [];
  for (const block of doc.querySelectorAll(".download-items")) {
    const img = block.querySelector("img");
    const link = block.querySelector("a");
    const thumb = img && img.getAttribute("src");
    const mediaUrl = link && link.getAttribute("href");
    if (!mediaUrl) continue;
    const isVideo = !!block.querySelector(".icon-ivideo");
    items.push({ kind: isVideo ? "video" : "image", thumb, url: mediaUrl });
  }
  return items;
}

async function fetchMedia(url) {
  const code = extractShortcode(url);
  if (!code) throw new Error("That doesn't look like an Instagram reel/post link.");
  const cleanUrl = "https://www.instagram.com/reel/" + code + "/";

  if (PROXY || (window.root && window.root.superFetch)) {
    try {
      const data = await withTimeout(proxyResolve("/media", { url: cleanUrl }), 60000, "The download service timed out.");
      if (data && data.items && data.items.length) return { code, items: data.items };
    } catch (e) {}
  }

  const items = await firstWorking([
    {
      name: "thakur-infopd",
      fetch: () => getText("https://insta.thakur-infopd.workers.dev/?url=" + encodeURIComponent(cleanUrl)),
      parse: jsonToItems,
    },
    {
      name: "mn-bots",
      fetch: () => getText("https://instagram-downloader.mn-bots.workers.dev/?url=" + encodeURIComponent(cleanUrl)),
      parse: (t) => {
        let j;
        try { j = JSON.parse(t); } catch (e) { return []; }
        if (!j.success || !j.media) return [];
        return j.media.map(m => ({
          kind: (m.type === "video" || /\.mp4/i.test(m.url)) ? "video" : "image",
          thumb: m.thumb || null,
          url: m.url || m.server2 || null,
        })).filter(m => m.url);
      },
    },
    {
      name: "anon-social",
      fetch: () => getText("https://anon-social-info.vercel.app/igdl?key=igdl305&url=" + encodeURIComponent(cleanUrl)),
      parse: jsonToItems,
    },
    {
      name: "downloadgram",
      fetch: () => postText(API, { url: cleanUrl }),
      parse: (t) => { const html = decodeDgResponse(t); return html ? extractItems(html) : []; },
    },
    {
      name: "ddvideo",
      fetch: () => getText("https://api.dd.video/api/instagram?url=" + encodeURIComponent(cleanUrl)),
      parse: jsonToItems,
    },
    {
      name: "snapinsta",
      fetch: () => getText("https://snapinsta.app/api/instagram?url=" + encodeURIComponent(cleanUrl)),
      parse: jsonToItems,
    },
    {
      name: "indown",
      fetch: () => getText("https://indown.io/api/info?url=" + encodeURIComponent(cleanUrl)),
      parse: jsonToItems,
    },
  ]);
  if (!items.length) {
    throw new Error("No downloadable media was found in that post — the free services are busy right now. Try again in a moment.");
  }
  return { code, items };
}

async function fetchStoryMedia(url) {
  const isHl = /\/highlights\//.test(url);

  if (PROXY || (window.root && window.root.superFetch)) {
    try {
      const data = await withTimeout(proxyResolve("/story", { url }), 60000, "The download service timed out.");
      if (data && data.items && data.items.length) return { items: data.items };
    } catch (e) {}
  }

  const items = await firstWorking([
    {
      name: "thakur-infopd",
      fetch: () => getText("https://insta.thakur-infopd.workers.dev/?url=" + encodeURIComponent(url)),
      parse: jsonToItems,
    },
    {
      name: "mn-bots",
      fetch: () => getText("https://instagram-downloader.mn-bots.workers.dev/?url=" + encodeURIComponent(url)),
      parse: (t) => {
        let j;
        try { j = JSON.parse(t); } catch (e) { return []; }
        if (!j.success || !j.media) return [];
        return j.media.map(m => ({
          kind: (m.type === "video" || /\.mp4/i.test(m.url)) ? "video" : "image",
          thumb: m.thumb || null,
          url: m.url || m.server2 || null,
        })).filter(m => m.url);
      },
    },
    {
      name: "anon-social",
      fetch: () => getText("https://anon-social-info.vercel.app/igdl?key=igdl305&url=" + encodeURIComponent(url)),
      parse: jsonToItems,
    },
    {
      name: "snapinsta",
      fetch: () => getText("https://snapinsta.app/api/instagram?url=" + encodeURIComponent(url)),
      parse: jsonToItems,
    },
    {
      name: "ddvideo",
      fetch: () => getText("https://api.dd.video/api/instagram?url=" + encodeURIComponent(url)),
      parse: jsonToItems,
    },
    {
      name: "indown",
      fetch: () => getText("https://indown.io/api/info?url=" + encodeURIComponent(url)),
      parse: jsonToItems,
    },
  ]);

  if (!items.length) {
    throw new Error(
      isHl
        ? "Couldn't resolve that highlight — the free services are busy right now, or the highlight is private. Try again in a moment."
        : "Couldn't resolve that story right now — active stories expire after 24 hours and may be private. Try again in a moment."
    );
  }
  return { items };
}

async function fetchBlob(url, tries = 2) {
  const viaProxy = PROXY ? proxyFileUrl(url) : url;
  const urls = PROXY && viaProxy !== url ? [viaProxy, url] : [url];
  let lastErr;
  for (let i = 0; i < tries; i++) {
    for (const target of urls) {
      try {
        const res = await withTimeout(fetchLike(target), 60000, "The media host is busy right now.");
        if (!res.ok) throw new Error("Download failed (HTTP " + res.status + ").");
        return await res.blob();
      } catch (e) {
        lastErr = e;
      }
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

/* ---------------- DP (profile picture) ---------------- */

async function resolveAvatar(username) {
  // 1) New GreatOnlineTools API via POST (Very reliable for DPs)
  try {
    const response = await fetchLike("https://greatonlinetools.com/endpoints-tools/endpoint.php", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: username })
    });
    const data = await response.json();
    if (data && data.status) {
      // Use downloadUrl first if it exists (usually higher quality), otherwise profilePictureUrl
      const picUrl = data.downloadUrl || data.profilePictureUrl;
      if (picUrl) {
        return { url: cleanUrl(picUrl), src: "greatonlinetools" };
      }
    }
  } catch (e) {
    console.warn("greatonlinetools DP lookup failed:", e);
  }

  // 2) Original Worker via AllOrigins wrapper (Fallback)
  try {
    const targetUrl = "https://bj-insta-profile-info.mmabbas011687.workers.dev/info?username=" + encodeURIComponent(username);
    const response = await fetchLike("https://api.allorigins.win/get?url=" + encodeURIComponent(targetUrl));
    const wrappedData = await response.json();
    
    if (wrappedData && wrappedData.contents) {
      const data = JSON.parse(wrappedData.contents);
      if (data && data.pic) {
        return { url: cleanUrl(data.pic), src: "profile-info" };
      }
    }
  } catch (e) {
    console.warn("DP proxy lookup failed:", e);
  }

  // 3) Optional Cloudflare Worker Proxy Fallback (Final Fallback)
  if (PROXY || (window.root && window.root.superFetch)) {
    try {
      const data = await withTimeout(proxyResolve("/profile", { username }), 30000, "Profile lookup timed out.");
      if (data && data.profilePicUrl) return { url: data.profilePicUrl, src: "instagram" };
    } catch (e) {}
  }

  throw new Error("Couldn't find a profile picture for @" + username + " (the APIs may be blocked or the profile is private).");
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
  who.textContent = opts.label || (data.items.length > 1 ? data.items.length + " media items" : "1 media item");
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
  if (parsed.kind === "story" || parsed.kind === "highlight") {
    resultCtn.classList.remove("hidden");
    setBusy(true, parsed.kind === "highlight" ? "Looking up the highlight…" : "Looking up the story…");
    try {
      const data = await fetchStoryMedia(parsed.url);
      const id = parsed.kind === "highlight" ? ((parsed.url.match(/highlights\/(\d+)/) || [])[1] || "highlight") : "story";
      await renderItems(data, {
        openUrl: parsed.url,
        label: (parsed.kind === "highlight" ? "Highlight" : "Story") + " · " + (data.items.length > 1 ? data.items.length + " media items" : "1 media item"),
        filePrefix: parsed.kind === "highlight" ? "highlight_" + id : "story",
        authorUrl: null,
        historyKind: parsed.kind,
        historyLabel: parsed.kind === "highlight" ? "highlight " + id : "story",
      }, input);
      scrollToResults();
    } catch (e) {
      showError(e && e.message ? e.message : String(e));
    } finally {
      setBusy(false);
    }
    return;
  }

  setBusy(true, parsed.kind === "post" ? "Resolving the post…" : "Looking up @" + parsed.username + "…");
  try {
    resultCtn.classList.remove("hidden");
    if (parsed.kind === "post") await renderPost(await fetchMedia(input), input);
    else await renderDp(parsed.username, input);
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
