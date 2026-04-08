module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const {
      planId,
      variant,
      email,
      successUrl,
      userId
    } = req.body || {};

    const resolvedPlanId = normalizePlanId(planId || variant);
    const variantId = resolveVariantId(resolvedPlanId);

    if (!variantId) {
      return res.status(400).json({
        ok: false,
        error: "Invalid or missing planId"
      });
    }

    const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
    const storeId = process.env.LEMON_SQUEEZY_STORE_ID;

    if (!apiKey || !storeId) {
      return res.status(500).json({
        ok: false,
        error: "Missing Lemon Squeezy configuration"
      });
    }

    const custom = {
      source: "relay-app",
      plan_id: resolvedPlanId
    };

    if (userId && String(userId).trim().length > 0) {
      custom.user_id = String(userId).trim();
    }

    const payload = {
      data: {
        type: "checkouts",
        attributes: {
          product_options: {
            enabled_variants: [Number(variantId)]
          },
          checkout_data: {
            custom
          }
        },
        relationships: {
          store: {
            data: {
              type: "stores",
              id: String(storeId)
            }
          },
          variant: {
            data: {
              type: "variants",
              id: String(variantId)
            }
          }
        }
      }
    };

    if (email && String(email).trim().length > 0) {
      payload.data.attributes.checkout_data.email = String(email).trim();
    }

    if (successUrl && String(successUrl).trim().length > 0) {
      payload.data.attributes.product_options.redirect_url = String(successUrl).trim();
    }

    const lsResponse = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json"
      },
      body: JSON.stringify(payload)
    });

    const text = await lsResponse.text();
    console.log("Lemon checkout status:", lsResponse.status);
    console.log("Lemon checkout body:", text);

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
        error: "Failed to create checkout",
        details: data
      });
    }

    const checkoutUrl = data?.data?.attributes?.url;

    if (!checkoutUrl) {
      return res.status(502).json({
        ok: false,
        error: "Checkout URL missing from Lemon Squeezy response",
        details: data
      });
    }

    return res.status(200).json({
      ok: true,
      url: checkoutUrl,
      planId: resolvedPlanId,
      variantId: String(variantId)
    });
  } catch (error) {
    console.error("checkout error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Server error while creating checkout"
    });
  }
};

function normalizePlanId(value) {
  if (!value || typeof value !== "string") return null;

  const normalized = value.trim().toLowerCase();

  switch (normalized) {
    case "monthly":
    case "month":
    case "pro-monthly":
    case "relay-pro-monthly":
      return "pro-monthly";

    case "yearly":
    case "year":
    case "annual":
    case "pro-yearly":
    case "relay-pro-yearly":
      return "pro-yearly";

    default:
      return normalized;
  }
}

function resolveVariantId(planId) {
  switch (planId) {
    case "pro-monthly":
      return process.env.LEMON_SQUEEZY_VARIANT_ID_MONTHLY;
    case "pro-yearly":
      return process.env.LEMON_SQUEEZY_VARIANT_ID_YEARLY;
    default:
      return null;
  }
}
