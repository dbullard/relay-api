import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBearerToken, verifySessionJwt } from "@/lib/auth";
import { decryptLicenseKey } from "@/lib/licenseVault";

type LemonLicenseResponse = {
  deactivated?: boolean;
  error?: string;
  license_key?: {
    status?: string;
    activation_limit?: number;
    activation_usage?: number;
    expires_at?: string | null;
    customer_email?: string | null;
    product_name?: string | null;
    variant_name?: string | null;
  };
  meta?: {
    customer_email?: string | null;
    product_name?: string | null;
    variant_name?: string | null;
  };
};

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function lemonDeactivate(licenseKey: string, instanceID: string) {
  const response = await fetch("https://api.lemonsqueezy.com/v1/licenses/deactivate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      license_key: licenseKey,
      instance_id: instanceID,
    }),
  });

  const data = (await response.json()) as LemonLicenseResponse;

  if (!response.ok || data.error) {
    throw new Error(data.error ?? "Lemon license deactivation failed");
  }

  return data;
}

function entitlementFromLemon(
  license: {
    license_key_masked: string;
    customer_email: string | null;
    product_name: string | null;
    variant_name: string | null;
  },
  response: LemonLicenseResponse
) {
  const licenseKeyInfo = response.license_key ?? {};
  const meta = response.meta ?? {};
  const statusRaw = licenseKeyInfo.status ?? "inactive";

  return {
    license_key_masked: license.license_key_masked,
    customer_email:
      licenseKeyInfo.customer_email ??
      meta.customer_email ??
      license.customer_email,
    product_name:
      licenseKeyInfo.product_name ??
      meta.product_name ??
      license.product_name,
    variant_name:
      licenseKeyInfo.variant_name ??
      meta.variant_name ??
      license.variant_name,
    status: statusRaw,
    activation_usage_count: licenseKeyInfo.activation_usage ?? null,
    activation_limit: licenseKeyInfo.activation_limit ?? null,
    expires_at: normalizeDate(licenseKeyInfo.expires_at),
    last_validated_at: new Date().toISOString(),
  };
}

export async function POST(req: NextRequest) {
  const client = await pool.connect();

  try {
    const token = getBearerToken(req.headers.get("authorization"));

    if (!token) {
      return NextResponse.json(
        { ok: false, error: "Missing bearer token" },
        { status: 401 }
      );
    }

    const session = verifySessionJwt(token);
    const body = await req.json();

    const deviceFingerprint = String(body.deviceFingerprint ?? "").trim();
    const bundleID = String(body.bundleID ?? "").trim();
    const platform = String(body.platform ?? "").trim();

    if (!deviceFingerprint || !bundleID || !platform) {
      return NextResponse.json(
        { ok: false, error: "Missing deactivation context" },
        { status: 400 }
      );
    }

    await client.query("begin");

    const licenseResult = await client.query(
      `
      select
        license_key_masked,
        customer_email,
        product_name,
        variant_name,
        encrypted_license_key
      from licenses
      where user_id = $1
        and source = 'lemonsqueezy'
        and encrypted_license_key is not null
      order by linked_at desc nulls last
      limit 1
      for update
      `,
      [session.userId]
    );

    if (licenseResult.rows.length === 0) {
      const legacyLinkedLicenseResult = await client.query(
        `
        select license_key_masked
        from licenses
        where user_id = $1
          and source = 'lemonsqueezy'
        order by linked_at desc nulls last
        limit 1
        `,
        [session.userId]
      );

      await client.query("rollback");

      if (legacyLinkedLicenseResult.rows.length > 0) {
        return NextResponse.json(
          {
            ok: false,
            error:
              "This linked Lemon license was saved before activation sync was available. Re-link the full Lemon key once to sync activation counts.",
          },
          { status: 409 }
        );
      }

      return NextResponse.json({
        ok: true,
        deactivated: false,
        entitlement: null,
      });
    }

    const license = licenseResult.rows[0];

    const activationResult = await client.query(
      `
      select
        instance_id
      from license_activations
      where user_id = $1
        and license_key_masked = $2
        and device_fingerprint = $3
      limit 1
      for update
      `,
      [session.userId, license.license_key_masked, deviceFingerprint]
    );

    if (activationResult.rows.length === 0 || !activationResult.rows[0].instance_id) {
      await client.query("commit");
      return NextResponse.json({
        ok: true,
        deactivated: false,
        entitlement: null,
      });
    }

    const instanceID = String(activationResult.rows[0].instance_id);
    const lemonResponse = await lemonDeactivate(
      decryptLicenseKey(license.encrypted_license_key),
      instanceID
    );
    const entitlement = entitlementFromLemon(license, lemonResponse);

    await client.query(
      `
      update licenses
      set
        customer_email = $3,
        product_name = $4,
        variant_name = $5,
        status = $6,
        activation_usage_count = $7,
        activation_limit = $8,
        expires_at = $9,
        last_validated_at = now()
      where user_id = $1
        and license_key_masked = $2
      `,
      [
        session.userId,
        license.license_key_masked,
        entitlement.customer_email,
        entitlement.product_name,
        entitlement.variant_name,
        entitlement.status,
        entitlement.activation_usage_count,
        entitlement.activation_limit,
        entitlement.expires_at,
      ]
    );

    await client.query(
      `
      update license_activations
      set
        status = 'inactive',
        last_validated_at = now(),
        last_seen_at = now(),
        updated_at = now()
      where user_id = $1
        and license_key_masked = $2
        and device_fingerprint = $3
      `,
      [session.userId, license.license_key_masked, deviceFingerprint]
    );

    await client.query("commit");

    return NextResponse.json({
      ok: true,
      deactivated: true,
      entitlement: {
        license_key_masked: entitlement.license_key_masked,
        customer_email: entitlement.customer_email,
        product_name: entitlement.product_name,
        variant_name: entitlement.variant_name,
        status: entitlement.status,
        activation_usage_count: entitlement.activation_usage_count,
        activation_limit: entitlement.activation_limit,
        expires_at: entitlement.expires_at,
        source: "lemonsqueezy",
        last_validated_at: entitlement.last_validated_at,
        instance_id: instanceID,
        status_raw: entitlement.status,
        is_active: entitlement.status === "active" || entitlement.status === "inactive",
      },
    });
  } catch (error) {
    await client.query("rollback");
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Unable to deactivate linked license",
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
