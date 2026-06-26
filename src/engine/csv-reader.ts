import { readFileSync } from 'fs';
import { resolve } from 'path';

/** Options for CSV parsing. */
export interface CsvParseOptions {
  /** Field separator character (default: ","). */
  fieldTerminator?: string | undefined;
  /** Quote character for enclosed fields (default: '"'). */
  enclosedBy?: string | undefined;
}

/**
 * Parse a CSV string into an array of rows.
 * Each row is an array of string fields.
 *
 * Handles:
 * - Quoted fields (double-quotes by default)
 * - Escaped quotes within quoted fields
 * - Newlines within quoted fields
 * - Leading/trailing whitespace on unquoted fields
 * - Custom field terminators and quote characters
 */
export function parseCsv(text: string, options: CsvParseOptions = {}): string[][] {
  const { fieldTerminator = ',', enclosedBy = '"' } = options;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  // Strip UTF-8 BOM if present
  let i = text.charCodeAt(0) === 0xFEFF ? 1 : 0;

  while (i < text.length) {
    const ch = text[i];

    if (inQuotes) {
      if (ch === enclosedBy) {
        // Check for escaped quote
        if (i + 1 < text.length && text[i + 1] === enclosedBy) {
          field += enclosedBy;
          i += 2;
          continue;
        }
        // End of quoted field
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }

    // Not in quotes
    if (ch === enclosedBy) {
      inQuotes = true;
      i++;
      continue;
    }

    if (ch === fieldTerminator) {
      row.push(field.trim());
      field = '';
      i++;
      continue;
    }

    if (ch === '\r') {
      // Skip \r in \r\n
      i++;
      continue;
    }

    if (ch === '\n') {
      row.push(field.trim());
      rows.push(row);
      row = [];
      field = '';
      i++;
      continue;
    }

    field += ch;
    i++;
  }

  // Push the last field/row (handles files without trailing newline)
  if (field || row.length > 0) {
    row.push(field.trim());
    rows.push(row);
  }

  return rows;
}

/**
 * Read a CSV file from the filesystem and return parsed rows.
 */
export function readCsvFile(source: string, options: CsvParseOptions = {}): string[][] {
  const resolvedPath = resolve(source);
  let content: string;
  try {
    content = readFileSync(resolvedPath, 'utf-8');
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      throw new Error(`CSV file not found: ${source}`);
    }
    throw new Error(`Failed to read CSV file: ${error.message}`);
  }
  return parseCsv(content, options);
}

/**
 * Fetch a CSV file from an HTTP/HTTPS URL and return parsed rows.
 */
export async function fetchCsv(url: string, options: CsvParseOptions = {}): Promise<string[][]> {
  if (!/^https?:\/\//i.test(url)) {
    throw new Error(`LOAD CSV: unsupported URL scheme. Only file paths and http(s):// URLs are supported. Got: ${url}`);
  }

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`LOAD CSV: failed to fetch "${url}" — HTTP ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  return parseCsv(text, options);
}

/**
 * Read CSV data from a source (file path or URL).
 * Returns { rows, headers } where headers is the first row if withHeaders is true.
 */
export async function loadCsv(source: string, withHeaders: boolean, options: CsvParseOptions = {}): Promise<{ rows: string[][]; headers: string[] | null }> {
  let rawRows: string[][];

  if (/^https?:\/\//i.test(source)) {
    rawRows = await fetchCsv(source, options);
  } else {
    rawRows = readCsvFile(source, options);
  }

  if (rawRows.length === 0) {
    return { rows: [], headers: null };
  }

  if (withHeaders) {
    const headers = rawRows[0]!;
    const dataRows = rawRows.slice(1);
    return { rows: dataRows, headers };
  }

  return { rows: rawRows, headers: null };
}

/**
 * Convert raw CSV rows into the format used by the engine.
 *
 * With headers: each row is a Record<string, string> mapping header → value.
 * Without headers: each row is a string[] (array of values).
 */
export function buildCsvRows(rawRows: string[][], headers: string[] | null): Array<Record<string, unknown> | string[]> {
  if (!headers) {
    // Without headers: each row is an array of strings
    return rawRows;
  }

  // With headers: each row is a map { headerName: value }
  return rawRows.map((row) => {
    const record: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      record[headers[i]!] = row[i] ?? '';
    }
    return record;
  });
}
