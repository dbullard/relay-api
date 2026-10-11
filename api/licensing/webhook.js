const crypto = require("crypto");

module.exports = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;
  const signature = req.headers["x-signature"];

  if (!secret) {
    return res.status(500).send("Server error");
  }

  // Get RAW body (this is the key fix)
  const chunks = [];

  for await (const chunk of req) {
    chunks.push(chunk);
  }

  const rawBody = Buffer.concat(chunks);

  const digest = crypto
    .createHmac("sha256", secret)
    .update(rawBody)
    .digest("hex");

  const received = Buffer.from(String(signature || ""));
  const expected = Buffer.from(digest);
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) {
    console.error("❌ Invalid signature");
    return res.status(401).send("Invalid signature");
  }

  const body = JSON.parse(rawBody.toString());

  const eventName = body?.meta?.event_name;

  console.log("✅ Webhook received:", eventName);

  return res.status(200).json({ ok: true });
};
