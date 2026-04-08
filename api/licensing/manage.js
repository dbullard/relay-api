module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const customDomain = process.env.LEMON_SQUEEZY_STORE_CUSTOM_DOMAIN;
    const storeSubdomain = process.env.LEMON_SQUEEZY_STORE_SUBDOMAIN;

    let url = null;

    if (customDomain) {
      const normalized = normalizeHost(customDomain);
      url = `https://${normalized}/billing`;
    } else if (storeSubdomain) {
      const normalized = storeSubdomain.trim().replace(/^https?:\/\//, "").replace(/\/.*$/, "");
      url = `https://${normalized}.lemonsqueezy.com/billing`;
    }

    if (!url) {
      return res.status(500).json({
        ok: false,
        error: "Missing Lemon Squeezy store portal configuration"
      });
    }

    return res.status(200).json({ url });
  } catch (error) {
    console.error("manage error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Server error while building manage subscription URL"
    });
  }
};

function normalizeHost(value) {
  return value
    .trim()
    .replace(/^https?:\/\//, "")
    .replace(/\/.*$/, "");
}
