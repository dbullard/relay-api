import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBearerToken, verifySessionJwt } from "@/lib/auth";
import { encryptLicenseKey } from "@/lib/licenseVault";

type LemonLicenseValidationResponse = {
  valid?: boolean;
  error?: string;
  license_key?: {
    id?: number;
    status?: string;
    key?: string;
    activation_limit?: number;
    activation_usage?: number;
    created_at?: string;
    expires_at?: string | null;
  };
  instance?: {
    id?: string;
    name?: string;
    created_at?: string;
  };
  meta?: {
    product_id?: number;
    product_name?: string;
    variant_id?: number;
    variant_name?: string;
    customer_id?: number;
    customer_name?: string;
    customer_email?: string;
    order_id?: number;
    order_item_id?: number;
  };
};

function maskLicenseKey(licenseKey: string) {
  const trimmed = licenseKey.trim();
  const suffix = trimmed.slice(-6);
  return {
    suffix,
    masked: suffix ? `••••-••••-${suffix}` : "••••",
  };
}

function isValidLicenseStatus(status: string | undefined) {
  return status === "active" || status === "inactive";
}

async function validateLicenseKey(licenseKey: string) {
  const response = await fetch("https://api.lemonsqueezy.com/v1/licenses/validate", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      license_key: licenseKey,
    }),
  });

  const data = (await response.json()) as LemonLicenseValidationResponse;

  if (!response.ok) {
    throw new Error(data.error ?? "Lemon license validation failed");
  }

  return data;
}

export async function POST(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers.get("authorization"));

    if (!token) {
      return NextResponse.json(
        {
          ok: false,
          error: "Missing bearer token",
        },
        { status: 401 }
      );
    }

    const session = verifySessionJwt(token);
    const body = await req.json();
    const licenseKey = String(body.licenseKey ?? "").trim();

    if (!licenseKey) {
      return NextResponse.json(
        {
          ok: false,
          error: "licenseKey required",
        },
        { status: 400 }
      );
    }

    const validation = await validateLicenseKey(licenseKey);
    const licenseStatus = validation.license_key?.status;

    if (!validation.valid || !isValidLicenseStatus(licenseStatus)) {
      return NextResponse.json(
        {
          ok: false,
          error: validation.error ?? "Invalid license key",
        },
        { status: 400 }
      );
    }

    const maskedLicense = maskLicenseKey(licenseKey);
    const customerEmail = validation.meta?.customer_email ?? session.email;
    const expiresAt = validation.license_key?.expires_at ?? null;
    const encryptedLicenseKey = encryptLicenseKey(licenseKey);
    const activationUsageCount = validation.license_key?.activation_usage ?? null;
    const activationLimit = validation.license_key?.activation_limit ?? null;

    const params = [
      session.userId,
      maskedLicense.suffix,
      maskedLicense.masked,
      customerEmail,
      validation.meta?.product_name ?? null,
      validation.meta?.variant_name ?? null,
      licenseStatus,
      expiresAt,
      encryptedLicenseKey,
      activationUsageCount,
      activationLimit,
    ];

    const updateResult = await pool.query(
      `
      update licenses
      set
        license_key_suffix = $2,
        customer_email = $4,
        product_name = $5,
        variant_name = $6,
        status = $7,
        expires_at = $8,
        encrypted_license_key = $9,
        activation_usage_count = $10,
        activation_limit = $11,
        source = 'lemonsqueezy',
        last_validated_at = now()
      where user_id = $1
        and license_key_masked = $3
        and source = 'lemonsqueezy'
      returning
        id,
        license_key_masked,
        customer_email,
        product_name,
        variant_name,
        status,
        activation_usage_count,
        activation_limit,
        expires_at,
        source,
        linked_at,
        last_validated_at
      `,
      params
    );

    const result = updateResult.rows.length > 0
      ? updateResult
      : await pool.query(
          `
          insert into licenses (
            user_id,
            license_key_suffix,
            license_key_masked,
            customer_email,
            product_name,
            variant_name,
            status,
            expires_at,
            encrypted_license_key,
            activation_usage_count,
            activation_limit,
            source,
            last_validated_at
          )
          values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'lemonsqueezy', now())
          returning
            id,
            license_key_masked,
            customer_email,
            product_name,
            variant_name,
            status,
            activation_usage_count,
            activation_limit,
            expires_at,
            source,
            linked_at,
            last_validated_at
          `,
          params
        );

    return NextResponse.json({
      ok: true,
      linked: true,
      user: {
        id: session.userId,
        email: session.email,
      },
      license: result.rows[0],
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Unable to link license",
      },
      { status: 500 }
    );
  }
}
