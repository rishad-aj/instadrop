/* ============================================================
   ReelSaver - script.js
   Unminified, standalone application logic.
   ============================================================ */

/* Network helper: uses Perchance's superFetch proxy when available
   (runs inside the perchance editor/preview), otherwise falls back to
   the browser's native fetch (standalone / GitHub Pages / Vercel). */
const fetchLike = (typeof window.root !== 'undefined' && window.root && window.root.superFetch)
  ? window.root.superFetch.bind(window.root)
  : window.fetch.bind(window);

const API = "https://api.downloadgram.org/media";
const API_STORY = "https://api.downloadgram.org/story";
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

/* paste button: read clipboard into the box, then auto-run if it's a valid link */
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
      errorEl.classList.add("hidden");
      if (parseInput(urlInput.value).kind !== "unknown") downloadBtn.click();
    } catch (e) {
      showError("Couldn't read the clipboard — press Ctrl+V inside the box instead.");
      urlInput.focus();
    }
  });
}
/* FAQ accordion */
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
  const prof = s.match(/instagram\.com\/([A-Za-z0-9._]{1,30})\/?(\?.*)?$/);
  if (prof && !/^(reel|p|reels|tv|stories|highlights)$/.test(prof[1])) return { kind: "dp", username: prof[1] };
  if (/^[A-Za-z0-9._]{1,30}$/.test(s)) return { kind: "dp", username: s };
  return { kind: "unknown" };
}

function decodeDgResponse(body) {
  let html = null;
  const loader = { style: {} };
  const fakeDoc = {
    getElementById(id) {
      if (id === "div_download") return { set innerHTML(v) { html = v; } };
      return { remove() {} };
    },
  };
  new Function("loader", "document", "showAd", body)(loader, fakeDoc, () => {});
  return html;
}

async function fetchMedia(url) {
  const code = extractShortcode(url);
  if (!code) throw new Error("That doesn't look like an Instagram reel/post link.");
  const cleanUrl = "https://www.instagram.com/reel/" + code + "/";
  const res = await withTimeout(
    fetchLike(API, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: cleanUrl }),
    }),
    90000,
    "The downloader service is slow right now — try again in a moment."
  );
  const body = await res.text();
  if (!res.ok) {
    let msg = "The downloader service failed (HTTP " + res.status + "). Try again in a moment.";
    try { const j = JSON.parse(body); if (j.error || j.message) msg = String(j.error || j.message); } catch (e) {}
    throw new Error(msg);
  }
  const html = decodeDgResponse(body);
  if (!html) throw new Error("No downloadable media was returned — the post may be private or deleted.");
  const items = extractItems(html);
  if (!items.length) throw new Error("No downloadable media was found in that post.");
  return { code, items };
}

function extractItems(html) {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const items = [];
  for (const block of doc.querySelectorAll(".download-items")) {
    const img = block.querySelector("img");
    const link = block.querySelector("a.abutton");
    const thumb = img && img.getAttribute("src");
    const mediaUrl = link && link.getAttribute("href");
    if (!mediaUrl) continue;
    const isVideo = !!block.querySelector(".icon-ivideo");
    items.push({ kind: isVideo ? "video" : "image", thumb, url: mediaUrl });
  }
  return items;
}

async function fetchStoryMedia(url) {
  const res = await withTimeout(
    fetchLike(API_STORY, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    }),
    90000,
    "The downloader service is slow right now — try again in a moment."
  );
  const body = await res.text();
  if (!res.ok) {
    let msg = "Instagram won't serve this " + (url.includes("/highlights/") ? "highlight" : "story") + " anonymously (HTTP " + res.status + ").";
    try { const j = JSON.parse(body); if (j.message) msg = String(j.message); } catch (e) {}
    throw new Error(msg);
  }
  const html = decodeDgResponse(body);
  if (!html) throw new Error("No downloadable media was returned.");
  const items = extractItems(html);
  if (!items.length) throw new Error("No downloadable media was found.");
  return { items };
}

async function getAuthorName(url) {
  try {
    const res = await withTimeout(
      fetchLike("https://www.instagram.com/api/v1/oembed/?url=" + encodeURIComponent(url)),
      45000
    );
    if (!res.ok) return null;
    const j = await res.json();
    return j.author_name || null;
  } catch (e) { return null; }
}

async function fetchBlob(url, tries = 2) {
  let lastErr;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await withTimeout(fetchLike(url), 40000, "The media host is busy right now — trying again, then try a fresh 'Download' if it keeps failing.");
      if (!res.ok) throw new Error("Download failed (HTTP " + res.status + ").");
      return await res.blob();
    } catch (e) {
      lastErr = e;
      if (i < tries - 1) await sleep(2500);
    }
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
    c.addEventListener("click", () => { urlInput.value = entry.input; downloadBtn.click(); });
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

/* ---------------- DP ---------------- */

async function fetchProfilePage(username) {
  for (let i = 0; i < 4; i++) {
    const res = await withTimeout(
      fetchLike("https://www.instagram.com/" + encodeURIComponent(username) + "/"),
      60000,
      "Fetching that profile took too long — try again."
    );
    if (res.status === 200) return await res.text();
    if (res.status === 429) { await sleep(3000); continue; }
    throw new Error("Instagram returned HTTP " + res.status + " for that profile.");
  }
  throw new Error("Instagram is rate-limiting requests right now — wait a minute and try again.");
}

function extractAvatar(html) {
  const m = html.match(/"profile_pic_url":"([^"]+)"/);
  if (m) return m[1].replace(/\\\//g, "/");
  const img = html.match(/<img[^>]+alt="[^"]*profile picture[^"]*"[^>]+src="([^"]+)"/);
  if (img) return img[1];
  return null;
}

async function resolveAvatar(username) {
  const candidates = [];
  const push = (u, src) => {
    if (!u) return;
    const clean = u.replace(/\\\//g, "/").replace(/&amp;/g, "&");
    if (/static\.cdninstagram\.com|\/rsrc\.php/.test(clean)) return;
    candidates.push({ url: clean, src });
  };

  try {
    const res = await withTimeout(
      fetchLike("https://www.instagram.com/api/v1/oembed/?url=" + encodeURIComponent("https://www.instagram.com/" + encodeURIComponent(username) + "/")),
      15000
    );
    if (res.ok) {
      const j = await res.json();
      push(j.thumbnail_url, "oembed");
    }
  } catch (e) {}

  try {
    const res = await withTimeout(
      fetchLike("https://i.instagram.com/api/v1/users/web_profile_info/?username=" + encodeURIComponent(username)),
      10000
    );
    if (res.ok) {
      const j = await res.json();
      const user = j.data && j.data.user;
      push(user && (user.profile_pic_url_hd || user.profile_pic_url), "api");
    }
  } catch (e) {}

  try {
    const html = await fetchProfilePage(username);
    push(extractAvatar(html), "page");
  } catch (e) {}

  const avatar = candidates[0];
  if (!avatar) throw new Error("Couldn't find a profile picture for @" + username + " (private or invalid profile?).");
  return avatar;
}

function loadImageBlob(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't load the image.")); };
    img.src = url;
  });
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

  if (opts.authorUrl) {
    getAuthorName(opts.authorUrl).then((authorName) => {
      if (!authorName) return;
      const dp = document.createElement("button");
      dp.className = "open";
      dp.textContent = "@" + authorName + " · profile pic";
      dp.addEventListener("click", () => { urlInput.value = authorName; downloadBtn.click(); });
      metaEl.querySelector(".row").insertBefore(dp, open);
    });
  }

  data.items.forEach((item, i) => {
    const box = document.createElement("div");
    box.className = "item";
    const ext = item.kind === "video" ? "mp4" : "jpg";
    const filename = opts.filePrefix + (data.items.length > 1 ? "_" + (i + 1) : "") + "." + ext;
    const label = item.kind === "video" ? "MP4" : "image";

    const frame = document.createElement("div");
    frame.className = "media-frame";
    const hint = document.createElement("div");
    hint.className = "frame-hint";
    hint.innerHTML = '<div class="spinner"></div><span>Loading preview…</span>';
    frame.appendChild(hint);
    box.appendChild(frame);

    const row = document.createElement("div");
    row.className = "dl-row";

    const dlLink = document.createElement("a");
    dlLink.className = "dl-btn";
    dlLink.href = item.url;
    dlLink.target = "_blank";
    dlLink.rel = "noopener noreferrer";
    dlLink.textContent = "Download " + label;
    dlLink.title = "Downloads straight to your device (no app needed).";
    row.appendChild(dlLink);

    const saveBtn = document.createElement("button");
    saveBtn.className = "dl-btn alt";
    saveBtn.disabled = true;
    saveBtn.textContent = "Save copy…";
    saveBtn.title = "Saves with a clean filename through the app.";
    row.appendChild(saveBtn);

    const audioBtn = item.kind === "video" ? document.createElement("button") : null;
    if (audioBtn) {
      audioBtn.className = "dl-btn alt";
      audioBtn.disabled = true;
      audioBtn.textContent = "Audio (MP3)";
      audioBtn.title = "Extracts the reel's audio as an MP3, converted in your browser.";
      row.appendChild(audioBtn);
    }
    box.appendChild(row);

    card.appendChild(box);

    fetchBlob(item.url).then(async (blob) => {
      const objectUrl = URL.createObjectURL(blob);
      const mb = (blob.size / 1048576).toFixed(1);
      const bytes = item.kind === "video" ? new Uint8Array(await blob.arrayBuffer()) : null;
      frame.innerHTML = "";
      if (item.kind === "video") {
        const v = document.createElement("video");
        v.controls = true;
        v.playsInline = true;
        v.src = objectUrl;
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
        im.src = objectUrl;
        im.alt = "Instagram image";
        frame.appendChild(im);
      }
      saveBtn.disabled = false;
      saveBtn.textContent = "Save copy (" + mb + " MB)";
      saveBtn.onclick = () => triggerSave(blob, filename);
      if (audioBtn) {
        audioBtn.disabled = false;
        audioBtn.onclick = async () => {
          audioBtn.disabled = true;
          audioBtn.textContent = "Preparing audio…";
          if (!ffmpegReady) {
            spinnerCtn.classList.remove("hidden");
            spinnerText.textContent = "Downloading audio converter (one-time, ~30 MB)…";
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
      frame.innerHTML = "";
      const note = document.createElement("div");
      note.className = "frame-hint";
      note.textContent = "Preview is busy right now — the Download button still works.";
      frame.appendChild(note);
      saveBtn.textContent = "Save copy (busy)";
      saveBtn.title = "The media host is throttling right now — use the Download button, or retry in a moment.";
      if (audioBtn) {
        audioBtn.textContent = "Audio (needs preview)";
        audioBtn.title = "Audio conversion needs the preview download to succeed. Try again shortly.";
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
    authorUrl: "https://www.instagram.com/reel/" + data.code + "/",
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
  frame.className = "media-frame avatar";
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
  const blob = await fetchBlob(avatar.url);
  const img = await loadImageBlob(blob);
  const nw = img.naturalWidth;
  const nh = img.naturalHeight;
  const objectUrl = URL.createObjectURL(blob);
  frame.innerHTML = "";
  const im = document.createElement("img");
  im.src = objectUrl;
  im.alt = "@" + username + " profile picture";
  frame.appendChild(im);
  const badge = document.createElement("span");
  badge.className = "media-badge";
  badge.textContent = nw + "×" + nh + " · original";
  frame.appendChild(badge);
  btn.disabled = false;
  btn.textContent = "Download profile pic (" + nw + "×" + nh + ")";
  btn.onclick = () => triggerSave(blob, username + "_profile_pic_" + nw + "x" + nh + ".jpg");
  addHistory({ kind: "dp", label: "@" + username, input });
}

function renderStory() {
  const msg = document.createElement("div");
  msg.className = "error";
  msg.style.margin = "0";
  msg.textContent = "That story isn't available anonymously right now — Instagram only shows active stories to logged-in accounts, and they expire after 24 hours. Highlights usually work here; reels, posts and profile pics work too.";
  const card = wrapResult(msg);
  resultCtn.appendChild(card);
}

/* ---------------- main action ---------------- */

downloadBtn.addEventListener("click", async () => {
  const input = urlInput.value.trim();
  errorEl.classList.add("hidden");
  resultCtn.classList.add("hidden");
  resultCtn.innerHTML = "";

  const parsed = parseInput(input);
  if (parsed.kind === "unknown") {
    showError("Paste a full Instagram link (reel/post/tv, story or highlight), a profile link, or a bare username.");
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
      renderStory();
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
    showError(e.message);
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
