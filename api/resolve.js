// api/resolve.js

export default async function handler(req, res) {
  // --------------------------------------------------
  // CORS
  // --------------------------------------------------

  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  // Handle browser CORS preflight
  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }


  // --------------------------------------------------
  // ONLY GET REQUESTS
  // --------------------------------------------------

  if (req.method !== "GET") {
    return res.status(405).json({
      success: false,
      error: "Method not allowed"
    });
  }


  // --------------------------------------------------
  // GET INSTAGRAM URL
  // --------------------------------------------------

  const { url } = req.query;


  if (!url) {
    return res.status(400).json({
      success: false,
      error: "Missing Instagram URL"
    });
  }


  // --------------------------------------------------
  // VALIDATE INSTAGRAM URL
  // --------------------------------------------------

  let instagramUrl;

  try {
    instagramUrl = new URL(url);
  } catch {
    return res.status(400).json({
      success: false,
      error: "Invalid URL"
    });
  }


  const hostname =
    instagramUrl.hostname.toLowerCase();


  const validInstagramHosts = [
    "instagram.com",
    "www.instagram.com",
    "m.instagram.com"
  ];


  if (!validInstagramHosts.includes(hostname)) {
    return res.status(400).json({
      success: false,
      error: "URL is not an Instagram URL"
    });
  }


  // --------------------------------------------------
  // DETECT CONTENT TYPE
  // --------------------------------------------------

  const pathname =
    instagramUrl.pathname;


  let type = "unknown";


  if (
    pathname.startsWith("/reel/") ||
    pathname.startsWith("/reels/")
  ) {
    type = "reel";
  }

  else if (
    pathname.startsWith("/p/")
  ) {
    type = "post";
  }

  else if (
    pathname.startsWith("/stories/")
  ) {
    type = "story";
  }

  else if (
    pathname.startsWith("/stories/highlights/")
  ) {
    type = "highlight";
  }


  // --------------------------------------------------
  // RESPONSE
  // --------------------------------------------------

  return res.status(200).json({
    success: true,
    type,
    url: instagramUrl.href,
    message: "Instagram URL received"
  });
}
