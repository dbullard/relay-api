import { createHmac } from "crypto";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const secret = process.env.LEMON_SQUEEZY_WEBHOOK_SECRET;

  const signature = req.headers["x-signature"];
  const rawBody = JSON.stringify(req.body);

  const hmac = createHmac("sha256", secret);
  const digest = hmac.update(rawBody).digest("hex");

  if (digest !== signature) {
    return res.status(401).send("Invalid signature");
  }

  const eventName = req.body.meta?.event_name;

  console.log("Webhook received:", eventName);

  return res.status(200).json({ ok: true });
}
