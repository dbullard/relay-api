module.exports = async (req, res) => {
  if (req.method !== "GET") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const apiKey = process.env.LEMON_SQUEEZY_API_KEY;
    const productId = process.env.LEMON_SQUEEZY_PRODUCT_ID;

    if (!apiKey || !productId) {
      return res.status(500).json({
        ok: false,
        error: "Missing Lemon Squeezy API configuration"
      });
    }

    const url =
      `https://api.lemonsqueezy.com/v1/variants` +
      `?filter[product_id]=${encodeURIComponent(productId)}` +
      `&filter[status]=published`;

    const lsResponse = await fetch(url, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${apiKey}`,
        "Accept": "application/vnd.api+json",
        "Content-Type": "application/vnd.api+json"
      }
    });

    const text = await lsResponse.text();
    console.log("Lemon plans status:", lsResponse.status);
    console.log("Lemon plans body:", text);

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
        error: "Failed to load plans",
        details: data
      });
    }

    const plans = (data.data || [])
      .map((item) => {
        const a = item.attributes || {};
        return {
          id: mapVariantToPlanId(a),
          variantId: String(item.id),
          displayName: a.name || "Plan",
          price: a.price ?? null,
          priceFormatted: formatPrice(a.price),
          billingLabel: formatBillingLabel(a.interval, a.interval_count),
          isSubscription: Boolean(a.is_subscription),
          interval: a.interval || null,
          intervalCount: a.interval_count ?? null,
          sort: a.sort ?? 9999
        };
      })
      .sort((lhs, rhs) => lhs.sort - rhs.sort)
      .map(({ sort, ...plan }) => plan);

    return res.status(200).json({ plans });
  } catch (error) {
    console.error("plans error:", error);
    return res.status(500).json({
      ok: false,
      error: error.message || "Server error while loading plans"
    });
  }
};

function mapVariantToPlanId(attributes) {
  const name = (attributes?.name || "").toLowerCase();

  if (name.includes("monthly") || name.includes("month")) {
    return "pro-monthly";
  }

  if (name.includes("yearly") || name.includes("year")) {
    return "pro-yearly";
  }

  return attributes?.slug || "plan";
}

function formatPrice(cents) {
  if (typeof cents !== "number") return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD"
  }).format(cents / 100);
}

function formatBillingLabel(interval, intervalCount) {
  if (!interval) return "One-time purchase";

  const count = typeof intervalCount === "number" ? intervalCount : 1;

  if (count === 1) {
    if (interval === "month") return "Billed monthly";
    if (interval === "year") return "Billed yearly";
    if (interval === "week") return "Billed weekly";
    if (interval === "day") return "Billed daily";
  }

  return `Billed every ${count} ${interval}${count === 1 ? "" : "s"}`;
}
