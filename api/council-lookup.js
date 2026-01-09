// /api/council-lookup.js  (MapIt council data lookup)

const UK_POSTCODE = /^[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}$/i;

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

export default async function handler(req, res) {
  if (applyCORS(req, res)) return;

  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const rawPc = (url.searchParams.get("postcode") || "").trim();

    const postcode = normalizePostcode(rawPc);
    if (!UK_POSTCODE.test(postcode)) {
      return res.status(400).json({ error: "Bad postcode" });
    }

    // Remove spaces for MapIt API (it expects no spaces)
    const mapitPostcode = postcode.replace(/\s/g, "");

    // Call MapIt API
    const resp = await fetch(
      `https://mapit.mysociety.org/postcode/${encodeURIComponent(mapitPostcode)}`
    );

    if (!resp.ok) {
      return res.status(resp.status).json({ error: "Council lookup failed" });
    }

    const data = await resp.json();

    // Extract council information from shortcuts
    const shortcuts = data.shortcuts || {};
    const councilData = {
      postcode: postcode,
      found: !!shortcuts.council,
      council: null,
      ward: null,
      constituency: null
    };

    // Handle two-tier (county + district) vs single-tier
    if (shortcuts.council) {
      if (typeof shortcuts.council === 'object') {
        // Two-tier: has county and district
        const countyArea = data.areas?.[shortcuts.council.county];
        const districtArea = data.areas?.[shortcuts.council.district];

        councilData.council = {
          type: 'two-tier',
          county: {
            id: shortcuts.council.county,
            name: countyArea?.name || null,
            codes: countyArea?.codes || {}
          },
          district: {
            id: shortcuts.council.district,
            name: districtArea?.name || null,
            codes: districtArea?.codes || {}
          }
        };
      } else {
        // Single-tier: just one council ID
        const councilArea = data.areas?.[shortcuts.council];
        councilData.council = {
          type: 'single-tier',
          id: shortcuts.council,
          name: councilArea?.name || null,
          codes: councilArea?.codes || {}
        };
      }
    }

    // Extract ward information
    if (shortcuts.ward) {
      if (typeof shortcuts.ward === 'object') {
        // Two-tier wards
        const countyWard = data.areas?.[shortcuts.ward.county];
        const districtWard = data.areas?.[shortcuts.ward.district];

        councilData.ward = {
          county: {
            id: shortcuts.ward.county,
            name: countyWard?.name || null
          },
          district: {
            id: shortcuts.ward.district,
            name: districtWard?.name || null
          }
        };
      } else {
        // Single ward
        const wardArea = data.areas?.[shortcuts.ward];
        councilData.ward = {
          id: shortcuts.ward,
          name: wardArea?.name || null
        };
      }
    }

    // Extract Westminster constituency
    if (shortcuts.WMC) {
      const wmcArea = data.areas?.[shortcuts.WMC];
      councilData.constituency = {
        id: shortcuts.WMC,
        name: wmcArea?.name || null
      };
    }

    return res.status(200).json(councilData);

  } catch (e) {
    console.error("Council lookup error:", e);
    return res.status(502).json({ error: "Council lookup failed" });
  }
}
