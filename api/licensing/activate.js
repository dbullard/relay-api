module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const { licenseKey, instanceName } = req.body || {};

    if (!licenseKey || !instanceName) {
      return res.status(400).json({
        ok: false,
        error: "Missing licenseKey or instanceName"
      });
    }

    const lsResponse = await fetch("https://api.lemonsqueezy.com/v1/licenses/activate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify({
        license_key: licenseKey,
        instance_name: instanceName
      })
    });

    const text = await lsResponse.text();
    console.log("Lemon response status:", lsResponse.status);
    console.log("Lemon response body:", text);

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
        error: data?.error || "License activation failed",
        details: data
      });
    }

    const instance = data?.instance || {};
    const licenseKeyInfo = data?.license_key || {};

    return res.status(200).json({
      ok: true,
      entitlement: {
        licenseKeyMasked: maskKey(licenseKey),
        instanceID: instance?.id ? String(instance.id) : null,
        customerEmail: licenseKeyInfo?.customer_email || null,
        productName: licenseKeyInfo?.product_name || null,
        variantName: licenseKeyInfo?.variant_name || null,
        statusRaw: licenseKeyInfo?.status || "active",
        expiresAt: normalizeDate(licenseKeyInfo?.expires_at),
        validatedAt: new Date().toISOString(),
        isActive: true,
        source: "lemonsqueezy"
      }
    });
  } catch (error) {
    console.error("activate error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Server error during license activation"
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
