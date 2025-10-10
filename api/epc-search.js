// /api/epc-search.js
// POST { postcode, uprn? } -> { found, band?, lmkKey?, certificateDate?, region }

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
const SCOT_PREFIXES = ["AB","DD","DG","EH","FK","G","HS","IV","KA","KW","KY","ML","PA","PH","TD","ZE"];

function normalizePostcode(raw = "") {
  const alnum = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (alnum.length < 5) return alnum;
  return alnum.replace(/([A-Z0-9]{3})$/, " $1");
}

function applyCORS(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*"); // tighten to your domain later
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

async function readJson(req) {
  const bufs = [];
  for await (const c of req) bufs.push(c);
  return JSON.parse(Buffer.concat(bufs).toString("utf8") || "{}");
}

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    throw new Error(`${r.status} ${t || "Request failed"}`);
  }
  return r.json();
}

function isScottishPostcode(pc) {
  const p = pc.replace(/\s+/g, "").toUpperCase();
  const area = p.match(/^[A-Z]{1,2}/)?.[0] || "";
  return SCOT_PREFIXES.includes(area);
}

function toISODate(s) {
  if (!s) return null;
  const m = String(s).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

// Build EPC auth header from env (supports EITHER Basic token or user/pass)
function epcHeaders() {
  const token = process.env.EPC_AUTH_BASIC; // e.g. "Basic abc123=="
  let auth = token;
  if (!auth) {
    const user = process.env.EPC_USERNAME || "";
    const pass = process.env.EPC_PASSWORD || "";
    if (!user || !pass) throw new Error("EPC credentials missing");
    auth = `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`;
  }
  return { Authorization: auth, Accept: "application/json" };
}

// England & Wales lookup (by UPRN preferred; postcode fallback)
async function lookupEpcEW({ postcode, uprn }) {
  const headers = epcHeaders();
  const pcNoSpace = postcode.replace(/\s+/g, "");
const params = uprn
  ? `uprn=${encodeURIComponent(uprn)}`
  : `postcode=${encodeURIComponent(pcNoSpace)}&size=100`;

  const url = `https://epc.opendatacommunities.org/api/v1/domestic/search?${params}`;
  const data = await getJSON(url, { headers });

  const rows = Array.isArray(data) ? data : (Array.isArray(data.rows) ? data.rows : []);
  if (!rows.length) return { found: false, region: "ENGLAND_WALES" };

  // Pick latest certificate by lodgement_date
  rows.sort((a, b) => new Date(b.lodgement_date) - new Date(a.lodgement_date));
  const top = rows[0];

  return {
    found: !!top.current_energy_rating,
    band: top.current_energy_rating || null,
    lmkKey: top.lmk_key || null,
    certificateDate: toISODate(top.lodgement_date) || null,
    region: "ENGLAND_WALES"
  };
}

// Scotland adapter (stub for now – wire your API later if you want)
async function lookupEpcScotland({ postcode, uprn }) {
  // If you have a Scottish EPC API, plug it in here (similar shape).
  // For now, return "not found" so your form continues normally.
  return { found: false, region: "SCOTLAND" };
}

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    const { postcode: rawPc = "", uprn = "" } = await readJson(req);

    const postcode = normalizePostcode(rawPc);
    if (!UK_POSTCODE.test(postcode)) return res.status(400).json({ error: "Bad postcode" });

    const result = isScottishPostcode(postcode)
      ? await lookupEpcScotland({ postcode, uprn })
      : await lookupEpcEW({ postcode, uprn });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({ error: "EPC lookup failed" });
  }
}
