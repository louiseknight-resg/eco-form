const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

// Normalize a UK postcode: strip punctuation, uppercase, insert space before last 3 chars
function normalizePostcode(raw = "") {
  const alnum = raw.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
  if (alnum.length < 5) return alnum; // will fail regex below and return 400
  return alnum.replace(/([A-Z0-9]{3})$/, " $1");
}

async function getJSON(url, opts) {
  const r = await fetch(url, opts);
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    const msg = text || `HTTP ${r.status}`;
    throw new Error(msg);
  }
  return r.json();
}

export default async function handler(req, res) {
  try {
    // 1) Read postcode from query string
    const base = `http://${req.headers.host}`;
    const url = new URL(req.url, base);
    const rawPc = (url.searchParams.get("postcode") || "").trim();

    // 2) Clean + validate
    const postcode = normalizePostcode(rawPc);
    if (!UK_POSTCODE.test(postcode)) {
      return res.status(400).json({ error: "Bad postcode" });
    }

    // 3) Call getAddress.io (server-side; key stays secret)
    const key = process.env.GETADDRESS_KEY;
    if (!key) {
      return res.status(500).json({ error: "Server not configured: GETADDRESS_KEY missing" });
    }

    const apiUrl = `https://api.getaddress.io/find/${encodeURIComponent(postcode)}?api-key=${encodeURIComponent(
      key
    )}`;

    // You could add retries here if you like—this simple version calls once
    const data = await getJSON(apiUrl);

    // 4) Map their response to a simple array for the dropdown
    // getAddress.io returns an array of address strings in data.addresses
    const list = Array.isArray(data.addresses) ? data.addresses : [];

    const options = list.map((addr, i) => {
      // ensure neat single-spaced comma separation
      const label = String(addr)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
        .join(", ");
      return { id: String(i), label };
    });

    return res.status(200).json({
      postcode: data.postcode || postcode,
      options,
    });
  } catch (err) {
    // Don't leak internals; return safe message
    return res.status(502).json({ error: "Address lookup failed" });
  }
}
