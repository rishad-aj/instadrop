const express = require('express');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;
const publicDir = path.join(__dirname, 'public');

// Redirect root /favicon.ico requests to /icons/favicon.ico
app.get('/favicon.ico', (req, res) => {
  res.redirect(301, '/icons/favicon.ico');
});

const SUPPORTED_LANGS = ['en', 'es', 'pt', 'id', 'fr', 'de', 'tr', 'ar', 'hi'];
const SUPPORTED_LANGS_SET = new Set(SUPPORTED_LANGS);

// Canonical lowercase feature routes
const FEATURE_ROUTES = new Set(['photo', 'video', 'reels', 'story', 'highlights', 'audio', 'dp', 'privacy', 'terms']);

// Aliases and typo redirects (/post, /psot, /videos, etc.)
const ROUTE_ALIASES = {
  post: 'photo',
  psot: 'photo',
  photos: 'photo',
  videos: 'video',
  stories: 'story',
  reel: 'reels',
  highlight: 'highlights',
  audios: 'audio',
  dps: 'dp',
  avatar: 'dp',
  profile: 'dp',
};

const SEO_META = {
  home: {
    en: { title: "Instadrop — Free Instagram Media Downloader · Photos, Reels, Videos & Stories", desc: "Download Instagram reels, posts, carousels, profile pictures and story highlights in one click. 100% free, ad-free, no login required — nothing is stored, ever." },
    es: { title: "Instadrop — Descargador de Instagram Gratis · Fotos, Reels, Videos e Historias", desc: "Descarga reels, publicaciones, fotos, historias y destacadas de Instagram en alta calidad. 100% gratis, sin anuncios y sin registro." },
    pt: { title: "Instadrop — Baixar Mídias do Instagram Grátis · Fotos, Reels e Vídeos", desc: "Baixe reels, posts, carrosséis, fotos de perfil e stories do Instagram em máxima qualidade. 100% grátis e sem anúncios." },
    id: { title: "Instadrop — Pengunduh Media Instagram Gratis · Foto, Reels, Video & Story", desc: "Unduh reels, postingan, carousel, foto profil, dan sorotan Instagram dalam kualitas asli. 100% gratis, tanpa iklan, tanpa login." },
    fr: { title: "Instadrop — Téléchargeur Instagram Gratuit · Photos, Reels, Vidéos & Stories", desc: "Téléchargez des reels, publications, photos de profil et stories Instagram en qualité originale. 100% gratuit et sans publicité." },
    de: { title: "Instadrop — Kostenloser Instagram Downloader · Fotos, Reels & Stories", desc: "Laden Sie Instagram Reels, Beiträge, Karussells und Story-Highlights mit einem Klick herunter. 100% kostenlos und werbefrei." },
    tr: { title: "Instadrop — Ücretsiz Instagram İndirici · Fotoğraf, Reels, Video ve Hikayeler", desc: "Instagram reels, gönderi, profil resmi ve hikayelerini tek tıkla tam kalitede indirin. %100 ücretsiz ve reklamsız." },
    ar: { title: "Instadrop — أداة تنزيل وسائط إنستغرام مجاناً · صور، ريلز، فيديو وستوري", desc: "قم بتنزيل مقاطع الريلز والمنشورات والصور وقصص إنستغرام بجودة أصلية كاملة بنقرة واحدة. مجاني 100% وبدون إعلانات وبدون تسجيل." },
    hi: { title: "Instadrop — मुफ्त इंस्टाग्राम मीडिया डाउनलोडर · फोटो, रील्स, वीडियो और स्टोरी", desc: "एक क्लिक में इंस्टाग्राम रील्स, पोस्ट, कैरूसेल, प्रोफ़ाइल फ़ोटो और स्टोरीज़ डाउनलोड करें। 100% मुफ्त, विज्ञापन-मुक्त और बिना लॉगिन।" }
  },
  photo: {
    en: { title: "Instagram Photo & Carousel Downloader · Free Full Quality · Instadrop", desc: "Download Instagram photos and full-resolution multi-photo carousels in one click. 100% free, ad-free, no login required." },
    es: { title: "Descargar Fotos y Carruseles de Instagram Gratis en Alta Calidad · Instadrop", desc: "Descarga fotos de Instagram y carruseles en resolución original en un clic. 100% gratis y sin anuncios." },
    pt: { title: "Baixar Fotos e Carrosséis do Instagram em Alta Resolução · Instadrop", desc: "Baixe fotos e carrosséis completos do Instagram na resolução original. 100% gratuito e seguro." },
    id: { title: "Unduh Foto & Carousel Instagram Kualitas Asli Gratis · Instadrop", desc: "Unduh foto tunggal dan slide carousel Instagram resolusi tinggi tanpa kompresi." },
    fr: { title: "Télécharger Photos et Carrousels Instagram en Haute Qualité · Instadrop", desc: "Téléchargez des photos Instagram et carrousels en qualité originale. Gratuit et sans pub." },
    de: { title: "Instagram Fotos & Karussells kostenlos in Originalqualität herunterladen · Instadrop", desc: "Speichern Sie Instagram Einzelfotos und Karussell-Beiträge in voller Auflösung ohne Qualitätsverlust." },
    tr: { title: "Instagram Fotoğraf ve Kaydırmalı Gönderi İndirici · Ücretsiz · Instadrop", desc: "Instagram fotoğraflarını ve albüm gönderilerini orijinal piksel çözünürlüğünde indirin." },
    ar: { title: "تنزيل صور وألبومات إنستغرام بجودة عالية مجاناً · Instadrop", desc: "تنزيل صور إنستغرام والألبومات بدقة أصلية كاملة بنقرة واحدة. مجاني وبدون إعلانات." },
    hi: { title: "इंस्टाग्राम फोटो और कैरूसेल डाउनलोडर · मुफ्त पूर्ण गुणवत्ता · Instadrop", desc: "एक क्लिक में इंस्टाग्राम फोटो और उच्च गुणवत्ता वाले कैरूसेल डाउनलोड करें। 100% मुफ्त, बिना विज्ञापन।" }
  },
  video: {
    en: { title: "Instagram Video Downloader · Free High Quality MP4 · Instadrop", desc: "Download Instagram feed videos in original HD quality MP4 with audio. Fast, free, no ads." },
    es: { title: "Descargar Videos de Instagram Gratis en Alta Calidad MP4 · Instadrop", desc: "Descarga videos del feed de Instagram en calidad HD con audio. Rápido, gratis y sin anuncios." },
    pt: { title: "Baixar Vídeos do Instagram em Alta Qualidade MP4 · Instadrop", desc: "Baixe vídeos do feed do Instagram em HD com áudio. Rápido, 100% gratuito e sem marcas d'água." },
    id: { title: "Unduh Video Instagram Kualitas HD MP4 Gratis · Instadrop", desc: "Unduh video feed Instagram dalam resolusi HD dengan suara lengkap. Cepat dan bebas iklan." },
    fr: { title: "Télécharger Vidéos Instagram en Haute Qualité MP4 · Instadrop", desc: "Téléchargez des vidéos Instagram en qualité HD avec audio. Sans filigrane et sans pub." },
    de: { title: "Instagram Video Downloader · HD MP4 kostenlos herunterladen · Instadrop", desc: "Laden Sie Instagram Videos in bester HD-Qualität mit Ton herunter. Schnell und werbefrei." },
    tr: { title: "Instagram Video İndirici · Ücretsiz HD MP4 İndirme · Instadrop", desc: "Instagram video gönderilerini sesli ve HD MP4 kalitesinde indirin. Hızlı ve ücretsiz." },
    ar: { title: "تنزيل فيديوهات إنستغرام بجودة عالية MP4 مجاناً · Instadrop", desc: "قم بتنزيل فيديوهات إنستغرام بدقة HD مع الصوت الأصلي. سريع ومجاني بدون إعلانات." },
    hi: { title: "इंस्टाग्राम वीडियो डाउनलोडर · मुफ्त उच्च गुणवत्ता MP4 · Instadrop", desc: "मूल HD गुणवत्ता में ऑडियो के साथ इंस्टाग्राम वीडियो डाउनलोड करें। तेज़, मुफ्त और सुरक्षित।" }
  },
  reels: {
    en: { title: "Instagram Reels Downloader · Free 1080p MP4 with Audio · Instadrop", desc: "Save Instagram reels directly to your camera roll in crystal-clear 1080p MP4. Free & ad-free." },
    es: { title: "Descargar Reels de Instagram Gratis en 1080p MP4 con Audio · Instadrop", desc: "Guarda reels de Instagram directamente en tu dispositivo en 1080p con audio. 100% gratis." },
    pt: { title: "Baixar Reels do Instagram em 1080p MP4 com Áudio · Instadrop", desc: "Salve reels do Instagram no seu aparelho em qualidade máxima 1080p com som." },
    id: { title: "Unduh Reels Instagram 1080p MP4 dengan Suara Gratis · Instadrop", desc: "Simpan reels Instagram ke galeri HP dalam format 1080p jernih dengan audio lengkap." },
    fr: { title: "Télécharger Reels Instagram en 1080p MP4 avec Audio · Instadrop", desc: "Enregistrez des reels Instagram directement sur votre appareil en 1080p haute définition." },
    de: { title: "Instagram Reels Downloader · 1080p MP4 mit Audio kostenlos · Instadrop", desc: "Instagram Reels in brillanter 1080p-Qualität mit Audio direkt auf das Gerät herunterladen." },
    tr: { title: "Instagram Reels İndirici · 1080p MP4 Sesli İndirme · Instadrop", desc: "Instagram reels videolarını 1080p tam kalitede sesli olarak telefonunuza kaydedin." },
    ar: { title: "تنزيل ريلز إنستغرام بجودة 1080p MP4 مع الصوت مجاناً · Instadrop", desc: "احفظ مقاطع ريلز إنستغرام على هاتفك بدقة 1080p واضحة مع الصوت. مجاني وبدون إعلانات." },
    hi: { title: "इंस्टाग्राम रील्स डाउनलोडर · मुफ्त 1080p MP4 ऑडियो के साथ · Instadrop", desc: "इंस्टाग्राम रील्स को सीधे अपने डिवाइस पर क्रिस्टल-क्लियर 1080p MP4 में ऑडियो सहित सेव करें।" }
  },
  story: {
    en: { title: "Instagram Story Downloader · Free & Anonymous Viewer · Instadrop", desc: "Download active Instagram stories and video clips before they disappear. Anonymous and free." },
    es: { title: "Descargar Historias de Instagram Gratis y Anónimo · Instadrop", desc: "Descarga historias de Instagram antes de que desaparezcan. 100% anónimo y sin registro." },
    pt: { title: "Baixar Stories do Instagram Anônimo e Grátis · Instadrop", desc: "Baixe stories do Instagram antes de expirarem. Totalmente anônimo e sem login." },
    id: { title: "Unduh Story Instagram Anonim Gratis · Instadrop", desc: "Unduh video dan foto Instagram stories aktif sebelum 24 jam hilang. Anonim dan gratis." },
    fr: { title: "Télécharger Stories Instagram Anonymement et Gratuitement · Instadrop", desc: "Téléchargez des stories Instagram avant qu'elles ne disparaissent. Totalement anonyme." },
    de: { title: "Instagram Story Downloader · Anonym Stories speichern · Instadrop", desc: "Aktive Instagram Stories anonym vor Ablauf der 24 Stunden in Originalqualität sichern." },
    tr: { title: "Instagram Hikaye İndirici · Gizli ve Ücretsiz İndirme · Instadrop", desc: "Süresi dolmadan önce Instagram hikayelerini anonim olarak indirin. Kayıt gerekmez." },
    ar: { title: "تنزيل ستوري إنستغرام مجاناً وبشكل مجهول · Instadrop", desc: "قم بتنزيل قصص إنستغرام النشطة قبل اختفائها بجودة كاملة دون أن يعرف صاحب الحساب." },
    hi: { title: "इंस्टाग्राम स्टोरी डाउनलोडर · मुफ्त और गोपनीय व्यूअर · Instadrop", desc: "गायब होने से पहले सक्रिय इंस्टाग्राम स्टोरीज़ और वीडियो क्लिप डाउनलोड करें। 100% गोपनीय।" }
  },
  highlights: {
    en: { title: "Instagram Highlights Downloader · Free Story Highlights · Instadrop", desc: "Download full Instagram story highlight collections from public profiles in original quality." },
    es: { title: "Descargar Historias Destacadas de Instagram Gratis · Instadrop", desc: "Descarga colecciones completas de historias destacadas de perfiles públicos en calidad original." },
    pt: { title: "Baixar Destaques do Instagram Grátis · Instadrop", desc: "Baixe destaques completos de perfis públicos do Instagram com áudio e imagem nítidos." },
    id: { title: "Unduh Sorotan (Highlights) Instagram Gratis · Instadrop", desc: "Unduh seluruh koleksi sorotan story Instagram dari profil publik dalam kualitas penuh." },
    fr: { title: "Télécharger les Highlights Instagram Gratuitement · Instadrop", desc: "Téléchargez des collections complètes de stories à la une Instagram en haute définition." },
    de: { title: "Instagram Highlights Downloader · Highlights kostenlos speichern · Instadrop", desc: "Komplette Instagram Story-Highlights von öffentlichen Profilen herunterladen." },
    tr: { title: "Instagram Öne Çıkanlar İndirici · Ücretsiz İndirme · Instadrop", desc: "Herkese açık profillerin öne çıkan hikaye albümlerini tam kalitede indirin." },
    ar: { title: "تنزيل هايلايت إنستغرام بجودة أصلية مجاناً · Instadrop", desc: "تنزيل مجموعات هايلايت إنستغرام من الحسابات العامة بدقة عالية وبكل سهولة." },
    hi: { title: "इंस्टाग्राम हाइलाइट्स डाउनलोडर · मुफ्त स्टोरी हाइलाइट्स · Instadrop", desc: "सार्वजनिक प्रोफ़ाइल से पूरी इंस्टाग्राम स्टोरी हाइलाइट्स मूल गुणवत्ता में डाउनलोड करें।" }
  },
  audio: {
    en: { title: "Instagram Audio Downloader & MP3 Converter · Free · Instadrop", desc: "Extract background music, voiceover and trending sound from reels into high quality MP3." },
    es: { title: "Descargar Audio de Instagram y Convertidor MP3 Gratis · Instadrop", desc: "Extrae música y audio de reels y videos de Instagram a MP3 de alta fidelidad." },
    pt: { title: "Extrair Áudio do Instagram para MP3 Grátis · Instadrop", desc: "Extraia músicas e áudios de reels do Instagram em formato MP3 de alta qualidade." },
    id: { title: "Konverter Audio Instagram ke MP3 Gratis · Instadrop", desc: "Ekstrak musik latar dan suara dari video reels Instagram ke MP3 kualitas tinggi." },
    fr: { title: "Télécharger l'Audio d'Instagram et Convertisseur MP3 Gratuit · Instadrop", desc: "Extrayez la musique et le son des reels Instagram au format MP3 haute qualité." },
    de: { title: "Instagram Audio Downloader & MP3 Konverter kostenlos · Instadrop", desc: "Musik und Töne aus Instagram Reels extrahieren und direkt als MP3 herunterladen." },
    tr: { title: "Instagram Ses ve MP3 İndirici · Ücretsiz Dönüştürücü · Instadrop", desc: "Reels videolarındaki müzik ve sesleri yüksek kalitede MP3 olarak cihazınıza indirin." },
    ar: { title: "تنزيل صوت إنستغرام وتحويله إلى MP3 مجاناً · Instadrop", desc: "استخرج الموسيقى والأصوات من ريلز إنستغرام وحوّلها إلى ملفات MP3 عالية النقاء مجاناً." },
    hi: { title: "इंस्टाग्राम ऑडियो डाउनलोडर और MP3 कनवर्टर · मुफ्त · Instadrop", desc: "रील्स से बैकग्राउंड संगीत और आवाज़ को उच्च गुणवत्ता वाले MP3 में आसानी से निकालें।" }
  },
  dp: {
    en: { title: "Instagram Profile Picture (DP) Downloader · Full HD · Instadrop", desc: "View and download anyone's Instagram profile picture in full HD resolution. Free and private." },
    es: { title: "Ver y Descargar Foto de Perfil de Instagram en HD · Instadrop", desc: "Mira y descarga la foto de perfil de cualquier usuario de Instagram en resolución HD." },
    pt: { title: "Ver e Baixar Foto de Perfil do Instagram em Alta Resolução · Instadrop", desc: "Visualize e baixe fotos de perfil do Instagram em tamanho grande e resolução máxima." },
    id: { title: "Lihat & Unduh Foto Profil (DP) Instagram HD Gratis · Instadrop", desc: "Lihat dan unduh foto profil Instagram siapa saja dalam ukuran penuh dan resolusi HD." },
    fr: { title: "Télécharger Photo de Profil Instagram (DP) en HD · Instadrop", desc: "Affichez et téléchargez la photo de profil de n'importe quel compte Instagram en taille réelle." },
    de: { title: "Instagram Profilbild (DP) in voller HD-Auflösung vergrößern & herunterladen · Instadrop", desc: "Instagram Profilbilder in voller Originalauflösung ansehen und herunterladen." },
    tr: { title: "Instagram Profil Fotoğrafı (PP) Büyütme ve İndirme HD · Instadrop", desc: "Herhangi bir kullanıcının Instagram profil fotoğrafını tam boyutta ve HD kalitede indirin." },
    ar: { title: "عرض وتنزيل صورة الملف الشخصي لإنستغرام بدقة كاملة HD · Instadrop", desc: "شاهد وحمل صورة حساب أي شخص على إنستغرام بحجمها الكامل ودقة عالية HD مجاناً." },
    hi: { title: "इंस्टाग्राम प्रोफ़ाइल फ़ोटो (DP) डाउनलोडर · पूर्ण HD · Instadrop", desc: "किसी की भी इंस्टाग्राम प्रोफ़ाइल फ़ोटो को पूर्ण HD रिज़ॉल्यूशन में देखें और डाउनलोड करें।" }
  }
};

function generateHreflangs(featureSlug) {
  const base = "https://instadrop.web.app";
  const slugPart = featureSlug ? ('/' + featureSlug) : '';

  let tags = `\n    <link rel="alternate" hreflang="x-default" href="${base}${slugPart || '/'}">\n`;
  for (const l of SUPPORTED_LANGS) {
    tags += `    <link rel="alternate" hreflang="${l}" href="${base}/${l}${slugPart}">\n`;
  }
  return tags;
}

function renderHtml(htmlFile, lang, featureKey, featureSlug) {
  const filePath = path.join(publicDir, htmlFile);
  let html = fs.readFileSync(filePath, 'utf8');

  // 1. Set html lang and dir attribute
  const dirAttr = lang === 'ar' ? ' dir="rtl"' : ' dir="ltr"';
  html = html.replace(/<html(\s+[^>]*)?>/i, `<html lang="${lang}"${dirAttr}>`);

  // 2. Set title and meta description
  const metaObj = SEO_META[featureKey] && SEO_META[featureKey][lang] ? SEO_META[featureKey][lang] : (SEO_META[featureKey] && SEO_META[featureKey]['en']);
  if (metaObj) {
    html = html.replace(/<title>[\s\S]*?<\/title>/i, `<title>${metaObj.title}</title>`);
    html = html.replace(/<meta\s+name=["']description["']\s+content=["'][^"']*["']/i, `<meta name="description" content="${metaObj.desc}"`);
    html = html.replace(/<meta\s+property=["']og:title["']\s+content=["'][^"']*["']/i, `<meta property="og:title" content="${metaObj.title}"`);
    html = html.replace(/<meta\s+property=["']og:description["']\s+content=["'][^"']*["']/i, `<meta property="og:description" content="${metaObj.desc}"`);
  }

  // 3. Set canonical URL
  const base = "https://instadrop.web.app";
  const slugPart = featureSlug ? ('/' + featureSlug) : '';
  const currentCanonical = lang === 'en' && !featureSlug ? base + '/' : `${base}/${lang}${slugPart}`;
  if (/<link\s+rel=["']canonical["'][^>]*>/i.test(html)) {
    html = html.replace(/<link\s+rel=["']canonical["'][^>]*>/i, `<link rel="canonical" href="${currentCanonical}">`);
  }

  // 4. Inject alternate hreflang tags
  const hreflangs = generateHreflangs(featureSlug);
  if (html.includes('</head>')) {
    html = html.replace('</head>', hreflangs + '  </head>');
  }

  return html;
}

// Language-prefixed routes: /:lang and /:lang/:feature
app.get('/:lang([a-zA-Z]{2})', (req, res, next) => {
  const lang = req.params.lang.toLowerCase();
  if (!SUPPORTED_LANGS_SET.has(lang)) return next();
  if (req.params.lang !== lang) {
    return res.redirect(301, '/' + lang);
  }
  const rendered = renderHtml('index.html', lang, 'home', '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(rendered);
});

app.get('/:lang([a-zA-Z]{2})/:feature', (req, res, next) => {
  const lang = req.params.lang.toLowerCase();
  if (!SUPPORTED_LANGS_SET.has(lang)) return next();

  const featRaw = req.params.feature;
  const featLower = featRaw.toLowerCase().replace(/\.html$/, '');

  // Handle alias redirects (e.g. /en/psot -> /en/photo)
  if (ROUTE_ALIASES[featLower] && ROUTE_ALIASES[featLower] !== featLower) {
    return res.redirect(301, `/${lang}/${ROUTE_ALIASES[featLower]}`);
  }

  // Case normalization
  if (featRaw !== featLower) {
    return res.redirect(301, `/${lang}/${featLower}`);
  }

  if (FEATURE_ROUTES.has(featLower)) {
    const htmlFile = `${featLower}.html`;
    const rendered = renderHtml(htmlFile, lang, featLower, featLower);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(rendered);
  }

  next();
});

// Root-level feature routes and redirects
app.use((req, res, next) => {
  const seg = req.path.replace(/^\/+|\/+$/g, '');
  if (!seg) return next();
  const lower = seg.toLowerCase().replace(/\.html$/, '');
  const qs = req.url.includes('?') ? req.url.slice(req.url.indexOf('?')) : '';

  if (ROUTE_ALIASES[lower] && ROUTE_ALIASES[lower] !== lower) {
    return res.redirect(301, '/' + ROUTE_ALIASES[lower] + qs);
  }

  if (seg !== lower && FEATURE_ROUTES.has(lower)) {
    return res.redirect(301, '/' + lower + qs);
  }

  if (FEATURE_ROUTES.has(lower)) {
    const htmlFile = `${lower}.html`;
    const rendered = renderHtml(htmlFile, 'en', lower, lower);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    return res.send(rendered);
  }

  next();
});

// Root path /
app.get('/', (req, res) => {
  const rendered = renderHtml('index.html', 'en', 'home', '');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  return res.send(rendered);
});

// Serve static files from /public with cleanUrls support
app.use(
  express.static(publicDir, {
    extensions: ['html'],
  })
);

// Custom 404 fallback
app.use((req, res) => {
  res.status(404).sendFile(path.join(publicDir, '404.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Instadrop server listening on http://0.0.0.0:${PORT}`);
});
