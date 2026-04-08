module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const { licenseKey, instanceID } = req.body || {};

    if (!licenseKey) {
      return res.status(400).json({
        ok: false,
        error: "Missing licenseKey"
      });
    }

    const payload = {
      license_key: licenseKey
    };

    if (instanceID) {
      payload.instance_id = instanceID;
    }

    const lsResponse = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(payload)
    });

    const text = await lsResponse.text();
    console.log("Lemon validate status:", lsResponse.status);
    console.log("Lemon validate body:", text);

    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      return res.status(502).json({
        ok: false,
        error: "Invalid JSON from Lemon Squeezy",
        raw: text
      });
    }

    if (!lsResponse.ok) {
      return res.status(lsResponse.status).json({
        ok: false,
        error: data?.error || "License validation failed",
        details: data
      });
    }

    const valid = Boolean(data?.valid);
    const instance = data?.instance || {};
    const licenseKeyInfo = data?.license_key || {};

    return res.status(200).json({
      ok: true,
      gracePeriod: false,
      entitlement: {
        licenseKeyMasked: maskKey(licenseKey),
        instanceID: instance?.id ? String(instance.id) : (instanceID || null),
        customerEmail: licenseKeyInfo?.customer_email || null,
        productName: licenseKeyInfo?.product_name || null,
        variantName: licenseKeyInfo?.variant_name || null,
        statusRaw: licenseKeyInfo?.status || (valid ? "active" : "invalid"),
        expiresAt: normalizeDate(licenseKeyInfo?.expires_at),
        validatedAt: new Date().toISOString(),
        isActive: valid,
        source: "lemonsqueezy"
      }
    });
  } catch (error) {
    console.error("validate error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Server error during license validation"
    });
  }
};

function maskKey(key) {
  if (!key || key.length < 8) return "••••";
  return `${key.slice(0, 4)}••••${key.slice(-4)}`;
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
