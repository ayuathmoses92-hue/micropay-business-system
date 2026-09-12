const buckets = new Map();

function normalizeOrigin(value) {
  let origin = String(value || "").trim();

  // Handle accidental Markdown links or other wrapper text by extracting
  // the first HTTP(S) URL from the configured value.
  const urlMatch = origin.match(/https?:\/\/[^\s\]\)>"']+/i);
  if (urlMatch) {
    origin = urlMatch[0].replace(/[.,;]+$/, "");
  }

  // Origins do not include a trailing slash.
  origin = origin.replace(/\/+$/, "");

  return origin;
}

function getAllowedOrigins() {
  const configured = String(process.env.CLIENT_URL || "")
    .split(",")
    .map(normalizeOrigin)
    .filter(Boolean);

  // TEST frontend origin. This is an exact origin allowlist entry and does
  // not expose credentials or permit arbitrary origins.
  const testFrontendOrigin = "https://ayuathmos92-hue.github.io";

  return Array.from(new Set([...configured, testFrontendOrigin]));
}

export function corsOrigin(origin, callback) {
  const allowed = getAllowedOrigins();

  // Server-to-server / health checks may have no Origin header.
  if (!origin) return callback(null, true);

  if (allowed.includes(normalizeOrigin(origin))) return callback(null, true);

  return callback(new Error("CORS origin not allowed"));
}

export function securityHeaders(req, res, next) {
  res.removeHeader("X-Powered-By");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "DENY");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  if (req.secure || req.headers["x-forwarded-proto"] === "https") {
    res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  }
  next();
}

export function authRateLimit(req, res, next) {
  const key = `${req.ip || "unknown"}:${String(req.body?.email || "").trim().toLowerCase()}`;
  const now = Date.now();
  const windowMs = Number(process.env.AUTH_RATE_WINDOW_MS || 15 * 60 * 1000);
  const max = Number(process.env.AUTH_RATE_MAX || 10);
  const current = buckets.get(key);
  if (!current || now - current.startedAt > windowMs) {
    buckets.set(key, { startedAt: now, count: 1 });
    return next();
  }
  current.count += 1;
  if (current.count > max) {
    const retryAfter = Math.ceil((windowMs - (now - current.startedAt)) / 1000);
    res.setHeader("Retry-After", String(retryAfter));
    return res.status(429).json({ error: "Too many authentication attempts. Please try again later." });
  }
  next();
}

setInterval(() => {
  const cutoff = Date.now() - Number(process.env.AUTH_RATE_WINDOW_MS || 15 * 60 * 1000);
  for (const [key, value] of buckets) if (value.startedAt < cutoff) buckets.delete(key);
}, 15 * 60 * 1000).unref();
