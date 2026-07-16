"use client";

import { useCallback, useEffect, useState } from "react";

type Metrics = {
  activeUsers: number;
  activeInstallations: number;
  relayAccounts: number;
  versions: Array<{ platform: string; appVersion: string; activeUsers: number }>;
};

export default function DashboardClient() {
  const [metrics, setMetrics] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadMetrics = useCallback(async () => {
    try {
      const response = await fetch("/api/dashboard/metrics");
      if (!response.ok) {
        setError(response.status === 403 ? "Dashboard access denied." : "Your dashboard session has expired.");
        return;
      }

      setMetrics(await response.json());
      setError(null);
    } catch {
      setError("Unable to load dashboard metrics.");
    }
  }, []);

  useEffect(() => {
    const initialLoad = window.setTimeout(() => void loadMetrics(), 0);
    const interval = window.setInterval(() => void loadMetrics(), 30_000);
    return () => {
      window.clearTimeout(initialLoad);
      window.clearInterval(interval);
    };
  }, [loadMetrics]);

  const cards = [
    { title: "Opt-in signed-in users — Active now", value: metrics?.activeUsers ?? "—" },
    { title: "Opt-in signed-in users — Active installations now", value: metrics?.activeInstallations ?? "—" },
    { title: "Relay Accounts", value: metrics?.relayAccounts ?? "—" },
  ];

  return (
    <main className="mx-auto w-full max-w-6xl px-6 py-12">
      <h1 className="text-3xl font-semibold">Relay dashboard</h1>
      <p className="mt-2 text-sm text-zinc-600">Aggregate, opt-in usage diagnostics.</p>
      {error && <p className="mt-4 text-sm text-red-700">{error}</p>}
      <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <article key={card.title} className="rounded-lg border border-zinc-200 p-5 shadow-sm">
            <h2 className="text-sm font-medium text-zinc-600">{card.title}</h2>
            <p className="mt-3 text-3xl font-semibold">{card.value}</p>
          </article>
        ))}
        <article className="rounded-lg border border-zinc-200 p-5 shadow-sm">
          <h2 className="text-sm font-medium text-zinc-600">Current versions</h2>
          <ul className="mt-3 space-y-2 text-sm">
            {metrics?.versions.length ? (
              metrics.versions.map((version) => (
                <li key={`${version.platform}-${version.appVersion}`}>
                  {version.platform} {version.appVersion}: {version.activeUsers} active
                </li>
              ))
            ) : (
              <li>—</li>
            )}
          </ul>
        </article>
      </section>
    </main>
  );
}
