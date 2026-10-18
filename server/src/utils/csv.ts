import Papa from 'papaparse';

export interface CsvRowError {
  row: number;
  message: string;
}

export interface CsvParseResult {
  rows: Record<string, string>[];
  errors: CsvRowError[];
}

export type CsvCell = string | number | boolean | null | undefined;

/**
 * A cell a spreadsheet would run as a formula: one starting with `=`, `+`, `-`,
 * `@`, a tab or a carriage return. A run of apostrophes before the trigger counts
 * too, which is what keeps the guard reversible for a value that already began
 * with one (issue #82).
 */
const FORMULA_LIKE = /^'*[=+\-@\t\r]/;

/** Prefixes one apostrophe so a spreadsheet reads the cell as text. */
const escapeFormula = (value: string): string => (FORMULA_LIKE.test(value) ? `'${value}` : value);

/** Removes exactly the apostrophe `escapeFormula` adds, so an export imports back unchanged. */
const unescapeFormula = (value: string): string =>
  value.startsWith("'") && FORMULA_LIKE.test(value) ? value.slice(1) : value;

/**
 * Serialises rows in a fixed column order so the export header is stable. Text
 * cells are formula-escaped; numbers and booleans are written as they are.
 */
export function toCsv(rows: Record<string, CsvCell>[], columns: readonly string[]): string {
  return Papa.unparse({
    fields: [...columns],
    data: rows.map((row) =>
      columns.map((column) => {
        const value = row[column] ?? '';
        return typeof value === 'string' ? escapeFormula(value) : value;
      }),
    ),
  });
}

/**
 * Parses an uploaded CSV. Row numbers are 1-based and count the header, so they
 * match what the user sees in a spreadsheet. The formula guard `toCsv` adds is
 * removed from every cell.
 */
export function parseCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
    transform: unescapeFormula,
  });

  return {
    rows: parsed.data,
    errors: parsed.errors.map((error) => ({
      row: (error.row ?? 0) + 2,
      message: error.message,
    })),
  };
}
