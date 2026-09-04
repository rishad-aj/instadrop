/* =========================================================
   INSTADROP - CLEAN SCRIPT
   Only Instagram API:
   https://instadrop.rishu-rishad2019.workers.dev/?url=

   No:
   - DownloadGram API
   - Thakur API
   - MN Bots API
   - Anon Social API
   - DD Video API
   - SnapInsta API
   - InDown API
   - CORS proxies
   - Instagram HTML scraping
   - External profile APIs
   - External FFmpeg CDN
   ========================================================= */

(() => {
  "use strict";

  /* =========================================================
     CONFIG
     ========================================================= */

  const INSTADROP_API =
    "https://instadrop.rishu-rishad2019.workers.dev/?url=";

  const HISTORY_KEY = "instadrop_history";
  const THEME_KEY = "instadrop_theme";
  const MAX_HISTORY = 8;

  /* =========================================================
     HELPERS
     ========================================================= */

  const $ = (selector, root = document) =>
    root.querySelector(selector);

  const $$ = (selector, root = document) =>
    Array.from(root.querySelectorAll(selector));

  const sleep = (ms) =>
    new Promise(resolve => setTimeout(resolve, ms));

  /*
   * Uses your API only.
   *
   * If Perchance provides superFetch, it can still be used
   * as the browser's fetch implementation. It does NOT add
   * another Instagram API.
   */
  async function fetchLike(url, options = {}) {
    if (
      window.root &&
      typeof window.root.superFetch === "function"
    ) {
      try {
        return await window.root.superFetch(url, options);
      } catch (_) {
        // Fall back to normal browser fetch.
      }
    }

    return fetch(url, options);
  }

  function safeJsonParse(value) {
    if (typeof value !== "string") {
      return value;
    }

    try {
      return JSON.parse(value);
    } catch (_) {
      return null;
    }
  }

  function absoluteUrl(url) {
    if (!url || typeof url !== "string") {
      return null;
    }

    let value = url.trim();

    if (!value) {
      return null;
    }

    value = value
      .replace(/\\u0026/g, "&")
      .replace(/\\u003D/g, "=")
      .replace(/\\\//g, "/")
      .replace(/&amp;/g, "&")
      .replace(/&quot;/g, '"');

    if (
      value.startsWith("http://") ||
      value.startsWith("https://") ||
      value.startsWith("//")
    ) {
      if (value.startsWith("//")) {
        return "https:" + value;
      }

      return value;
    }

    return null;
  }

  function isMediaUrl(url) {
    if (!url || typeof url !== "string") {
      return false;
    }

    const value = url.toLowerCase();

    return (
      value.startsWith("http://") ||
      value.startsWith("https://")
    );
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  /* =========================================================
     INPUT / INSTAGRAM URL
     ========================================================= */

  function normalizeInstagramUrl(value) {
    if (!value) {
      return "";
    }

    let url = String(value).trim();

    if (!url) {
      return "";
    }

    /*
     * Bare username is handled as a profile URL.
     */
    if (
      !url.startsWith("http://") &&
      !url.startsWith("https://")
    ) {
      if (
        !url.includes("/") &&
        !url.includes(" ") &&
        !url.includes("?")
      ) {
        return `https://www.instagram.com/${encodeURIComponent(url)}/`;
      }
    }

    /*
     * Convert http Instagram URLs to https.
     */
    if (url.startsWith("http://instagram.com")) {
      url = "https://" + url.slice("http://".length);
    }

    if (url.startsWith("http://www.instagram.com")) {
      url = "https://" + url.slice("http://".length);
    }

    return url;
  }

  function isInstagramUrl(url) {
    try {
      const parsed = new URL(url);

      return (
        parsed.hostname === "instagram.com" ||
        parsed.hostname === "www.instagram.com" ||
        parsed.hostname.endsWith(".instagram.com")
      );
    } catch (_) {
      return false;
    }
  }

  function extractShortcode(url) {
    if (!url) {
      return null;
    }

    try {
      const parsed = new URL(url);

      const parts = parsed.pathname
        .split("/")
        .filter(Boolean);

      const supported = [
        "reel",
        "reels",
        "p",
        "tv"
      ];

      for (let i = 0; i < parts.length - 1; i++) {
        if (supported.includes(parts[i].toLowerCase())) {
          return parts[i + 1];
        }
      }

      return null;
    } catch (_) {
      return null;
    }
  }

  function parseInput(value) {
    const original = String(value || "").trim();

    if (!original) {
      return {
        type: "invalid",
        url: ""
      };
    }

    const normalized = normalizeInstagramUrl(original);

    if (!normalized) {
      return {
        type: "invalid",
        url: ""
      };
    }

    /*
     * Bare username
     */
    if (
      !original.includes("://") &&
      !original.includes("/") &&
      !original.includes(" ")
    ) {
      return {
        type: "profile",
        url: normalized,
        username: original.replace(/^@/, "")
      };
    }

    if (!isInstagramUrl(normalized)) {
      return {
        type: "invalid",
        url: normalized
      };
    }

    let pathname = "";

    try {
      pathname = new URL(normalized).pathname.toLowerCase();
    } catch (_) {
      pathname = "";
    }

    /*
     * Instagram stories
     */
    if (pathname.includes("/stories/highlights/")) {
      return {
        type: "highlight",
        url: normalized
      };
    }

    if (pathname.includes("/stories/")) {
      return {
        type: "story",
        url: normalized
      };
    }

    /*
     * Profile
     */
    const shortcode = extractShortcode(normalized);

    if (shortcode) {
      return {
        type: "media",
        url: normalized,
        shortcode
      };
    }

    /*
     * Anything else on Instagram is sent directly
     * to your API. This allows your Worker to decide
     * how to handle the URL.
     */
    return {
      type: "profile",
      url: normalized
    };
  }

  /* =========================================================
     YOUR API
     ========================================================= */

  async function callInstagramApi(instagramUrl) {
    if (!instagramUrl) {
      throw new Error("Instagram URL is required.");
    }

    const endpoint =
      INSTADROP_API + encodeURIComponent(instagramUrl);

    let response;

    try {
      response = await fetchLike(endpoint, {
        method: "GET",
        headers: {
          "Accept": "application/json, text/plain, */*"
        }
      });
    } catch (error) {
      throw new Error(
        "Could not connect to the Instadrop API."
      );
    }

    if (!response.ok) {
      throw new Error(
        `API request failed (${response.status}).`
      );
    }

    const text = await response.text();

    if (!text || !text.trim()) {
      throw new Error(
        "Your API returned an empty response."
      );
    }

    /*
     * Most APIs return JSON.
     */
    const json = safeJsonParse(text);

    if (json !== null) {
      return json;
    }

    /*
     * Also support an API that returns a direct URL
     * as plain text.
     */
    const directUrl = absoluteUrl(text.trim());

    if (directUrl) {
      return {
        url: directUrl
      };
    }

    /*
     * Some APIs return JSON embedded in text.
     */
    const firstBrace = text.indexOf("{");
    const lastBrace = text.lastIndexOf("}");

    if (
      firstBrace !== -1 &&
      lastBrace !== -1 &&
      lastBrace > firstBrace
    ) {
      const possibleJson = text.slice(
        firstBrace,
        lastBrace + 1
      );

      const parsed = safeJsonParse(possibleJson);

      if (parsed !== null) {
        return parsed;
      }
    }

    throw new Error(
      "Your API returned an unsupported response."
    );
  }

  /* =========================================================
     GENERIC API RESPONSE PARSER
     ========================================================= */

  const URL_KEYS = [
    "url",
    "download",
    "download_url",
    "downloadUrl",
    "media_url",
    "mediaUrl",
    "video_url",
    "videoUrl",
    "image_url",
    "imageUrl",
    "thumbnail",
    "thumbnail_url",
    "thumbnailUrl",
    "src",
    "source",
    "display_url",
    "displayUrl",
    "play_url",
    "playUrl",
    "content_url",
    "contentUrl"
  ];

  const VIDEO_KEYS = [
    "video",
    "video_url",
    "videoUrl",
    "video_url_hd",
    "videoUrlHd",
    "play_url",
    "playUrl"
  ];

  const IMAGE_KEYS = [
    "image",
    "image_url",
    "imageUrl",
    "display_url",
    "displayUrl",
    "photo",
    "photo_url",
    "photoUrl"
  ];

  const THUMB_KEYS = [
    "thumbnail",
    "thumbnail_url",
    "thumbnailUrl",
    "cover",
    "cover_url",
    "coverUrl",
    "poster",
    "poster_url",
    "posterUrl"
  ];

  const TITLE_KEYS = [
    "title",
    "caption",
    "text",
    "description",
    "name"
  ];

  function getFirstUrl(object, keys) {
    if (!object || typeof object !== "object") {
      return null;
    }

    for (const key of keys) {
      const value = object[key];

      if (typeof value === "string") {
        const url = absoluteUrl(value);

        if (url) {
          return url;
        }
      }
    }

    return null;
  }

  function getFirstString(object, keys) {
    if (!object || typeof object !== "object") {
      return "";
    }

    for (const key of keys) {
      if (
        typeof object[key] === "string" &&
        object[key].trim()
      ) {
        return object[key].trim();
      }
    }

    return "";
  }

  function detectMediaType(object, url) {
    if (!object || typeof object !== "object") {
      return "image";
    }

    const explicitType =
      String(
        object.type ||
        object.media_type ||
        object.mediaType ||
        object.kind ||
        ""
      ).toLowerCase();

    if (
      explicitType.includes("video") ||
      explicitType.includes("mp4")
    ) {
      return "video";
    }

    if (
      explicitType.includes("image") ||
      explicitType.includes("photo") ||
      explicitType.includes("picture")
    ) {
      return "image";
    }

    const videoUrl = getFirstUrl(
      object,
      VIDEO_KEYS
    );

    if (videoUrl) {
      return "video";
    }

    const lowerUrl = String(url || "").toLowerCase();

    if (
      lowerUrl.includes(".mp4") ||
      lowerUrl.includes(".m3u8") ||
      lowerUrl.includes("video")
    ) {
      return "video";
    }

    return "image";
  }

  function createItemFromObject(object) {
    if (!object || typeof object !== "object") {
      return null;
    }

    const videoUrl = getFirstUrl(
      object,
      VIDEO_KEYS
    );

    const imageUrl = getFirstUrl(
      object,
      IMAGE_KEYS
    );

    const genericUrl = getFirstUrl(
      object,
      URL_KEYS
    );

    const mediaUrl =
      videoUrl ||
      imageUrl ||
      genericUrl;

    if (!mediaUrl) {
      return null;
    }

    const type = detectMediaType(
      object,
      mediaUrl
    );

    const thumbnail =
      getFirstUrl(object, THUMB_KEYS) ||
      (type === "image" ? mediaUrl : null);

    const title =
      getFirstString(object, TITLE_KEYS);

    return {
      url: mediaUrl,
      type,
      thumbnail,
      title,
      duration:
        object.duration ||
        object.duration_seconds ||
        object.durationSeconds ||
        null
    };
  }

  function addUniqueItem(items, item) {
    if (!item || !item.url) {
      return;
    }

    const exists = items.some(
      existing => existing.url === item.url
    );

    if (!exists) {
      items.push(item);
    }
  }

  function jsonToItems(data) {
    const items = [];
    const visited = new WeakSet();

    function walk(value, depth = 0) {
      if (depth > 12) {
        return;
      }

      if (value === null || value === undefined) {
        return;
      }

      /*
       * Direct string URL
       */
      if (typeof value === "string") {
        const url = absoluteUrl(value);

        if (url) {
          addUniqueItem(items, {
            url,
            type:
              url.toLowerCase().includes(".mp4") ||
              url.toLowerCase().includes("video")
                ? "video"
                : "image",
            thumbnail:
              url.toLowerCase().includes(".mp4")
                ? null
                : url,
            title: "",
            duration: null
          });
        }

        return;
      }

      if (typeof value !== "object") {
        return;
      }

      if (visited.has(value)) {
        return;
      }

      visited.add(value);

      /*
       * Direct media object
       */
      const item = createItemFromObject(value);

      if (item) {
        addUniqueItem(items, item);
      }

      /*
       * Common arrays.
       */
      for (const key of [
        "items",
        "data",
        "results",
        "result",
        "media",
        "medias",
        "mediaItems",
        "media_items",
        "posts",
        "reels",
        "videos",
        "images",
        "photos",
        "resources",
        "edges",
        "nodes",
        "children",
        "carousel",
        "carousel_media",
        "carouselMedia"
      ]) {
        if (value[key] !== undefined) {
          walk(value[key], depth + 1);
        }
      }

      /*
       * Generic recursive traversal.
       */
      for (const [key, child] of Object.entries(value)) {
        if (
          [
            "url",
            "download",
            "download_url",
            "downloadUrl",
            "media_url",
            "mediaUrl",
            "video_url",
            "videoUrl",
            "image_url",
            "imageUrl",
            "thumbnail",
            "thumbnail_url",
            "thumbnailUrl"
          ].includes(key)
        ) {
          continue;
        }

        if (
          child &&
          typeof child === "object"
        ) {
          walk(child, depth + 1);
        }
      }
    }

    walk(data);

    /*
     * If parser found nothing but data itself is a
     * direct URL-like property, try it one more time.
     */
    if (!items.length && data) {
      const direct = createItemFromObject(data);

      if (direct) {
        items.push(direct);
      }
    }

    return items;
  }

  function normalizeApiResponse(data) {
    /*
     * Some Workers return:
     * {
     *   success: true,
     *   data: [...]
     * }
     *
     * Others:
     * {
     *   status: "success",
     *   result: [...]
     * }
     *
     * jsonToItems handles all of these recursively.
     */

    const items = jsonToItems(data);

    /*
     * Remove obviously invalid URLs.
     */
    return items.filter(
      item =>
        item &&
        item.url &&
        isMediaUrl(item.url)
    );
  }

  /* =========================================================
     MEDIA RESOLUTION
     ========================================================= */

  async function fetchMedia(url) {
    const response = await callInstagramApi(url);
    const items = normalizeApiResponse(response);

    if (!items.length) {
      throw new Error(
        "No downloadable media was found in your API response."
      );
    }

    return {
      items,
      raw: response
    };
  }

  async function fetchStoryMedia(url) {
    return fetchMedia(url);
  }

  /* =========================================================
     DOWNLOAD MEDIA
     ========================================================= */

  async function fetchBlob(url, tries = 2) {
    if (!url) {
      throw new Error("Media URL is missing.");
    }

    let lastError = null;

    for (let attempt = 0; attempt < tries; attempt++) {
      try {
        const response = await fetchLike(url, {
          method: "GET"
        });

        if (!response.ok) {
          throw new Error(
            `Media request failed (${response.status}).`
          );
        }

        const blob = await response.blob();

        if (!blob || blob.size === 0) {
          throw new Error(
            "Downloaded file is empty."
          );
        }

        return blob;
      } catch (error) {
        lastError = error;

        if (attempt < tries - 1) {
          await sleep(500);
        }
      }
    }

    throw lastError ||
      new Error("Unable to download media.");
  }

  function getFileExtension(item, blob) {
    const type =
      String(
        blob?.type ||
        ""
      ).toLowerCase();

    if (
      item.type === "video" ||
      type.includes("video")
    ) {
      return "mp4";
    }

    if (
      type.includes("webp")
    ) {
      return "webp";
    }

    if (
      type.includes("png")
    ) {
      return "png";
    }

    return "jpg";
  }

  function cleanFilename(value) {
    return String(value || "")
      .replace(/[<>:"/\\|?*\x00-\x1F]/g, "")
      .replace(/\s+/g, "_")
      .slice(0, 100) || "instadrop";
  }

  async function triggerSave(
    blob,
    filename
  ) {
    const objectUrl =
      URL.createObjectURL(blob);

    try {
      const anchor =
        document.createElement("a");

      anchor.href = objectUrl;
      anchor.download =
        cleanFilename(filename);

      anchor.style.display = "none";

      document.body.appendChild(anchor);

      anchor.click();

      anchor.remove();
    } finally {
      setTimeout(() => {
        URL.revokeObjectURL(objectUrl);
      }, 1000);
    }
  }

  /* =========================================================
     MP3
     =========================================================

     No external FFmpeg CDN is loaded.

     If your HTML already provides FFmpeg through your own
     code, this function can use it. Otherwise the MP3
     button will report that conversion is unavailable.
     ========================================================= */

  async function convertToMp3() {
    throw new Error(
      "MP3 conversion is not enabled because no external FFmpeg service is used."
    );
  }

  /* =========================================================
     DURATION
     ========================================================= */

  function fmtDuration(seconds) {
    if (
      seconds === null ||
      seconds === undefined ||
      seconds === ""
    ) {
      return "";
    }

    const total =
      Math.max(
        0,
        Math.round(Number(seconds))
      );

    if (!Number.isFinite(total)) {
      return "";
    }

    const minutes =
      Math.floor(total / 60);

    const secs =
      total % 60;

    return `${minutes}:${String(secs).padStart(2, "0")}`;
  }

  /* =========================================================
     UI
     ========================================================= */

  const input =
    $(
      "#urlInput, #downloadInput, input[name='url'], input[type='url']"
    );

  const downloadBtn =
    $(
      "#downloadBtn, #downloadButton, [data-download]"
    );

  const pasteBtn =
    $(
      "#pasteBtn, #pasteButton, [data-paste]"
    );

  const spinner =
    $(
      "#spinner, .spinner, [data-spinner]"
    );

  const errorBox =
    $(
      "#error, #errorMessage, .error-message, [data-error]"
    );

  const results =
    $(
      "#results, #result, .results, [data-results]"
    );

  const resultsSection =
    $(
      "#resultsSection, .results-section, [data-results-section]"
    );

  function setBusy(busy) {
    if (downloadBtn) {
      downloadBtn.disabled = busy;

      if (busy) {
        downloadBtn.setAttribute(
          "aria-busy",
          "true"
        );
      } else {
        downloadBtn.removeAttribute(
          "aria-busy"
        );
      }
    }

    if (spinner) {
      spinner.hidden = !busy;
      spinner.style.display =
        busy ? "" : "none";
    }
  }

  function showError(message) {
    if (!errorBox) {
      return;
    }

    errorBox.textContent =
      String(message || "Something went wrong.");

    errorBox.hidden = false;
    errorBox.style.display = "";

    errorBox.scrollIntoView({
      behavior: "smooth",
      block: "nearest"
    });
  }

  function clearError() {
    if (!errorBox) {
      return;
    }

    errorBox.textContent = "";
    errorBox.hidden = true;
    errorBox.style.display = "none";
  }

  function clearResults() {
    if (!results) {
      return;
    }

    results.innerHTML = "";
  }

  function scrollToResults() {
    const target =
      resultsSection || results;

    if (!target) {
      return;
    }

    setTimeout(() => {
      target.scrollIntoView({
        behavior: "smooth",
        block: "start"
      });
    }, 100);
  }

  /* =========================================================
     RESULT CARD
     ========================================================= */

  function createMediaElement(item) {
    const frame =
      document.createElement("div");

    frame.className =
      "instadrop-media-frame";

    if (item.type === "video") {
      const video =
        document.createElement("video");

      video.className =
        "instadrop-media";

      video.controls = true;
      video.preload = "metadata";
      video.playsInline = true;

      if (item.thumbnail) {
        video.poster =
          item.thumbnail;
      }

      video.src = item.url;

      frame.appendChild(video);

      return frame;
    }

    const image =
      document.createElement("img");

    image.className =
      "instadrop-media";

    image.loading = "lazy";
    image.alt =
      item.title || "Instagram media";

    image.src = item.url;

    frame.appendChild(image);

    return frame;
  }

  function createResultCard(
    item,
    index
  ) {
    const card =
      document.createElement("article");

    card.className =
      "instadrop-result-card";

    card.dataset.index =
      String(index);

    const media =
      createMediaElement(item);

    card.appendChild(media);

    const body =
      document.createElement("div");

    body.className =
      "instadrop-result-body";

    if (item.title) {
      const title =
        document.createElement("div");

      title.className =
        "instadrop-result-title";

      title.textContent =
        item.title;

      body.appendChild(title);
    }

    if (item.duration) {
      const duration =
        document.createElement("span");

      duration.className =
        "instadrop-duration";

      duration.textContent =
        fmtDuration(item.duration);

      body.appendChild(duration);
    }

    const actions =
      document.createElement("div");

    actions.className =
      "instadrop-result-actions";

    const download =
      document.createElement("button");

    download.type = "button";
    download.className =
      "download-media-btn";

    download.textContent =
      item.type === "video"
        ? "Download Video"
        : "Download Image";

    download.addEventListener(
      "click",
      async () => {
        const originalText =
          download.textContent;

        try {
          download.disabled = true;
          download.textContent =
            "Downloading...";

          const blob =
            await fetchBlob(item.url);

          const extension =
            getFileExtension(
              item,
              blob
            );

          const filename =
            `instadrop_${index + 1}.${extension}`;

          await triggerSave(
            blob,
            filename
          );

          download.textContent =
            "Downloaded ✓";

          setTimeout(() => {
            download.textContent =
              originalText;
            download.disabled = false;
          }, 1500);
        } catch (error) {
          download.disabled = false;
          download.textContent =
            originalText;

          showError(
            error?.message ||
            "Could not download this media."
          );
        }
      }
    );

    actions.appendChild(download);

    /*
     * MP3 button is intentionally omitted.
     * No external FFmpeg/CDN is loaded.
     */

    body.appendChild(actions);
    card.appendChild(body);

    return card;
  }

  function renderItems(
    data,
    opts = {},
    inputUrl = ""
  ) {
    clearResults();

    if (!results) {
      return;
    }

    const items =
      Array.isArray(data)
        ? data
        : [];

    if (!items.length) {
      showError(
        "No downloadable media found."
      );

      return;
    }

    const wrapper =
      document.createElement("div");

    wrapper.className =
      "instadrop-results-grid";

    items.forEach((item, index) => {
      wrapper.appendChild(
        createResultCard(
          item,
          index
        )
      );
    });

    results.appendChild(wrapper);

    addHistory({
      url: inputUrl,
      type: opts.type || "media",
      count: items.length,
      timestamp: Date.now()
    });

    scrollToResults();
  }

  /* =========================================================
     PROFILE RESULT
     ========================================================= */

  function renderProfile(
    items,
    username,
    inputUrl
  ) {
    clearResults();

    if (!results) {
      return;
    }

    if (!items.length) {
      showError(
        "Your API did not return a profile image/media URL."
      );

      return;
    }

    /*
     * Prefer the first image.
     */
    const item =
      items.find(
        media =>
          media.type !== "video"
      ) || items[0];

    const card =
      document.createElement("article");

    card.className =
      "instadrop-profile-card";

    const image =
      document.createElement("img");

    image.className =
      "instadrop-profile-image";

    image.alt =
      username
        ? `@${username}`
        : "Instagram profile";

    image.src =
      item.url;

    card.appendChild(image);

    const content =
      document.createElement("div");

    content.className =
      "instadrop-profile-content";

    if (username) {
      const name =
        document.createElement("h3");

      name.textContent =
        `@${username}`;

      content.appendChild(name);
    }

    const button =
      document.createElement("button");

    button.type = "button";
    button.className =
      "download-media-btn";

    button.textContent =
      "Download Profile Picture";

    button.addEventListener(
      "click",
      async () => {
        const original =
          button.textContent;

        try {
          button.disabled = true;
          button.textContent =
            "Downloading...";

          const blob =
            await fetchBlob(
              item.url
            );

          const extension =
            getFileExtension(
              item,
              blob
            );

          await triggerSave(
            blob,
            `instadrop_profile.${extension}`
          );

          button.textContent =
            "Downloaded ✓";

          setTimeout(() => {
            button.textContent =
              original;
            button.disabled = false;
          }, 1500);
        } catch (error) {
          button.disabled = false;
          button.textContent =
            original;

          showError(
            error?.message ||
            "Could not download the profile picture."
          );
        }
      }
    );

    content.appendChild(button);
    card.appendChild(content);

    results.appendChild(card);

    addHistory({
      url: inputUrl,
      type: "profile",
      count: 1,
      timestamp: Date.now()
    });

    scrollToResults();
  }

  /* =========================================================
     MAIN DOWNLOAD
     ========================================================= */

  async function startDownload() {
    if (!input) {
      return;
    }

    clearError();

    const value =
      input.value.trim();

    if (!value) {
      showError(
        "Paste an Instagram link first."
      );

      input.focus();
      return;
    }

    const parsed =
      parseInput(value);

    if (
      parsed.type === "invalid"
    ) {
      showError(
        "Please enter a valid Instagram URL."
      );

      return;
    }

    setBusy(true);

    try {
      clearResults();

      /*
       * IMPORTANT:
       *
       * Every Instagram request goes through:
       *
       * https://instadrop.rishu-rishad2019.workers.dev/?url=
       */

      const response =
        await callInstagramApi(
          parsed.url
        );

      const items =
        normalizeApiResponse(
          response
        );

      if (!items.length) {
        throw new Error(
          "Your API responded successfully, but no downloadable media URL was found."
        );
      }

      if (
        parsed.type === "profile"
      ) {
        renderProfile(
          items,
          parsed.username || "",
          parsed.url
        );
      } else {
        renderItems(
          items,
          {
            type: parsed.type
          },
          parsed.url
        );
      }
    } catch (error) {
      console.error(
        "Instadrop API error:",
        error
      );

      showError(
        error?.message ||
        "Something went wrong while processing the Instagram link."
      );
    } finally {
      setBusy(false);
    }
  }

  /* =========================================================
     HISTORY
     ========================================================= */

  function getHistory() {
    try {
      const raw =
        localStorage.getItem(
          HISTORY_KEY
        );

      if (!raw) {
        return [];
      }

      const parsed =
        JSON.parse(raw);

      return Array.isArray(parsed)
        ? parsed
        : [];
    } catch (_) {
      return [];
    }
  }

  function saveHistory(history) {
    try {
      localStorage.setItem(
        HISTORY_KEY,
        JSON.stringify(
          history.slice(
            0,
            MAX_HISTORY
          )
        )
      );
    } catch (_) {
      // Ignore storage errors.
    }
  }

  function addHistory(entry) {
    if (!entry?.url) {
      return;
    }

    const history =
      getHistory();

    const filtered =
      history.filter(
        item =>
          item &&
          item.url !== entry.url
      );

    filtered.unshift(entry);

    saveHistory(filtered);

    renderHistory();
  }

  function clearHistory() {
    try {
      localStorage.removeItem(
        HISTORY_KEY
      );
    } catch (_) {}

    renderHistory();
  }

  function renderHistory() {
    const container =
      $(
        "#history, .history-list, [data-history]"
      );

    if (!container) {
      return;
    }

    const history =
      getHistory();

    container.innerHTML = "";

    if (!history.length) {
      container.innerHTML =
        `<div class="history-empty">
          No recent downloads.
        </div>`;

      return;
    }

    history.forEach(item => {
      const row =
        document.createElement("div");

      row.className =
        "history-item";

      const text =
        document.createElement("div");

      text.className =
        "history-item-text";

      let displayUrl =
        item.url;

      try {
        const parsed =
          new URL(item.url);

        displayUrl =
          parsed.pathname || item.url;
      } catch (_) {}

      text.textContent =
        displayUrl;

      const button =
        document.createElement("button");

      button.type = "button";
      button.className =
        "history-use-btn";

      button.textContent =
        "Use";

      button.addEventListener(
        "click",
        () => {
          if (input) {
            input.value =
              item.url;

            input.focus();

            window.scrollTo({
              top: 0,
              behavior: "smooth"
            });
          }
        }
      );

      row.appendChild(text);
      row.appendChild(button);

      container.appendChild(row);
    });

    const clear =
      $(
        "#clearHistory, .clear-history, [data-clear-history]"
      );

    if (clear) {
      clear.onclick =
        clearHistory;
    }
  }

  /* =========================================================
     PASTE
     ========================================================= */

  async function pasteFromClipboard() {
    if (!input) {
      return;
    }

    clearError();

    try {
      if (
        !navigator.clipboard ||
        !navigator.clipboard.readText
      ) {
        throw new Error(
          "Clipboard access is not available."
        );
      }

      const text =
        await navigator.clipboard.readText();

      if (!text) {
        showError(
          "Clipboard is empty."
        );

        return;
      }

      input.value =
        text.trim();

      input.dispatchEvent(
        new Event(
          "input",
          {
            bubbles: true
          }
        )
      );

      input.focus();
    } catch (error) {
      showError(
        "Unable to read your clipboard. Please paste the link manually."
      );
    }
  }

  /* =========================================================
     COPY API URL
     ========================================================= */

  function copyApiTemplate() {
    const text =
      INSTADROP_API;

    if (
      navigator.clipboard &&
      navigator.clipboard.writeText
    ) {
      navigator.clipboard
        .writeText(text)
        .then(() => {
          showTemporaryMessage(
            "API URL copied."
          );
        })
        .catch(() => {});
    }
  }

  function showTemporaryMessage(
    message
  ) {
    const existing =
      $(
        ".instadrop-temp-message"
      );

    if (existing) {
      existing.remove();
    }

    const box =
      document.createElement("div");

    box.className =
      "instadrop-temp-message";

    box.textContent =
      message;

    document.body.appendChild(box);

    setTimeout(() => {
      box.remove();
    }, 1800);
  }

  /* =========================================================
     THEME
     ========================================================= */

  function applyTheme(theme) {
    const root =
      document.documentElement;

    if (theme === "system") {
      root.removeAttribute(
        "data-theme"
      );
      return;
    }

    root.setAttribute(
      "data-theme",
      theme
    );
  }

  function getStoredTheme() {
    try {
      return (
        localStorage.getItem(
          THEME_KEY
        ) || "system"
      );
    } catch (_) {
      return "system";
    }
  }

  function setTheme(theme) {
    const valid =
      [
        "light",
        "dark",
        "system"
      ].includes(theme)
        ? theme
        : "system";

    applyTheme(valid);

    try {
      localStorage.setItem(
        THEME_KEY,
        valid
      );
    } catch (_) {}

    updateThemeControls(valid);
  }

  function updateThemeControls(
    theme
  ) {
    $$(
      "[data-theme], [data-set-theme]"
    ).forEach(button => {
      const value =
        button.dataset.theme ||
        button.dataset.setTheme;

      button.classList.toggle(
        "active",
        value === theme
      );

      if (value === theme) {
        button.setAttribute(
          "aria-pressed",
          "true"
        );
      } else {
        button.setAttribute(
          "aria-pressed",
          "false"
        );
      }
    });
  }

  function setupTheme() {
    const theme =
      getStoredTheme();

    applyTheme(theme);
    updateThemeControls(theme);

    $$(
      "[data-set-theme], [data-theme]"
    ).forEach(button => {
      const value =
        button.dataset.setTheme ||
        button.dataset.theme;

      if (
        ![
          "light",
          "dark",
          "system"
        ].includes(value)
      ) {
        return;
      }

      button.addEventListener(
        "click",
        () => {
          setTheme(value);
        }
      );
    });

    /*
     * Optional single theme toggle.
     */
    const toggle =
      $(
        "#themeToggle, .theme-toggle"
      );

    if (toggle) {
      toggle.addEventListener(
        "click",
        () => {
          const current =
            getStoredTheme();

          setTheme(
            current === "dark"
              ? "light"
              : "dark"
          );
        }
      );
    }
  }

  /* =========================================================
     MOBILE MENU
     ========================================================= */

  function setupMobileMenu() {
    const menuButton =
      $(
        "#menuToggle, #hamburger, .menu-toggle"
      );

    const menu =
      $(
        "#mobileMenu, .mobile-menu"
      );

    const overlay =
      $(
        "#menuOverlay, .menu-overlay"
      );

    if (!menuButton || !menu) {
      return;
    }

    function closeMenu() {
      menu.classList.remove(
        "open",
        "active"
      );

      if (overlay) {
        overlay.classList.remove(
          "open",
          "active"
        );
      }

      menuButton.setAttribute(
        "aria-expanded",
        "false"
      );
    }

    function openMenu() {
      menu.classList.add(
        "open",
        "active"
      );

      if (overlay) {
        overlay.classList.add(
          "open",
          "active"
        );
      }

      menuButton.setAttribute(
        "aria-expanded",
        "true"
      );
    }

    menuButton.addEventListener(
      "click",
      () => {
        if (
          menu.classList.contains(
            "open"
          ) ||
          menu.classList.contains(
            "active"
          )
        ) {
          closeMenu();
        } else {
          openMenu();
        }
      }
    );

    if (overlay) {
      overlay.addEventListener(
        "click",
        closeMenu
      );
    }

    $$(
      "a",
      menu
    ).forEach(link => {
      link.addEventListener(
        "click",
        closeMenu
      );
    });
  }

  /* =========================================================
     NAVIGATION
     ========================================================= */

  function setupNavigation() {
    const header =
      $(
        "header, .site-header, [data-header]"
      );

    function updateHeader() {
      if (!header) {
        return;
      }

      header.classList.toggle(
        "scrolled",
        window.scrollY > 10
      );
    }

    window.addEventListener(
      "scroll",
      updateHeader,
      {
        passive: true
      }
    );

    updateHeader();

    const sections = [
      "downloader",
      "features",
      "how",
      "faq"
    ];

    const navLinks =
      sections
        .map(id => ({
          id,
          link: $(
            `[href="#${id}"]`
          )
        }))
        .filter(item => item.link);

    if (!("IntersectionObserver" in window)) {
      return;
    }

    const observer =
      new IntersectionObserver(
        entries => {
          entries.forEach(
            entry => {
              if (!entry.isIntersecting) {
                return;
              }

              navLinks.forEach(
                item => {
                  item.link.classList.toggle(
                    "active",
                    item.id ===
                      entry.target.id
                  );
                }
              );
            }
          );
        },
        {
          rootMargin:
            "-25% 0px -60% 0px",
          threshold: 0
        }
      );

    navLinks.forEach(
      ({ id }) => {
        const section =
          document.getElementById(id);

        if (section) {
          observer.observe(section);
        }
      }
    );
  }

  /* =========================================================
     FAQ
     ========================================================= */

  function setupFaq() {
    const faqItems =
      $$(
        ".faq-item, [data-faq]"
      );

    faqItems.forEach(item => {
      const question =
        $(
          ".faq-question, summary, [data-faq-question]",
          item
        );

      if (!question) {
        return;
      }

      question.addEventListener(
        "click",
        () => {
          faqItems.forEach(
            other => {
              if (other !== item) {
                other.classList.remove(
                  "open",
                  "active"
                );
              }
            }
          );

          item.classList.toggle(
            "open"
          );

          item.classList.toggle(
            "active"
          );
        }
      );
    });
  }

  /* =========================================================
     SCROLL REVEAL
     ========================================================= */

  function setupReveal() {
    const elements =
      $$(
        ".reveal, .fade-up, [data-reveal]"
      );

    if (!elements.length) {
      return;
    }

    if (
      !("IntersectionObserver" in window)
    ) {
      elements.forEach(
        element => {
          element.classList.add(
            "visible",
            "show",
            "active"
          );
        }
      );

      return;
    }

    const observer =
      new IntersectionObserver(
        entries => {
          entries.forEach(
            entry => {
              if (
                entry.isIntersecting
              ) {
                entry.target.classList.add(
                  "visible",
                  "show",
                  "active"
                );

                observer.unobserve(
                  entry.target
                );
              }
            }
          );
        },
        {
          threshold: 0.08
        }
      );

    elements.forEach(
      element => {
        observer.observe(element);
      }
    );
  }

  /* =========================================================
     DEMO / QUICK LINKS
     ========================================================= */

  function setupQuickLinks() {
    $$(
      "[data-url], [data-demo-url], .demo-chip"
    ).forEach(element => {
      element.addEventListener(
        "click",
        () => {
          const value =
            element.dataset.url ||
            element.dataset.demoUrl ||
            element.getAttribute(
              "data-value"
            );

          if (
            !value ||
            !input
          ) {
            return;
          }

          input.value =
            value;

          input.dispatchEvent(
            new Event(
              "input",
              {
                bubbles: true
              }
            )
          );

          input.focus();

          if (
            element.dataset.autodownload ===
            "true"
          ) {
            startDownload();
          }
        }
      );
    });
  }

  /* =========================================================
     URL PREFILL
     ========================================================= */

  function setupUrlPrefill() {
    try {
      const params =
        new URLSearchParams(
          window.location.search
        );

      const url =
        params.get("url");

      if (
        url &&
        input
      ) {
        input.value =
          url;
      }
    } catch (_) {}
  }

  /* =========================================================
     KEYBOARD
     ========================================================= */

  function setupKeyboard() {
    if (!input) {
      return;
    }

    input.addEventListener(
      "keydown",
      event => {
        if (
          event.key === "Enter" &&
          !event.shiftKey
        ) {
          event.preventDefault();

          if (
            downloadBtn &&
            !downloadBtn.disabled
          ) {
            startDownload();
          }
        }
      }
    );
  }

  /* =========================================================
     BUTTONS
     ========================================================= */

  function setupButtons() {
    if (downloadBtn) {
      downloadBtn.addEventListener(
        "click",
        startDownload
      );
    }

    if (pasteBtn) {
      pasteBtn.addEventListener(
        "click",
        pasteFromClipboard
      );
    }

    const copyApi =
      $(
        "#copyApi, [data-copy-api]"
      );

    if (copyApi) {
      copyApi.addEventListener(
        "click",
        copyApiTemplate
      );
    }

    const clearHistoryButton =
      $(
        "#clearHistory, .clear-history, [data-clear-history]"
      );

    if (clearHistoryButton) {
      clearHistoryButton.addEventListener(
        "click",
        clearHistory
      );
    }
  }

  /* =========================================================
     SERVICE WORKER
     ========================================================= */

  function setupServiceWorker() {
    /*
     * sw.js is local to your website.
     * It is NOT an external API.
     */

    if (
      !("serviceWorker" in navigator)
    ) {
      return;
    }

    if (
      location.protocol !== "http:" &&
      location.protocol !== "https:"
    ) {
      return;
    }

    /*
     * Keep this disabled on Perchance pages.
     */
    if (
      location.hostname.includes(
        "perchance.org"
      ) ||
      location.hostname.includes(
        "perchance"
      )
    ) {
      return;
    }

    window.addEventListener(
      "load",
      () => {
        navigator.serviceWorker
          .register("./sw.js")
          .catch(() => {});
      }
    );
  }

  /* =========================================================
     INITIALIZATION
     ========================================================= */

  function init() {
    setupTheme();
    setupMobileMenu();
    setupNavigation();
    setupFaq();
    setupReveal();
    setupQuickLinks();
    setupUrlPrefill();
    setupKeyboard();
    setupButtons();
    setupServiceWorker();

    renderHistory();

    /*
     * Make sure spinner starts hidden.
     */
    if (spinner) {
      spinner.hidden = true;
      spinner.style.display =
        "none";
    }

    if (errorBox) {
      errorBox.hidden = true;
      errorBox.style.display =
        "none";
    }
  }

  if (
    document.readyState ===
    "loading"
  ) {
    document.addEventListener(
      "DOMContentLoaded",
      init,
      {
        once: true
      }
    );
  } else {
    init();
  }

  /* =========================================================
     OPTIONAL GLOBAL API
     ========================================================= */

  /*
   * Useful if your HTML or other scripts want to call
   * Instadrop manually.
   */

  window.InstaDrop = {
    api: INSTADROP_API,
    parseInput,
    callInstagramApi,
    fetchMedia,
    fetchStoryMedia,
    normalizeApiResponse,
    startDownload,
    clearHistory,
    getHistory
  };

})();
