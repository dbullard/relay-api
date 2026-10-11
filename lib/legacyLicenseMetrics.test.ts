import test from "node:test";
import assert from "node:assert/strict";
import { LEGACY_LICENSE_METRICS_SQL, legacyLicenseMetricsFromRow } from "./legacyLicenseMetrics";

test("maps a database row to metrics", () => {
  assert.deepEqual(
    legacyLicenseMetricsFromRow({ last_1_day: 1, last_7_days: 3, last_30_days: 5, last_activity_day: "2026-10-09" }),
    { last1Day: 1, last7Days: 3, last30Days: 5, lastActivityDay: "2026-10-09" }
  );
});

test("an empty or missing row gives zeros and no last-activity day", () => {
  const empty = { last1Day: 0, last7Days: 0, last30Days: 0, lastActivityDay: null };
  assert.deepEqual(legacyLicenseMetricsFromRow(undefined), empty);
  assert.deepEqual(
    legacyLicenseMetricsFromRow({ last_1_day: null, last_7_days: null, last_30_days: null, last_activity_day: null }),
    empty
  );
});

test("the query only reads validate and activate traffic", () => {
  assert.match(LEGACY_LICENSE_METRICS_SQL, /endpoint in \('validate', 'activate'\)/);
  assert.match(LEGACY_LICENSE_METRICS_SQL, /from legacy_license_traffic/);
});
