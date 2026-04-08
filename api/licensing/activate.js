const fetch = require("node-fetch");

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

    const response = await fetch("https://api.lemonsqueezy.com/v1/licenses/activate", {
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

    const data = await response.json();

    if (!response.ok || data?.activated === false || data?.error) {
      return res.status(400).json({
        ok: false,
        error: data?.error || "License activation failed"
      });
    }

    const instance = data?.instance || {};
    const meta = data?.meta || {};
    const licenseKeyInfo = data?.license_key || {};

    const entitlement = {
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
        meta
      }
    });
  } catch (error) {
    console.error("activate error:", error);
    return res.status(500).json({
      ok: false,
      error: "Server error during license activation"
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
