/** Pure rules for user management. */

/**
 * A5: splits CSV text into rows of cells (RFC 4180: commas, double quotes with "" escaping,
 * CRLF or LF line ends). Blank lines are dropped; a byte-order mark is ignored.
 */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  const src = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  row.push(cell);
  rows.push(row);
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

export const IMPORT_FIELDS = ['email', 'fullName', 'rollNo', 'phone'] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Column names accepted for each field, compared without case, spaces or punctuation. */
const ALIASES: Record<ImportField, string[]> = {
  email: ['email', 'emailaddress', 'mail'],
  fullName: ['fullname', 'name', 'studentname'],
  rollNo: ['rollno', 'rollnumber', 'roll'],
  phone: ['phone', 'phonenumber', 'mobile'],
};
const REQUIRED: ImportField[] = ['email', 'fullName', 'rollNo'];
const norm = (h: string) => h.toLowerCase().replace(/[^a-z]/g, '');

/**
 * A5: maps the header row to fields. Returns the column index of each field found and the
 * required fields that are missing.
 */
export function importColumns(header: readonly string[]): {
  columns: Partial<Record<ImportField, number>>;
  missing: ImportField[];
} {
  const columns: Partial<Record<ImportField, number>> = {};
  header.forEach((h, i) => {
    const field = IMPORT_FIELDS.find((f) => ALIASES[f].includes(norm(h)));
    if (field && columns[field] === undefined) columns[field] = i;
  });
  return { columns, missing: REQUIRED.filter((f) => columns[f] === undefined) };
}
