import { NextRequest, NextResponse } from "next/server";
import { pool } from "@/lib/db";
import { getBearerToken, verifySessionJwt } from "@/lib/auth";
import { resolveAppStoreSubscription } from "@/lib/app-store";
import { decryptLicenseKey } from "@/lib/licenseVault";

type LemonLicenseValidationResponse = {
  valid?: boolean;
  error?: string;
  license_key?: {
    status?: string;
    activation_limit?: number;
    activation_usage?: number;
    expires_at?: string | null;
  };
  meta?: {
    customer_email?: string | null;
    product_name?: string | null;
    variant_name?: string | null;
  };
};

function isSubscriptionPro(status: string, currentPeriodEnd: string | null) {
  if (
    status === "active" ||
    status === "trialing" ||
    status === "on_trial" ||
    status === "billing_grace_period"
  ) {
    return true;
  }

  if (status === "cancelled" && currentPeriodEnd) {
    return new Date(currentPeriodEnd) > new Date();
  }

  return false;
}

function isLicensePro(status: string, expiresAt: string | null) {
  if (status !== "active" && status !== "inactive") {
    return false;
  }

  if (!expiresAt) {
    return true;
  }

  return new Date(expiresAt) > new Date();
}

function isValidLicenseStatus(status: string | undefined) {
  return status === "active" || status === "inactive";
}

function normalizeDate(value: string | null | undefined) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

async function refreshSubscriptionRow(row: {
  provider: string;
  status: string;
  current_period_end: string | null;
  original_transaction_id: string | null;
}) {
  if (row.provider !== "app_store" || !row.original_transaction_id) {
    return row;
  }

  try {
    const resolved = await resolveAppStoreSubscription(row.original_transaction_id);
    return {
      ...row,
      status: resolved.record.status,
      current_period_end: resolved.record.currentPeriodEnd,
    };
  } catch {
    return row;
  }
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

export async function GET(req: NextRequest) {
  try {
    const token = getBearerToken(req.headers.get("authorization"));

    if (!token) {
      return NextResponse.json(
        {
          pro: false,
          authenticated: false,
          subscriptions: [],
          error: "Missing bearer token",
        },
        { status: 401 }
      );
    }

    const session = verifySessionJwt(token);

    const subscriptionResult = await pool.query(
      `
      select
        provider,
        status,
        current_period_end,
        original_transaction_id
      from subscriptions
      where user_id = $1
      order by created_at desc
      `,
      [session.userId]
    );

    const refreshedSubscriptions = await Promise.all(
      subscriptionResult.rows.map(async (row) => {
        const refreshed = await refreshSubscriptionRow(row);

        if (
          refreshed.status !== row.status ||
          refreshed.current_period_end !== row.current_period_end
        ) {
          await pool.query(
            `
            update subscriptions
            set
              status = $3,
              current_period_end = $4,
              updated_at = now()
            where user_id = $1
              and provider = $2
              and (
                original_transaction_id is not distinct from $5
              )
            `,
            [
              session.userId,
              row.provider,
              refreshed.status,
              refreshed.current_period_end,
              row.original_transaction_id,
            ]
          );
        }

        return refreshed;
      })
    );

    const licenseResult = await pool.query(
      `
      select
        license_key_masked,
        customer_email,
        product_name,
        variant_name,
        status,
        encrypted_license_key,
        activation_usage_count,
        activation_limit,
        expires_at,
        source,
        linked_at,
        last_validated_at
      from licenses
      where user_id = $1
      order by linked_at desc
      `,
      [session.userId]
    );

    const refreshedLicenses = await Promise.all(
      licenseResult.rows.map(async (row) => {
        if (row.source !== "lemonsqueezy" || !row.encrypted_license_key) {
          const { encrypted_license_key: _, ...license } = row;
          return license;
        }

        try {
          const validation = await validateLicenseKey(
            decryptLicenseKey(row.encrypted_license_key)
          );
          const status = validation.license_key?.status ?? row.status;
          const refreshed = {
            ...row,
            customer_email:
              validation.meta?.customer_email ?? row.customer_email,
            product_name: validation.meta?.product_name ?? row.product_name,
            variant_name: validation.meta?.variant_name ?? row.variant_name,
            status,
            activation_usage_count:
              validation.license_key?.activation_usage ?? row.activation_usage_count,
            activation_limit:
              validation.license_key?.activation_limit ?? row.activation_limit,
            expires_at:
              normalizeDate(validation.license_key?.expires_at) ?? row.expires_at,
            last_validated_at: new Date().toISOString(),
          };

          if (validation.valid && isValidLicenseStatus(status)) {
            await pool.query(
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
                row.license_key_masked,
                refreshed.customer_email,
                refreshed.product_name,
                refreshed.variant_name,
                refreshed.status,
                refreshed.activation_usage_count,
                refreshed.activation_limit,
                refreshed.expires_at,
              ]
            );
          }

          const { encrypted_license_key: _, ...license } = refreshed;
          return license;
        } catch {
          const { encrypted_license_key: _, ...license } = row;
          return license;
        }
      })
    );

    const hasSubscriptionPro = refreshedSubscriptions.some((row) =>
      isSubscriptionPro(row.status, row.current_period_end)
    );

    const hasLicensePro = refreshedLicenses.some((row) =>
      isLicensePro(row.status, row.expires_at)
    );

    const hasPro = hasSubscriptionPro || hasLicensePro;

    return NextResponse.json({
      pro: hasPro,
      authenticated: true,
      user: {
        id: session.userId,
        email: session.email,
      },
      sources: {
        subscription: hasSubscriptionPro,
        license: hasLicensePro,
      },
      subscriptions: refreshedSubscriptions.map(
        ({ original_transaction_id: _, ...subscription }) => subscription
      ),
      licenses: refreshedLicenses,
    });
  } catch (error) {
    return NextResponse.json(
      {
        pro: false,
        authenticated: false,
        subscriptions: [],
        licenses: [],
        error: error instanceof Error ? error.message : "Invalid session",
      },
      { status: 401 }
    );
  }
}
