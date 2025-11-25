// /api/epc-search.js
// POST { postcode, uprn?, addressLabel? } -> { found, band?, score?, lmkKey?, certificateDate?, region }

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;
const SCOT_PREFIXES = ["AB","DD","DG","EH","FK","G","HS","IV","KA","KW","KY","ML","PA","PH","TD","ZE"];

function normalizePostcode(raw = "") {
  const alnum = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (alnum.length < 5) return alnum;
  return alnum.replace(/([A-Z0-9]{3})$/, " $1");
}

function applyCORS(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
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

// ---- helpers ----
function getField(obj, ...keys) { for (const k of keys) if (obj && obj[k] != null) return obj[k]; return null; }
function toISODate(s) { if (!s) return null; const m = String(s).match(/^\d{4}-\d{2}-\d{2}/); return m ? m[0] : null; }
function norm(s=""){ return String(s).toLowerCase().replace(/\s+/g," ").trim(); }
function addressScore(a="", b="") {
  const A = new Set(norm(a).split(/[,\s]+/).filter(Boolean));
  const B = new Set(norm(b).split(/[,\s]+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0; for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union; // Jaccard 0..1
}
function rowAddress(rec) {
  // EPC API can use hyphenated keys
  const a1 = getField(rec, "address1", "address-1") || "";
  const a2 = getField(rec, "address2", "address-2") || "";
  const town = getField(rec, "posttown", "post-town") || "";
  const pc = getField(rec, "postcode") || "";
  return [a1, a2, town, pc].filter(Boolean).join(", ");
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

// ---------- England & Wales lookup (UPRN preferred; postcode+match fallback) ----------
async function lookupEpcEW({ postcode, uprn, addressLabel }) {
  const headers = epcHeaders();
  const pcNoSpace = (postcodestrip(postcode));

  // 1) UPRN (exact)
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
      return shape(rec, "ENGLAND_WALES");
    }
    // fall through if none
  }

  // 2) Postcode fallback with address matching
  const urlP = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(pcNoSpace)}&size=100`;
  const dataP = await getJSON(urlP, { headers }).catch(() => null);
  const rowsP = dataP ? (Array.isArray(dataP) ? dataP : (Array.isArray(dataP.rows) ? dataP.rows : [])) : [];
  if (!rowsP.length) return { found: false, region: "ENGLAND_WALES" };

  // If we have an address label (manual or selected), use scoring; otherwise pick most recent
  if (addressLabel) {
    let best = null, bestScore = -1;
    for (const rec of rowsP) {
      const addr = rowAddress(rec);
      const s = addressScore(addr, addressLabel);
      if (s > bestScore) { bestScore = s; best = rec; }
    }
    // require a decent match to avoid picking a random property in that postcode
    const THRESHOLD = 0.35; // tune if needed
    if (!best || bestScore < THRESHOLD) {
      return { found: false, region: "ENGLAND_WALES" };
    }
    return shape(best, "ENGLAND_WALES");
  } else {
    // no label: keep old behaviour (most recent)
    rowsP.sort((a, b) =>
      new Date(getField(b, "lodgement_date", "lodgement-date") || 0) -
      new Date(getField(a, "lodgement_date", "lodgement-date") || 0)
    );
    return shape(rowsP[0], "ENGLAND_WALES");
  }
}

// ---------- Scotland adapter (stub) ----------
async function lookupEpcScotland({ postcode, uprn, addressLabel }) {
  return { found: false, region: "SCOTLAND" };
}

// ---- helpers for EW ----
function postcodestrip(pc=""){return pc.replace(/\s+/g,"");}
function shape(rec, region) {
  const band = getField(rec, "current_energy_rating", "current-energy-rating");
  const score = getField(rec, "current_energy_efficiency", "current-energy-efficiency");
  const potentialBand = getField(rec, "potential_energy_rating", "potential-energy-rating");
  const potentialScore = getField(rec, "potential_energy_efficiency", "potential-energy-efficiency");
  return {
    found: !!band,
    band,
    score: typeof score === "number" ? score : (score ? Number(score) : null),
    potentialBand,
    potentialScore: typeof potentialScore === "number" ? potentialScore : (potentialScore ? Number(potentialScore) : null),
    lmkKey: getField(rec, "lmk_key", "lmk-key"),
    certificateDate: toISODate(getField(rec, "lodgement_date", "lodgement-date")),
    region
  };
}

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "POST only" });

    const { postcode: rawPc = "", uprn = "", addressLabel = "" } = await readJson(req);
    const postcode = normalizePostcode(rawPc);
    if (!UK_POSTCODE.test(postcode)) return res.status(400).json({ error: "Bad postcode" });

    const result = isScottishPostcode(postcode)
      ? await lookupEpcScotland({ postcode, uprn, addressLabel })
      : await lookupEpcEW({ postcode, uprn, addressLabel });

    return res.status(200).json(result);
  } catch (err) {
    return res.status(502).json({ error: "EPC lookup failed" });
  }
}
