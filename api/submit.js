// /api/submit.js — forwards your form payload to GHL Inbound Webhook
export const config = { runtime: "edge" };

function cors(req, headers) {
  const origin = req.headers.get("origin") || "";
  const allow = [
    "https://eco-form.vercel.app"
  ];
  if (allow.includes(origin)) {
    headers.set("Access-Control-Allow-Origin", origin);
    headers.set("Vary", "Origin");
  }
  headers.set("Access-Control-Allow-Methods", "POST,OPTIONS");
  headers.set("Access-Control-Allow-Headers", "Content-Type,Authorization");
}

async function readJson(req) {
  const t = await req.text();
  return t ? JSON.parse(t) : {};
}

export default async function handler(req) {
  const headers = new Headers({ "Content-Type": "application/json" });
  cors(req, headers);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (req.method !== "POST") return new Response(JSON.stringify({ error: "POST only" }), { status: 405, headers });

  try {
    const body = await readJson(req);

    // 💡 minimal validation (front-end already does required checks)
    const required = ["firstName","lastName","email","phone","postcode","addressLabel"];
    for (const k of required) {
      if (!body[k]) return new Response(JSON.stringify({ error: `Missing ${k}` }), { status: 400, headers });
    }

    // GHL fields
    const ghlPayload = {
      firstName: body.firstName,
      lastName:  body.lastName,
      email:     body.email,
      phone:     body.phone,

      // Custom fields 
      postcode:        body.postcode,
      address:         body.addressLabel,
      homeowner:       body.homeowner, // "yes" | "no"
      eligibilityRoute:body.eligibilityRoute, // benefit | medical | income
      measures:        body.measures || "",   // air_solar | air_solar_wall | boiler
      epc_found:       body.epc_found,
      epc_band:        body.epc_band || "",
      epc_score:       body.epc_score ?? "",
      heating:         body.property?.heating || "",
      walls:           body.property?.walls || "",
      solar:           body.property?.solar || "",
      listed:          body.property?.listed || "",
      reason:          body.property?.reason || "",
      committed:       !!body.committed,      // your “I’m serious” checkbox

      // Extras to help routing in GHL
      tags:            "ECO4-Lead," + (body.eligibilityRoute || "unknown"),
      source:          "Website Eligibility Form"
    };

    const url = process.env.GHL_WEBHOOK_URL;
    if (!url) return new Response(JSON.stringify({ error: "GHL_WEBHOOK_URL missing" }), { status: 500, headers });

    const r = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(ghlPayload)
    });

    if (!r.ok) {
      const t = await r.text().catch(() => "");
      return new Response(JSON.stringify({ error: "GHL webhook failed", detail: t.slice(0, 300) }), { status: 502, headers });
    }

    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  } catch {
    return new Response(JSON.stringify({ error: "Submit failed" }), { status: 500, headers });
  }
}

