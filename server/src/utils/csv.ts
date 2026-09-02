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

/** Serialises rows in a fixed column order so the export header is stable. */
export function toCsv(rows: Record<string, CsvCell>[], columns: readonly string[]): string {
  return Papa.unparse({
    fields: [...columns],
    data: rows.map((row) => columns.map((column) => row[column] ?? '')),
  });
}

/**
 * Parses an uploaded CSV. Row numbers are 1-based and count the header, so they
 * match what the user sees in a spreadsheet.
 */
export function parseCsv(text: string): CsvParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.trim(), {
    header: true,
    skipEmptyLines: 'greedy',
    transformHeader: (header) => header.trim(),
  });

  return {
    rows: parsed.data,
    errors: parsed.errors.map((error) => ({
      row: (error.row ?? 0) + 2,
      message: error.message,
    })),
  };
}
