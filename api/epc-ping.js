function applyCORS(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type,Authorization");
  if (req.method === "OPTIONS") { res.status(204).end(); return true; }
  return false;
}

function epcHeaders() {
  // Prefer EPC_AUTH_BASIC if present
  const token = process.env.EPC_AUTH_BASIC;
  if (token) return { Authorization: token, Accept: "application/json" };
  const user = process.env.EPC_USERNAME || "";
  const pass = process.env.EPC_PASSWORD || "";
  if (!user || !pass) throw new Error("Missing EPC creds");
  return { Authorization: `Basic ${Buffer.from(`${user}:${pass}`).toString("base64")}`, Accept: "application/json" };
}

export default async function handler(req, res) {
  try {
    const headers = {
      Authorization: process.env.EPC_AUTH_BASIC,
      Accept: "application/json",
    };
    const url = "https://epc.opendatacommunities.org/api/v1/domestic/search?postcode=PR82EG&size=50";
    const r = await fetch(url, { headers });
    const text = await r.text();
    return res.status(200).send(text);
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

