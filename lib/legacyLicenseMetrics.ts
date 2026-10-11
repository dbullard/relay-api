export type LegacyLicenseMetrics = {
  last1Day: number;
  last7Days: number;
  last30Days: number;
  lastActivityDay: string | null;
};

type Row = {
  last_1_day: number | null;
  last_7_days: number | null;
  last_30_days: number | null;
  last_activity_day: string | null;
};

export const LEGACY_LICENSE_METRICS_SQL = `
  select
    count(distinct client_fingerprint) filter (where day >= (now() at time zone 'utc')::date)::int as last_1_day,
    count(distinct client_fingerprint) filter (where day >= (now() at time zone 'utc')::date - 6)::int as last_7_days,
    count(distinct client_fingerprint) filter (where day >= (now() at time zone 'utc')::date - 29)::int as last_30_days,
    max(day)::text as last_activity_day
  from legacy_license_traffic
  where endpoint in ('validate', 'activate');
`;

export function legacyLicenseMetricsFromRow(row: Row | undefined): LegacyLicenseMetrics {
  return {
    last1Day: row?.last_1_day ?? 0,
    last7Days: row?.last_7_days ?? 0,
    last30Days: row?.last_30_days ?? 0,
    lastActivityDay: row?.last_activity_day ?? null,
  };
}
