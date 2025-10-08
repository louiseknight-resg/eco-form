// /api/epc-search.js
// POST { postcode, addressLabel? } -> { found, band?, lmkKey?, certificateDate? }

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

function normalizePostcode(raw = "") {
  const alnum = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (alnum.length < 5) return alnum;
  return alnum.replace(/([A-Z0-9]{3})$/, " $1");
}

function norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function toISODate(s) {
  // Many EPC fields are '2023-09-14', sometimes with time. We keep the date part.
  if (!s) return null;
  const m = String(s).match(/^\d{4}-\d{2}-\d{2}/);
  return m ? m[0] : null;
}

// Simple token overlap score for address matching (0..1)
function addressScore(a = "", b = "") {
  const A = new Set(norm(a).split(/[,\s]+/).filter(Boolean));
  const B = new Set(norm(b).split(/[,\s]+/).filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  const union = A.size + B.size - inter;
  return inter / union; // Jaccard
}

async function readJson(req) {
  const bufs = [];
  for await (const c of req) bufs.push(c);
  const txt = Buffer.concat(bufs).toString("utf8") || "{}";
  return JSON.parse(txt);
}

async function getJSON(url, headers, retries = 2) {
  for (let i = 0; i <= retries; i++) {
    const r = await fetch(url, { headers });
    if (r.ok) return r.json();
    // 429/5xx: small backoff then retry
    if (r.status >= 500 || r.status === 429) await new Promise(s => setTimeout(s, 300 * (i + 1)));
    else {
      const txt = await r.text().catch(() => "");
      throw new Error(`EPC search failed: ${r.status} ${txt}`);
    }
  }
  throw new Error("EPC search failed after retries");
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "POST only" });
    }

    const { postcode: rawPc = "", addressLabel = "" } = await readJson(req);

    // 1) Clean + validate postcode
    const postcode = normalizePostcode(rawPc);
    if (!UK_POSTCODE.test(postcode)) {
      return res.status(400).json({ error: "Bad postcode" });
    }

    // 2) EPC auth headers
    const user = process.env.EPC_USERNAME || "";
    const pass = process.env.EPC_PASSWORD || "";
    if (!user || !pass) {
      return res.status(500).json({ error: "Server not configured: EPC credentials missing" });
    }
    const basic = Buffer.from(`${user}:${pass}`).toString("base64");
    const headers = {
      "Authorization": `Basic ${basic}`,
      "Accept": "application/json"
    };

    // 3) Search EPC by postcode (limit size for performance)
    const epcUrl = `https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=${encodeURIComponent(postcode)}&size=80`;
    const data = await getJSON(epcUrl, headers);

    // API sometimes returns { rows: [...] } or just an array
    const rows = Array.isArray(data) ? data : Array.isArray(data.rows) ? data.rows : [];

    if (!rows.length) {
      // No records for this postcode
      return res.status(200).json({ found: false });
    }

    // 4) Choose best match
    const target = norm(addressLabel);
    let picked = null;

    if (target) {
      // Score each record by address similarity + recency boost
      let bestScore = -1;
      for (const rec of rows) {
        const addr = [rec.address1, rec.address2, rec.posttown, rec.postcode].filter(Boolean).join(", ");
        const score = addressScore(addr, addressLabel);
        // Light recency boost
        const lodgement = toISODate(rec.lodgement_date) || toISODate(rec.inspection_date);
        const recentBoost = lodgement ? (Date.parse(lodgement) / 1e13) : 0; // tiny bump
        const finalScore = score + recentBoost;
        if (finalScore > bestScore) {
          bestScore = finalScore;
          picked = { rec, addr, lodgement };
        }
      }
    }

    if (!picked) {
      // No label or no good score → pick most recent certificate in that postcode
      let best = null;
      for (const rec of rows) {
        const lodgement = toISODate(rec.lodgement_date) || toISODate(rec.inspection_date);
        if (!best) best = { rec, lodgement };
        else {
          const a = Date.parse(lodgement || "1970-01-01");
          const b = Date.parse(best.lodgement || "1970-01-01");
          if (a > b) best = { rec, lodgement };
        }
      }
      picked = best;
    }

    if (!picked || !picked.rec) {
      return res.status(200).json({ found: false });
    }

    const band = picked.rec.current_energy_rating || null;
    return res.status(200).json({
      found: !!band,
      band,
      lmkKey: picked.rec.lmk_key || null,
      certificateDate: picked.lodgement || null
    });
  } catch (err) {
    // Hide internal details from the client
    return res.status(502).json({ error: "EPC lookup failed" });
  }
}

