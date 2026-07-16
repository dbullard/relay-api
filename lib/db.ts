import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL || process.env.POSTGRES_URL;

function databaseUrlWithSupabaseSslMode(connectionString: string | undefined) {
  if (!connectionString) return connectionString;

  try {
    const url = new URL(connectionString);
    url.searchParams.set("sslmode", "no-verify");
    return url.toString();
  } catch {
    return connectionString;
  }
}

export const pool = new Pool({
  connectionString: databaseUrlWithSupabaseSslMode(databaseUrl),
});
