import type { SortableField } from '@/features/applications/filterParams';

export const COLUMN_STORAGE_KEY = 'internship-tracker.applications.columns';

export interface ColumnDefinition {
  id: string;
  label: string;
  /** Set when the header doubles as a sort control. */
  sortBy?: SortableField;
  /** Columns the table cannot function without, so they are not hideable. */
  locked?: boolean;
}

export const COLUMNS: ColumnDefinition[] = [
  { id: 'company', label: 'Company', sortBy: 'company', locked: true },
  { id: 'role', label: 'Role', sortBy: 'role' },
  { id: 'status', label: 'Status', sortBy: 'status', locked: true },
  { id: 'priority', label: 'Priority', sortBy: 'priority' },
  { id: 'source', label: 'Source' },
  { id: 'location', label: 'Location' },
  { id: 'appliedDate', label: 'Applied', sortBy: 'appliedDate' },
  { id: 'deadline', label: 'Deadline', sortBy: 'deadline' },
  { id: 'tags', label: 'Tags' },
];

export const DEFAULT_HIDDEN_COLUMNS = ['location', 'source'];

export function isColumnIdList(value: unknown): value is string[] {
  const known = new Set(COLUMNS.map((column) => column.id));
  return (
    Array.isArray(value) && value.every((entry) => typeof entry === 'string' && known.has(entry))
  );
}

/** Locked columns are always visible, whatever localStorage happens to hold. */
export function visibleColumns(hidden: readonly string[]): ColumnDefinition[] {
  return COLUMNS.filter((column) => column.locked === true || !hidden.includes(column.id));
}
