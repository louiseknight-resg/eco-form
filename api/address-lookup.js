// /api/address-lookup.js  (Ideal Postcodes with UPRN)

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

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

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const rawPc = (url.searchParams.get("postcode") || "").trim();

    const postcode = normalizePostcode(rawPc);
    if (!UK_POSTCODE.test(postcode)) {
      return res.status(400).json({ error: "Bad postcode" });
    }

    const key = process.env.IDEAL_POSTCODES_KEY;
    if (!key) return res.status(500).json({ error: "Server not configured: IDEAL_POSTCODES_KEY missing" });

    const resp = await fetch(
      `https://api.ideal-postcodes.co.uk/v1/postcodes/${encodeURIComponent(postcode)}?api_key=${encodeURIComponent(key)}`
    );
    if (!resp.ok) return res.status(resp.status).json({ error: "Address lookup failed" });
    const data = await resp.json();

    const results = Array.isArray(data?.result) ? data.result : [];
    const options = results.map((addr, i) => {
      const line1 = addr.line_1 || addr.building_name || addr.thoroughfare || "";
      const town  = addr.post_town || "";
      const pc    = addr.postcode || postcode;
      const label = [line1, town, pc].filter(Boolean).join(", ");
      return {
        id: String(i),
        label,
        uprn: addr.uprn || null,
        line1,
        town,
        postcode: pc
      };
    });

    return res.status(200).json({ postcode, options });
  } catch (e) {
    return res.status(502).json({ error: "Address lookup failed" });
  }
}
