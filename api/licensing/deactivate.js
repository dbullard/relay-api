const { validLicenseKey } = require("../_lib/limits");
const pool = require("../_lib/pool");
const { enforce } = require("../_lib/rateLimit");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  if (await enforce(req, res, pool, "lic", 30, 60)) return;

  try {
    const { licenseKey, instanceID } = req.body || {};

    if (!validLicenseKey(licenseKey) || typeof instanceID !== "string" || !instanceID || instanceID.length > 128) {
      return res.status(400).json({
        ok: false,
        error: "Missing licenseKey or instanceID"
      });
    }

    const lsResponse = await fetch("https://api.lemonsqueezy.com/v1/licenses/deactivate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        license_key: licenseKey,
        instance_id: instanceID
      })
    });

    const text = await lsResponse.text();
    console.log("Lemon deactivate status:", lsResponse.status);

    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return res.status(502).json({
        ok: false,
        error: "Invalid JSON from Lemon Squeezy"
      });
    }

    if (!lsResponse.ok || data?.error) {
      return res.status(lsResponse.ok ? 400 : lsResponse.status).json({
        ok: false,
        error: data?.error || "License deactivation failed"
      });
    }

    return res.status(200).json({
      ok: true
    });
  } catch (error) {
    console.error("deactivate error:", error);
    return res.status(500).json({
      ok: false,
      error: "Server error during license deactivation"
    });
  }
};
