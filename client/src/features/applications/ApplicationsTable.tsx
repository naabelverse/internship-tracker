import { Link } from 'react-router-dom';
import { Badge } from '@/components/ui/Badge';
import { ArrowDownIcon, ArrowUpIcon, EditIcon } from '@/components/ui/icons';
import { StatusSelect } from '@/features/applications/StatusSelect';
import type { ColumnDefinition } from '@/features/applications/columns';
import { companyInitials, formatDate } from '@/lib/formatters';
import { PRIORITY_CONFIG, SOURCE_LABELS } from '@/lib/statusConfig';
import { cn } from '@/lib/cn';
import { paths } from '@/routes/paths';
import type { Application, ApplicationStatus } from '@/types/application';
import { DeadlineChip } from '@/features/applications/DeadlineChip';
import { Card } from '@/components/ui/Card';

interface ApplicationsTableProps {
  applications: Application[];
  columns: ColumnDefinition[];
  selectedIds: string[];
  sort: string;
  pendingStatusIds: string[];
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onSort: (field: string) => void;
  onStatusChange: (id: string, status: ApplicationStatus) => void;
  onEdit: (id: string) => void;
}

function cellContent(application: Application, columnId: string): JSX.Element | string {
  switch (columnId) {
    case 'role':
      return application.role;
    case 'priority':
      return (
        <span className="inline-flex items-center gap-2 text-sm">
          <span
            aria-hidden="true"
            className={cn('h-2 w-2 rounded-full', PRIORITY_CONFIG[application.priority].dot)}
          />
          {PRIORITY_CONFIG[application.priority].label}
        </span>
      );
    case 'source':
      return application.source ? SOURCE_LABELS[application.source] : '—';
    case 'location':
      return application.location ?? '—';
    case 'appliedDate':
      return formatDate(application.appliedDate);
    case 'deadline':
      return <DeadlineChip deadline={application.deadline} />;
    case 'tags':
      return (
        <span className="flex flex-wrap gap-1">
          {application.tags.length === 0 && '—'}
          {application.tags.slice(0, 3).map((tag) => (
            <Badge key={tag} className="bg-surface-muted text-content-muted">
              {tag}
            </Badge>
          ))}
        </span>
      );
    default:
      return '—';
  }
}

/** The `md`-and-up view. Below that `ApplicationCardList` renders stacked cards. */
export function ApplicationsTable({
  applications,
  columns,
  selectedIds,
  sort,
  pendingStatusIds,
  onToggle,
  onToggleAll,
  onSort,
  onStatusChange,
  onEdit,
}: ApplicationsTableProps): JSX.Element {
  const [sortField, sortDirection] = sort.split(':');
  const allSelected = applications.length > 0 && selectedIds.length === applications.length;

  /*
    `relative` on the scroll wrapper below is load-bearing, not decoration.

    An absolutely positioned element is clipped by an ancestor's `overflow` only
    when that ancestor is in its containing block chain, and a `position: static`
    box never is. Tailwind's `sr-only` is `position: absolute`, so the "Actions"
    label in the last header cell escaped this scroll container entirely: its
    containing block was the initial one, and its 1px box — sitting past the
    viewport whenever the table is wider than the wrapper — extended the
    *document* rather than the wrapper. The result was a horizontal scrollbar on
    the whole page, while `body.scrollWidth` still reported the viewport width,
    because an absolutely positioned box is out of body's flow.

    Making the wrapper positioned makes it the containing block, so
    `overflow-x: auto` finally contains what it appears to contain. Applying
    `overflow-x: clip` further up cannot fix this — those ancestors are `static`
    too, so they are equally not in the chain.
  */
  return (
    <Card padding="none" className="relative overflow-x-auto">
      <table className="w-full border-collapse text-left text-sm">
        <thead>
          <tr className="border-b border-border">
            <th scope="col" className="w-10 px-4 py-3">
              <input
                type="checkbox"
                checked={allSelected}
                onChange={onToggleAll}
                aria-label="Select all applications on this page"
                className="h-4 w-4 rounded-chip border-border-strong accent-primary"
              />
            </th>

            {columns.map((column) => (
              <th key={column.id} scope="col" className="px-4 py-3 font-medium text-content-muted">
                {column.sortBy ? (
                  <button
                    type="button"
                    onClick={() => {
                      onSort(column.sortBy ?? 'createdAt');
                    }}
                    aria-label={`Sort by ${column.label}`}
                    className="inline-flex items-center gap-1 transition-colors hover:text-content"
                  >
                    {column.label}
                    {sortField === column.sortBy &&
                      (sortDirection === 'asc' ? (
                        <ArrowUpIcon className="h-3.5 w-3.5" />
                      ) : (
                        <ArrowDownIcon className="h-3.5 w-3.5" />
                      ))}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}

            <th scope="col" className="w-12 px-4 py-3">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>

        <tbody>
          {applications.map((application) => (
            <tr key={application.id} className="border-b border-border last:border-0">
              <td className="px-4 py-3">
                <input
                  type="checkbox"
                  checked={selectedIds.includes(application.id)}
                  onChange={() => {
                    onToggle(application.id);
                  }}
                  aria-label={`Select ${application.company}`}
                  className="h-4 w-4 rounded-chip border-border-strong accent-primary"
                />
              </td>

              {columns.map((column) => (
                <td key={column.id} className="px-4 py-3 align-middle text-content">
                  {column.id === 'company' ? (
                    <Link
                      to={paths.applicationDetail(application.id)}
                      className="inline-flex items-center gap-2.5 font-medium transition-colors hover:text-primary"
                    >
                      <span
                        aria-hidden="true"
                        className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-surface-muted text-xs font-semibold text-content-muted"
                      >
                        {companyInitials(application.company)}
                      </span>
                      {application.company}
                    </Link>
                  ) : column.id === 'status' ? (
                    <StatusSelect
                      value={application.status}
                      label={`Status for ${application.company}`}
                      disabled={pendingStatusIds.includes(application.id)}
                      onChange={(status) => {
                        onStatusChange(application.id, status);
                      }}
                    />
                  ) : (
                    cellContent(application, column.id)
                  )}
                </td>
              ))}

              <td className="px-4 py-3">
                <button
                  type="button"
                  onClick={() => {
                    onEdit(application.id);
                  }}
                  aria-label={`Edit ${application.company}`}
                  className="rounded-control p-1.5 text-content-subtle transition-colors hover:bg-surface-muted hover:text-content"
                >
                  <EditIcon className="h-4 w-4" />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}
