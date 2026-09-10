export async function nextNumber(client, type) {
  const year = new Date().getFullYear();

  const r = await client.query(
    `UPDATE document_sequences
     SET next_number = CASE
       WHEN sequence_year = $2 THEN next_number + 1
       ELSE 2
     END,
     sequence_year = $2
     WHERE document_type = $1
     RETURNING next_number - 1 AS n`,
    [type, year]
  );

  if (r.rowCount === 0) {
    throw new Error(`Document sequence not configured for type: ${type}`);
  }

  const n = r.rows[0].n;
  return `${type}-${year}-${String(n).padStart(4, "0")}`;
}
