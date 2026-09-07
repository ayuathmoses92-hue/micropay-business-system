export async function nextNumber(client, type) {
  const r = await client.query(
    "UPDATE document_sequences SET next_number=next_number+1 WHERE document_type=$1 RETURNING next_number-1 AS n",
    [type]
  );
  const n = r.rows[0].n;
  return `${type}-2026-${String(n).padStart(4, "0")}`;
}
