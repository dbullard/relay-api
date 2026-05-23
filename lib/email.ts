import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY);

export async function sendMagicLinkEmail(
  email: string,
  verifyUrl: string
) {
  const from =
    process.env.RELAY_AUTH_FROM_EMAIL ??
    "Relay <login@auth.ondeckapps.com>";

  const appVerifyUrl = `${verifyUrl}&redirect=app`;

  const { data, error } = await resend.emails.send({
    from,
    to: email,
    subject: "Sign in to Relay",
    html: `
      <div style="font-family:Arial,sans-serif;padding:24px">
        <h2>Sign in to Relay</h2>

        <p>
          Click the button below to sign in to Relay.
        </p>

        <p>
          <a
            href="${appVerifyUrl}"
            style="
              background:#111;
              color:white;
              padding:12px 18px;
              border-radius:8px;
              text-decoration:none;
              display:inline-block;
            "
          >
            Sign in to Relay
          </a>
        </p>

        <p>
          This link expires in 15 minutes.
        </p>

        <p>
          If you didn’t request this email you can ignore it.
        </p>
      </div>
    `,
    text: `
Sign in to Relay

${appVerifyUrl}

This link expires in 15 minutes.

If you did not request this email, ignore it.
`,
  });

  if (error) {
    throw error;
  }

  return data;
}