// eslint-disable-next-line @typescript-eslint/no-require-imports -- Legacy Vercel functions use CommonJS.
const crypto = require("node:crypto");

// Same construction as lib/licenseFingerprint.ts (HMAC-SHA256, hex), but the
// message also includes the instance ID so one license on two Macs counts as
// two clients. The raw license key is never stored.
function clientFingerprint(licenseKey, instanceID, secret) {
  return crypto
    .createHmac("sha256", secret)
    .update(`${String(licenseKey).trim()}|${instanceID ? String(instanceID) : ""}`)
    .digest("hex");
}

// Records that a legacy (paid-build) client called a licensing endpoint.
// Fail-open: this function never throws, so it can never break a license check.
async function recordLegacyLicenseTraffic(query, { endpoint, licenseKey, instanceID, appVersion, secret }) {
  try {
    if (!secret || !licenseKey) return false;
    const fingerprint = clientFingerprint(licenseKey, instanceID, secret);
    const version = typeof appVersion === "string" ? appVersion.slice(0, 64) : null;
    await query(
      `insert into legacy_license_traffic (day, endpoint, client_fingerprint, app_version, calls)
       values ((now() at time zone 'utc')::date, $1, $2, $3, 1)
       on conflict (day, endpoint, client_fingerprint)
       do update set calls = legacy_license_traffic.calls + 1,
                     app_version = coalesce(excluded.app_version, legacy_license_traffic.app_version)`,
      [endpoint, fingerprint, version]
    );
    return true;
  } catch (error) {
    console.error("[LEGACY_TRAFFIC] record failed, ignoring", error instanceof Error ? error.message : error);
    return false;
  }
}

module.exports = { clientFingerprint, recordLegacyLicenseTraffic };
