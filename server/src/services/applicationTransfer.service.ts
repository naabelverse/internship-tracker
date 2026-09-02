import type { Types } from 'mongoose';
import { Application, type ApplicationDocument } from '@/models/Application';
import {
  createApplicationSchema,
  MAX_IMPORT_ROWS,
  type CreateApplicationInput,
} from '@/schemas/application.schema';
import { createApplication } from '@/services/application.service';
import { ApiError } from '@/utils/ApiError';
import { parseCsv, toCsv, type CsvCell } from '@/utils/csv';

export const EXPORT_COLUMNS = [
  'company',
  'role',
  'status',
  'priority',
  'source',
  'workMode',
  'employmentType',
  'location',
  'jobUrl',
  'companyWebsite',
  'appliedDate',
  'deadline',
  'tags',
  'notes',
  'resumeVersion',
  'stipendAmount',
  'stipendCurrency',
  'stipendPeriod',
  'contactName',
  'contactEmail',
  'archived',
  'createdAt',
] as const;

const isoDate = (value: Date | undefined): string => (value ? value.toISOString() : '');

function toExportRow(application: ApplicationDocument): Record<string, CsvCell> {
  return {
    company: application.company,
    role: application.role,
    status: application.status,
    priority: application.priority,
    source: application.source ?? '',
    workMode: application.workMode ?? '',
    employmentType: application.employmentType,
    location: application.location ?? '',
    jobUrl: application.jobUrl ?? '',
    companyWebsite: application.companyWebsite ?? '',
    appliedDate: isoDate(application.appliedDate),
    deadline: isoDate(application.deadline),
    tags: application.tags.join(';'),
    notes: application.notes ?? '',
    resumeVersion: application.resumeVersion ?? '',
    stipendAmount: application.stipend?.amount ?? '',
    stipendCurrency: application.stipend?.currency ?? '',
    stipendPeriod: application.stipend?.period ?? '',
    contactName: application.contact?.name ?? '',
    contactEmail: application.contact?.email ?? '',
    archived: application.archived,
    createdAt: isoDate(application.createdAt),
  };
}

export interface ExportResult {
  body: string;
  contentType: string;
  filename: string;
}

export async function exportApplications(
  userId: Types.ObjectId,
  format: 'csv' | 'json',
): Promise<ExportResult> {
  const applications = await Application.find({ user: userId }).sort({ createdAt: -1 });
  const stamp = new Date().toISOString().slice(0, 10);

  if (format === 'json') {
    return {
      body: JSON.stringify(
        applications.map((application) => application.toJSON()),
        null,
        2,
      ),
      contentType: 'application/json; charset=utf-8',
      filename: `applications-${stamp}.json`,
    };
  }

  return {
    body: toCsv(applications.map(toExportRow), EXPORT_COLUMNS),
    contentType: 'text/csv; charset=utf-8',
    filename: `applications-${stamp}.csv`,
  };
}

export interface ImportRowError {
  row: number;
  field?: string;
  message: string;
}

export interface ImportResult {
  imported: number;
  skipped: number;
  errors: ImportRowError[];
}

/** Reads a cell, treating blanks as absent so optional fields stay unset. */
function cell(row: Record<string, string>, key: string): string | undefined {
  const value = row[key]?.trim();
  return value ? value : undefined;
}

/**
 * Maps one CSV row onto the create schema shape. Everything arrives as a string,
 * so numbers, booleans and lists are converted before validation, which lets the
 * schema report a real reason per field rather than a blanket type error.
 */
function rowToInput(row: Record<string, string>): Record<string, unknown> {
  const input: Record<string, unknown> = {
    company: cell(row, 'company'),
    role: cell(row, 'role'),
    status: cell(row, 'status'),
    priority: cell(row, 'priority'),
    source: cell(row, 'source'),
    workMode: cell(row, 'workMode'),
    employmentType: cell(row, 'employmentType'),
    location: cell(row, 'location'),
    jobUrl: cell(row, 'jobUrl'),
    companyWebsite: cell(row, 'companyWebsite'),
    appliedDate: cell(row, 'appliedDate'),
    deadline: cell(row, 'deadline'),
    notes: cell(row, 'notes'),
    resumeVersion: cell(row, 'resumeVersion'),
  };

  for (const key of Object.keys(input)) {
    if (input[key] === undefined) delete input[key];
  }

  const tags = cell(row, 'tags');
  if (tags) {
    input.tags = tags
      .split(/[;,]/)
      .map((tag) => tag.trim())
      .filter((tag) => tag.length > 0);
  }

  const archived = cell(row, 'archived');
  if (archived) input.archived = archived.toLowerCase() === 'true';

  const amount = cell(row, 'stipendAmount');
  if (amount) {
    input.stipend = {
      amount: Number(amount),
      currency: cell(row, 'stipendCurrency') ?? 'USD',
      period: cell(row, 'stipendPeriod') ?? 'month',
    };
  }

  const contactName = cell(row, 'contactName');
  const contactEmail = cell(row, 'contactEmail');
  if (contactName || contactEmail) {
    input.contact = { name: contactName, email: contactEmail };
  }

  return input;
}

/**
 * Imports rows one at a time so a single bad row never aborts the batch, and
 * every skipped row comes back with the field and reason that rejected it.
 */
export async function importApplications(
  userId: Types.ObjectId,
  csvText: string,
): Promise<ImportResult> {
  const { rows, errors: parseErrors } = parseCsv(csvText);

  if (rows.length === 0 && parseErrors.length === 0) {
    throw ApiError.badRequest('The uploaded file contains no rows', 'EMPTY_CSV');
  }

  if (rows.length > MAX_IMPORT_ROWS) {
    throw ApiError.badRequest(
      `A single import is limited to ${String(MAX_IMPORT_ROWS)} rows`,
      'IMPORT_TOO_LARGE',
    );
  }

  const errors: ImportRowError[] = [...parseErrors];
  let imported = 0;
  let skipped = 0;

  for (const [index, row] of rows.entries()) {
    const rowNumber = index + 2;
    const parsed = createApplicationSchema.safeParse(rowToInput(row));

    if (!parsed.success) {
      skipped += 1;
      for (const issue of parsed.error.issues) {
        errors.push({
          row: rowNumber,
          field: issue.path.join('.') || undefined,
          message: issue.message,
        });
      }
      continue;
    }

    try {
      await createApplication(userId, parsed.data as CreateApplicationInput);
      imported += 1;
    } catch (error) {
      skipped += 1;
      errors.push({
        row: rowNumber,
        message: error instanceof Error ? error.message : 'Could not be saved',
      });
    }
  }

  return { imported, skipped, errors };
}
