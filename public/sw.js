/* Instadrop service worker v17 — install + offline cache + widgets + share_target.
   Drop-in replacement for public/sw.js. Bump CACHE on every release. */
var CACHE = "instadrop-v17";
var CORE = [
  "/", "/index.html", "/widget.html", "/privacy.html", "/terms.html", "/404.html",
  "/css/styles.css", "/css/legal.css", "/js/script.js",
  "/icons/favicon.ico", "/images/logo.png", "/images/brand.png", "/images/wordmark.svg",
  "/images/widget-screenshot.png", "/images/screenshot-wide.png", "/images/screenshot-narrow.png",
  "/manifest.webmanifest",
  "/icons/icon-192.png", "/icons/icon-512.png", "/icons/icon-maskable-512.png",
  "/icons/shortcut-reel-192.png", "/icons/shortcut-profile-192.png",
  "/icons/shortcut-audio-192.png", "/icons/shortcut-paste-192.png",
  "/icons/apple-touch-icon-light.png", "/icons/apple-touch-icon-dark.png",
  "/widgets/instadrop-bar-template.json",
  "/widgets/instadrop-bar-data.json"
];

self.addEventListener("install", function (e) {
  e.waitUntil(
    caches.open(CACHE).then(function (c) { return c.addAll(CORE); }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener("activate", function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* PWA Widgets Board (Windows/Edge): keep tile data fresh + route taps. */
self.addEventListener("widgetinstall", function (e) {
  e.waitUntil(updateWidgets(e));
});
self.addEventListener("widgetresize", function (e) {
  e.waitUntil(updateWidgets(e));
});
self.addEventListener("periodicsync", function (e) {
  if (e.tag === "instadrop-widgets") e.waitUntil(updateWidgets(e));
});
async function updateWidgets(e) {
  try {
    if (!("widgets" in self) || !self.widgets) return;
    var defs = await self.widgets.getTemplates();
    for (var i = 0; i < defs.length; i++) {
      await self.widgets.updateByTag(defs[i], {
        linkPlaceholder: "https://www.instagram.com/example/... or @username",
        linkHint: "Reels · posts · profile pics · extract audio — 100% free"
      });
    }
  } catch (err) { /* widgets not supported here — widget.html covers Android */ }
}

/* Widget Adaptive Card button taps. */
self.addEventListener("widgetclick", function (e) {
  var action = e.action || "open";
  var data = (e.payload && e.payload.link) || "";
  var url = action === "paste" ? "/widget.html?action=paste" : ("/?url=" + encodeURIComponent(data || "") + "#downloader");
  e.waitUntil(clients.matchAll({ type: "window" }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      if ("navigate" in list[i]) return list[i].navigate(url).then(function (c) { return c && c.focus(); });
    }
    return clients.openWindow(url);
  }));
});

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        /* share_target GET lands on /?title=&text=&url= — cache shell, page JS reads params */
        caches.open(CACHE).then(function (c) { return c.put("/index.html", copy); });
        return res;
      }).catch(function () { return caches.match("/index.html"); })
    );
    return;
  }

  var isFresh = /\.(css|js|json|webmanifest)$/.test(url.pathname);

  if (isFresh) {
    e.respondWith(
      fetch(req).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { return c.put(req, copy); });
        }
        return res;
      }).catch(function () { return caches.match(req); })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        if (res.ok) {
          var copy = res.clone();
          caches.open(CACHE).then(function (c) { return c.put(req, copy); });
        }
        return res;
      });
    })
  );
});
