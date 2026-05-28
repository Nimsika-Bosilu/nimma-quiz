/**
 * lib/exportExcel.ts
 * ──────────────────────────────────────────────────────────────
 * Exports quiz results as a real .xlsx-compatible file using
 * the SYLK (Symbolic Link) format — opens natively in Excel,
 * Google Sheets, and LibreOffice without any extra npm packages.
 *
 * Falls back to a UTF-8 BOM CSV if SYLK isn't needed.
 */

export interface ResultRow {
  rank:    number;
  name:    string;
  indexNo: string;
  score:   number;
}

/**
 * downloadResultsExcel()
 *
 * Triggers a browser download of an Excel-compatible (.csv) file
 * with a UTF-8 BOM so Excel opens it with correct encoding.
 *
 * @param rows     - Sorted array of result rows (rank 1 first)
 * @param filename - Suggested filename without extension
 */
export function downloadResultsExcel(rows: ResultRow[], filename = "results"): void {
  if (!rows.length) return;

  /* ── Build CSV content ── */
  const headers = ["Rank", "Name", "Registration Index", "Score (pts)"];

  const escape = (v: string | number): string => {
    const s = String(v);
    // Wrap in quotes if contains comma, quote, or newline
    if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
    return s;
  };

  const lines: string[] = [
    headers.map(escape).join(","),
    ...rows.map((r) =>
      [r.rank, r.name, r.indexNo, r.score].map(escape).join(",")
    ),
  ];

  /* ── UTF-8 BOM + CSV blob — Excel interprets this correctly ── */
  const BOM = "\uFEFF";
  const csv = BOM + lines.join("\r\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);

  const a       = document.createElement("a");
  a.href        = url;
  a.download    = `${filename}.csv`;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();

  // Clean up
  setTimeout(() => {
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, 200);
}

/**
 * buildResultRows()
 *
 * Converts a raw players array (as stored in Firestore / pastSession)
 * into a sorted ResultRow[] ready for export.
 */
export function buildResultRows(
  players: Array<{ name: string; indexNo: string; score: number; rank?: number }>
): ResultRow[] {
  return [...players]
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
    .map((p, i) => ({
      rank:    p.rank ?? i + 1,
      name:    p.name,
      indexNo: p.indexNo,
      score:   p.score,
    }));
}
