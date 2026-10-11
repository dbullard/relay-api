export type TxClient = { query(text: string, params?: unknown[]): Promise<{ rows: { email?: string }[] }> };

export async function deleteAccountData(client: TxClient, userId: string): Promise<void> {
  const found = await client.query("select email from users where id = $1", [userId]);
  if (found.rows.length === 0) return;
  const email = String(found.rows[0].email).toLowerCase();

  await client.query("delete from relay_user_presence where user_id = $1", [userId]);
  await client.query("delete from sessions where user_id = $1", [userId]);
  await client.query("delete from license_activations where user_id = $1::text", [userId]);
  await client.query("delete from licenses where user_id = $1", [userId]);
  await client.query("delete from subscriptions where user_id = $1", [userId]);
  await client.query("delete from magic_links where lower(email) = $1", [email]);
  await client.query("delete from users where id = $1", [userId]);
}
