// /api/submit.js
// Forwards form submissions to GoHighLevel (GHL) Inbound Webhook

export const config = { runtime: "edge" }; // fast cold starts

/** ----- CORS ----- */
function cors(req, allowedOrigins = []) {
  const origin = req.headers.get("origin") || "";
  const allow = allowedOrigins.length ? allowedOrigins : ["*"];

  const headers = {
    "Access-Control-Allow-Origin":
      allow.includes("*") || allow.includes(origin) ? origin || "*" : allow[0] || "*",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type,Authorization",
  };

  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers });
  }
  return headers; // merge into real response later
}

/** ----- tiny helpers ----- */
const required = (o, k) => (o[k] && String(o[k]).trim().length > 0);
const emailOk = (s = "") => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

/** ----- main handler ----- */
export default async function handler(req) {
  // 1) CORS
  const corsHeaders = cors(req, [
    "https://eco-form.vercel.app",
    "https://apply.resg.uk",
  ]);
  if (corsHeaders instanceof Response) return corsHeaders; // OPTIONS preflight handled

  // 2) Only POST
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 3) Parse + validate
  let body;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Minimal sanity checks (tweak later)
  if (!required(body, "status")) {
    return new Response(JSON.stringify({ error: "Missing field: status" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!required(body, "phone") || !required(body, "email")) {
    return new Response(JSON.stringify({ error: "Missing phone or email" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (!emailOk(body.email)) {
    return new Response(JSON.stringify({ error: "Invalid email format" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 4) Resolve destination webhook (env var in Vercel)
  const WEBHOOK_URL =
    process.env.GHL_WEBHOOK_URL ||
    process.env.NEXT_PUBLIC_GHL_WEBHOOK_URL || // if you ever expose for dev (not recommended)
    "";

  if (!WEBHOOK_URL) {
    return new Response(JSON.stringify({ error: "Webhook URL not configured" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // 5) Prepare payload (pass through, plus a little metadata)
  const payload = {
    ...body,
    _meta: {
      source: "eco-form",
      receivedAt: new Date().toISOString(),
      ip: req.headers.get("x-forwarded-for") || null,
      userAgent: req.headers.get("user-agent") || null,
    },
  };

  // 6) Send to GHL with a timeout
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000); // 8s safeguard

  try {
    const r = await fetch(WEBHOOK_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!r.ok) {
      const text = await r.text().catch(() => "");
      return new Response(
        JSON.stringify({ error: "GHL webhook error", status: r.status, body: text.slice(0, 500) }),
        { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    clearTimeout(timeout);
    const msg = (err && err.name === "AbortError") ? "Timeout sending to GHL" : "Fetch error";
    return new Response(JSON.stringify({ error: msg }), {
      status: 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}
