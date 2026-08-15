# Instadrop — Firebase Hosting

Free, ad-free Instagram media downloader (reels, posts, carousels, profile pictures, highlights, audio to MP3).

## Structure

    firebase.json          hosting config (clean URLs, caching, security headers)
    .firebaserc            default project id: instadrop
    public/                the website itself (deploy this folder)
      index.html           page + SEO meta/OG/JSON-LD
      styles.css           all styling
      script.js            all logic
      logo.png / brand.png / favicon.ico   branding
      og-image.png         social share card
      robots.txt / sitemap.xml             SEO
      404.html             custom 404 page

## Deploy — option A (easiest from a phone, no terminal)

1. Push this repo to GitHub.
2. Open https://console.firebase.google.com -> Add project (name it `instadrop`).
3. Build -> Hosting -> Get started -> connect your GitHub repo -> Deploy.
4. Your site: **https://instadrop.web.app**  (auto-redeploys on every push)

## Deploy — option B (Firebase CLI)

    npm i -g firebase-tools
    firebase login
    firebase use --add      # pick the instadrop project
    firebase deploy

## After deploying

- Replace `instadrop.web.app` with your real domain in
  `public/index.html`, `public/robots.txt` and `public/sitemap.xml` if you connect a custom domain.
- Note: instagram/downloadgram fetch endpoints are CORS-restricted from a
  browser; if downloads fail in production you'll need a small serverless
  proxy (Cloudflare Worker or Firebase/Cloud function).
