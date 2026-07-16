"use client";

import { FormEvent, useState } from "react";

export default function DashboardLoginPage() {
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    setMessage(null);

    try {
      const response = await fetch("/api/auth/magic-link", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, redirectTarget: "dashboard" }),
      });
      const result = await response.json();

      if (!response.ok) {
        setError(result.error ?? "Unable to send a sign-in link.");
        return;
      }

      setMessage("Check your email for a sign-in link.");
    } catch {
      setError("Unable to send a sign-in link.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-md items-center px-6">
      <form onSubmit={submit} className="w-full space-y-5 rounded-lg border border-zinc-200 p-6 shadow-sm">
        <div>
          <h1 className="text-2xl font-semibold">Relay dashboard</h1>
          <p className="mt-2 text-sm text-zinc-600">Sign in with an approved email address.</p>
        </div>
        <label className="block text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          className="w-full rounded border border-zinc-300 px-3 py-2"
          id="email"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
          autoComplete="email"
        />
        <button
          className="w-full rounded bg-zinc-900 px-4 py-2 text-white disabled:opacity-60"
          type="submit"
          disabled={isSubmitting}
        >
          {isSubmitting ? "Sending…" : "Send sign-in link"}
        </button>
        {message && <p className="text-sm text-green-700">{message}</p>}
        {error && <p className="text-sm text-red-700">{error}</p>}
      </form>
    </main>
  );
}
