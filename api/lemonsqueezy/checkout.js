const fetch = require("node-fetch");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  try {
    const { variant } = req.body;

    let variantId;

    if (variant === "pro-monthly") {
      variantId = process.env.LEMON_SQUEEZY_VARIANT_ID_MONTHLY;
    } else if (variant === "pro-yearly") {
      variantId = process.env.LEMON_SQUEEZY_VARIANT_ID_YEARLY;
    } else {
      return res.status(400).json({ error: "Invalid variant" });
    }

    const response = await fetch("https://api.lemonsqueezy.com/v1/checkouts", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${process.env.LEMON_SQUEEZY_API_KEY}`,
        "Content-Type": "application/vnd.api+json",
        "Accept": "application/vnd.api+json"
      },
      body: JSON.stringify({
        data: {
          type: "checkouts",
          attributes: {
            checkout_data: {
              custom: {
                source: "relay-app"
              }
            }
          },
          relationships: {
            store: {
              data: {
                type: "stores",
                id: process.env.LEMON_SQUEEZY_STORE_ID.toString()
              }
            },
            variant: {
              data: {
                type: "variants",
                id: variantId.toString()
              }
            }
          }
        }
      })
    });

    const data = await response.json();

    const checkoutUrl = data?.data?.attributes?.url;

    if (!checkoutUrl) {
      console.error("Invalid response from Lemon Squeezy:", data);
      return res.status(500).json({ error: "Failed to create checkout" });
    }

    return res.status(200).json({
      url: checkoutUrl
    });

  } catch (err) {
    console.error("Checkout error:", err);
    return res.status(500).json({ error: "Server error" });
  }
};
