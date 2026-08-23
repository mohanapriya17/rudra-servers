import { parse as parseCsv } from "csv-parse/sync";
import * as XLSX from "xlsx";
import { RudraError } from "@rudra/errors";

export const MAX_ROWS_PER_USER = 10;

export type DataRow = Record<string, unknown>;

function asRows(value: unknown): DataRow[] {
  if (Array.isArray(value)) {
    if (value.length === 0) {
      throw new RudraError("VALIDATION_ERROR", "Data array must contain at least one row");
    }
    return value.map((row, index) => {
      if (!row || typeof row !== "object" || Array.isArray(row)) {
        throw new RudraError("VALIDATION_ERROR", `Row ${index} must be a JSON object`);
      }
      return row as DataRow;
    });
  }
  if (value && typeof value === "object") {
    return [value as DataRow];
  }
  throw new RudraError("VALIDATION_ERROR", "Data must be a JSON object or array of objects");
}

export function enforceRowLimit(rows: DataRow[], maxRows = MAX_ROWS_PER_USER): DataRow[] {
  if (rows.length > maxRows) {
    throw new RudraError(
      "RATE_LIMITED",
      `Maximum ${maxRows} rows per user request; received ${rows.length}`,
      { details: { maxRows, received: rows.length } },
    );
  }
  return rows;
}

export function parseJsonData(raw: string | unknown): DataRow[] {
  if (typeof raw !== "string") {
    return enforceRowLimit(asRows(raw));
  }
  try {
    return enforceRowLimit(asRows(JSON.parse(raw)));
  } catch (error) {
    if (error instanceof RudraError) throw error;
    throw new RudraError("VALIDATION_ERROR", "Invalid JSON data", { cause: error });
  }
}

export function parseCsvData(buffer: Buffer): DataRow[] {
  try {
    const records = parseCsv(buffer, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      relax_column_count: true,
    }) as DataRow[];
    if (!Array.isArray(records) || records.length === 0) {
      throw new RudraError("VALIDATION_ERROR", "CSV file produced no rows");
    }
    return enforceRowLimit(records);
  } catch (error) {
    if (error instanceof RudraError) throw error;
    throw new RudraError("VALIDATION_ERROR", "Failed to parse CSV data", { cause: error });
  }
}

export function parseExcelData(buffer: Buffer): DataRow[] {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new RudraError("VALIDATION_ERROR", "Excel workbook has no sheets");
    }
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      throw new RudraError("VALIDATION_ERROR", "Excel sheet missing");
    }
    const records = XLSX.utils.sheet_to_json<DataRow>(sheet, { defval: null });
    if (records.length === 0) {
      throw new RudraError("VALIDATION_ERROR", "Excel sheet produced no rows");
    }
    return enforceRowLimit(records);
  } catch (error) {
    if (error instanceof RudraError) throw error;
    throw new RudraError("VALIDATION_ERROR", "Failed to parse Excel data", { cause: error });
  }
}

export interface UploadedDataFile {
  originalname: string;
  mimetype: string;
  buffer: Buffer;
}

export function parseDataFile(file: UploadedDataFile): DataRow[] {
  const name = (file.originalname || "").toLowerCase();
  const mime = (file.mimetype || "").toLowerCase();

  if (
    name.endsWith(".json") ||
    mime.includes("json") ||
    mime === "application/octet-stream" && name.endsWith(".json")
  ) {
    return parseJsonData(file.buffer.toString("utf8"));
  }
  if (name.endsWith(".csv") || mime.includes("csv") || mime === "text/plain") {
    return parseCsvData(file.buffer);
  }
  if (
    name.endsWith(".xlsx") ||
    name.endsWith(".xls") ||
    mime.includes("spreadsheet") ||
    mime.includes("excel")
  ) {
    return parseExcelData(file.buffer);
  }

  // Try JSON then CSV as fallbacks
  try {
    return parseJsonData(file.buffer.toString("utf8"));
  } catch {
    try {
      return parseCsvData(file.buffer);
    } catch {
      throw new RudraError(
        "VALIDATION_ERROR",
        "Unsupported data file type; use .json, .csv, .xlsx, or .xls",
      );
    }
  }
}
