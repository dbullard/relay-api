export function buildPoolConfig(env: Record<string, string | undefined>) {
  const raw = env.DATABASE_URL || env.POSTGRES_URL;
  let connectionString = raw;
  if (raw) {
    try {
      const url = new URL(raw);
      url.searchParams.delete("sslmode");
      connectionString = url.toString();
    } catch {
      connectionString = raw;
    }
  }

  const ca = env.SUPABASE_DB_CA_CERT?.replace(/\\n/g, "\n");
  if (ca) return { connectionString, ssl: { rejectUnauthorized: true as const, ca } };

  if (env.RELAY_DB_ALLOW_UNVERIFIED_TLS === "true") {
    console.warn("[DB] TLS certificate verification is DISABLED (RELAY_DB_ALLOW_UNVERIFIED_TLS=true)");
    return { connectionString, ssl: { rejectUnauthorized: false as const } };
  }
  return { connectionString, ssl: { rejectUnauthorized: true as const } };
}
