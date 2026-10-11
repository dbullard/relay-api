import { Pool } from "pg";
import { buildPoolConfig } from "../lib/dbConfig";
import { decryptLicenseKey } from "../lib/licenseVault";
import { licenseFingerprint } from "../lib/licenseFingerprint";

async function main() {
  const secret = process.env.RELAY_LICENSE_ENCRYPTION_SECRET;
  if (!secret) throw new Error("RELAY_LICENSE_ENCRYPTION_SECRET is required");

  const pool = new Pool(buildPoolConfig(process.env));
  try {
    const rows = await pool.query(
      "select id, encrypted_license_key from licenses where encrypted_license_key is not null and license_key_hmac is null"
    );
    let updated = 0;
    for (const row of rows.rows) {
      const key = decryptLicenseKey(row.encrypted_license_key);
      await pool.query("update licenses set license_key_hmac = $1 where id = $2", [
        licenseFingerprint(key, secret),
        row.id,
      ]);
      updated++;
    }
    console.log(`Backfilled ${updated} license row(s)`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
