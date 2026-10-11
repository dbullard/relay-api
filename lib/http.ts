export function publicServerError(
  tag: string,
  error: unknown,
  publicMessage = "Something went wrong. Please try again."
) {
  const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[${tag}] ${detail}`);
  return { body: { ok: false as const, error: publicMessage }, status: 500 as const };
}
