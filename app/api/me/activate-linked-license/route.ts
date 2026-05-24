import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBearerToken, verifySessionJwt } from "@/lib/auth";
import { decryptLicenseKey } from "@/lib/licenseVault";

type LemonLicenseResponse = {
  activated?: boolean;
  valid?: boolean;
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
  instance?: {
    id?: string | number;
    name?: string | null;
  };
  meta?: {
    customer_email?: string | null;
    product_name?: string | null;
    variant_name?: string | null;
  };
};

function isValidLicenseStatus(status: string | undefined) {
  return status === "active" || status === "inactive";
}

function isMissingInstanceError(error: unknown) {
  if (!(error instanceof Error)) return false;
  return error.message.toLowerCase().includes("instance_id not found");
}

async function lemonActivate(licenseKey: string, instanceName: string) {
  const response = await fetch("https://api.lemonsqueezy.com/v1/licenses/activate", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      license_key: licenseKey,
      instance_name: instanceName,
    }),
  });

  const data = (await response.json()) as LemonLicenseResponse;

  if (!response.ok || data.activated === false || data.error) {
    throw new Error(data.error ?? "Lemon license activation failed");
  }

  return data;
}

async function lemonValidate(licenseKey: string, instanceID: string) {
  const response = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
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
    throw new Error(data.error ?? "Lemon license validation failed");
  }

  return data;
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function activeEntitlementFromLemon(
  license: {
    license_key_masked: string;
    customer_email: string | null;
    product_name: string | null;
    variant_name: string | null;
  },
  response: LemonLicenseResponse,
  instanceID: string | null
) {
  const licenseKeyInfo = response.license_key ?? {};
  const meta = response.meta ?? {};
  const statusRaw = licenseKeyInfo.status ?? "active";

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
    instance_id: instanceID,
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

    const instanceName = String(body.instanceName ?? "").trim();
    const deviceFingerprint = String(body.deviceFingerprint ?? "").trim();
    const appVersion = String(body.appVersion ?? "").trim();
    const bundleID = String(body.bundleID ?? "").trim();
    const platform = String(body.platform ?? "").trim();

    if (!instanceName || !deviceFingerprint || !bundleID || !platform) {
      return NextResponse.json(
        { ok: false, error: "Missing activation context" },
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
        encrypted_license_key,
        status
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

      return NextResponse.json(
        { ok: false, error: "No linked Lemon Squeezy license found" },
        { status: 404 }
      );
    }

    const license = licenseResult.rows[0];
    const fullLicenseKey = decryptLicenseKey(license.encrypted_license_key);

    const activationResult = await client.query(
      `
      select
        instance_id,
        instance_name
      from license_activations
      where user_id = $1
        and license_key_masked = $2
        and device_fingerprint = $3
      limit 1
      for update
      `,
      [session.userId, license.license_key_masked, deviceFingerprint]
    );

    let lemonResponse: LemonLicenseResponse;
    let instanceID: string | null = null;
    let didActivate = false;

    if (activationResult.rows.length > 0 && activationResult.rows[0].instance_id) {
      const existingInstanceID = String(activationResult.rows[0].instance_id);
      try {
        const validation = await lemonValidate(fullLicenseKey, existingInstanceID);
        const status = validation.license_key?.status;

        if (Boolean(validation.valid) && isValidLicenseStatus(status)) {
          lemonResponse = validation;
          instanceID = existingInstanceID;
        } else {
          lemonResponse = await lemonActivate(fullLicenseKey, instanceName);
          instanceID = lemonResponse.instance?.id ? String(lemonResponse.instance.id) : null;
          didActivate = true;
        }
      } catch (error) {
        if (!isMissingInstanceError(error)) {
          throw error;
        }

        lemonResponse = await lemonActivate(fullLicenseKey, instanceName);
        instanceID = lemonResponse.instance?.id ? String(lemonResponse.instance.id) : null;
        didActivate = true;
      }
    } else {
      lemonResponse = await lemonActivate(fullLicenseKey, instanceName);
      instanceID = lemonResponse.instance?.id ? String(lemonResponse.instance.id) : null;
      didActivate = true;
    }

    const entitlement = activeEntitlementFromLemon(license, lemonResponse, instanceID);

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
      insert into license_activations (
        user_id,
        license_key_masked,
        device_fingerprint,
        instance_id,
        instance_name,
        platform,
        app_version,
        bundle_id,
        status,
        activated_at,
        last_validated_at,
        last_seen_at,
        updated_at
      )
      values (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        now(), now(), now(), now()
      )
      on conflict (user_id, license_key_masked, device_fingerprint)
      do update set
        instance_id = excluded.instance_id,
        instance_name = excluded.instance_name,
        platform = excluded.platform,
        app_version = excluded.app_version,
        bundle_id = excluded.bundle_id,
        status = excluded.status,
        last_validated_at = now(),
        last_seen_at = now(),
        updated_at = now()
      `,
      [
        session.userId,
        license.license_key_masked,
        deviceFingerprint,
        instanceID,
        instanceName,
        platform,
        appVersion || null,
        bundleID,
        entitlement.status,
      ]
    );

    await client.query("commit");

    return NextResponse.json({
      ok: true,
      activated: didActivate,
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
            : "Unable to activate linked license",
      },
      { status: 500 }
    );
  } finally {
    client.release();
  }
}
