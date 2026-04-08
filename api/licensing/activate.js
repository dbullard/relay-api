module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const {
      licenseKey,
      instanceName,
      deviceFingerprint,
      appVersion,
      bundleID,
      platform
    } = req.body || {};

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
    console.log("Lemon activate status:", lsResponse.status);
    console.log("Lemon activate body:", text);

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

    if (!lsResponse.ok || data?.activated === false || data?.error) {
      return res.status(lsResponse.ok ? 400 : lsResponse.status).json({
        ok: false,
        error: data?.error || "License activation failed",
        details: data
      });
    }

    const instance = data?.instance || {};
    const licenseKeyInfo = data?.license_key || {};
    const meta = data?.meta || {};

    const entitlement = {
      licenseKeyMasked: maskKey(licenseKey),
      licenseKeySuffix: suffixKey(licenseKey),
      instanceID: instance?.id ? String(instance.id) : null,
      customerEmail: licenseKeyInfo?.customer_email || null,
      productName: licenseKeyInfo?.product_name || null,
      variantName: licenseKeyInfo?.variant_name || null,
      statusRaw: licenseKeyInfo?.status || "active",
      expiresAt: normalizeDate(licenseKeyInfo?.expires_at),
      validatedAt: new Date().toISOString(),
      isActive: true,
      source: "lemonsqueezy"
    };

    return res.status(200).json({
      ok: true,
      entitlement,
      meta: {
        activated: data?.activated ?? true,
        instanceName,
        deviceFingerprint: deviceFingerprint || null,
        appVersion: appVersion || null,
        bundleID: bundleID || null,
        platform: platform || null,
        responseMeta: meta
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
  if (!key) return "••••";
  const suffix = key.slice(-4);
  return `••••-••••-••••-${suffix}`;
}

function suffixKey(key) {
  if (!key || key.length < 4) return null;
  return key.slice(-4);
}

function normalizeDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}
