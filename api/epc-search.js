// /api/epc-search.js
// POST { postcode, uprn? } -> { found, band?, score?, lmkKey?, certificateDate?, region }

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

// ---- helpers for EPC rows (API sometimes uses hyphenated keys) ----
function getField(obj, ...keys) {
  for (const k of keys) if (obj && obj[k] != null) return obj[k];
  return null;
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

// ---------- England & Wales lookup (UPRN preferred; postcode fallback) ----------
async function lookupEpcEW({ postcode, uprn }) {
  const headers = epcHeaders();
  const pcNoSpace = (postcode || "").replace(/\s+/g, "");

  // 1) Try UPRN (exact)
  if (uprn) {
    const urlU = `https://epc.opendatacommunities.org/api/v1/domestic/search?uprn=${encodeURIComponent(uprn)}`;
    const dataU = await getJSON(urlU, { headers }).catch(() => null);
    const rowsU = dataU ? (Array.isArray(dataU) ? dataU : (Array.isArray(dataU.rows) ? dataU.rows : [])) : [];
    if (rowsU.length) {
      rowsU.sort((a, b) =>
        new Date(getField(b, "lodgement_date", "lodgement-date") || 0) -
        new Date(getField(a, "lodgement_date", "lodgement-date") || 0)
      );
      const rec = rowsU[0];
      const band = getField(rec, "current_energy_rating", "current-energy-rating");
      const score = getField(rec, "current_energy_efficiency", "current-energy-efficiency"); // numeric
      return {
        found: !!band,
        band,
        score: typeof score === "number" ? score : (score ? Number(score) : null),
        lmkKey: getField(rec, "lmk_key", "lmk-key"),
        certificateDate: toISODate(getField(rec, "lodgement_date", "lodgement-date")),
        region: "ENGLAND_WALES",
      };
    }
    // fall through if no rows for that UPRN
  }

  // 2) Postcode fallback (no space)
  const urlP = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(pcNoSpace)}&size=100`;
  const dataP = await getJSON(urlP, { headers }).catch(() => null);
  const rowsP = dataP ? (Array.isArray(dataP) ? dataP : (Array.isArray(dataP.rows) ? dataP.rows : [])) : [];
  if (!rowsP.length) return { found: false, region: "ENGLAND_WALES" };

  rowsP.sort((a, b) =>
    new Date(getField(b, "lodgement_date", "lodgement-date") || 0) -
    new Date(getField(a, "lodgement_date", "lodgement-date") || 0)
  );
  const rec = rowsP[0];
  const band = getField(rec, "current_energy_rating", "current-energy-rating");
  const score = getField(rec, "current_energy_efficiency", "current-energy-efficiency");

  return {
    found: !!band,
    band,
    score: typeof score === "number" ? score : (score ? Number(score) : null),
    lmkKey: getField(rec, "lmk_key", "lmk-key"),
    certificateDate: toISODate(getField(rec, "lodgement_date", "lodgement-date")),
    region: "ENGLAND_WALES",
  };
}

// ---------- Scotland adapter (stub for now – wire your API later) ----------
async function lookupEpcScotland({ postcode, uprn }) {
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
