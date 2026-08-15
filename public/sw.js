/* Instadrop service worker — enables "Add to Home Screen" install + offline cache.
   Bump CACHE on every release so browsers fetch fresh files after a deploy. */
var CACHE = "instadrop-v3";
var CORE = ["/", "/index.html", "/styles.css", "/script.js", "/favicon.ico", "/logo.png", "/brand.png", "/manifest.webmanifest", "/apple-touch-icon-light.png", "/apple-touch-icon-dark.png"];

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

self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;

  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(CACHE).then(function (c) { return c.put("/index.html", copy); });
        return res;
      }).catch(function () { return caches.match("/index.html"); })
    );
    return;
  }

  var isFresh = /\.(css|js|json|webmanifest)$/.test(url.pathname);

  if (isFresh) {
    /* css/js/manifest: always try network first so deploys show instantly, cache as backup */
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

  /* images/fonts/others: cache-first, then network */
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
