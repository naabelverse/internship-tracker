import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { TextField } from '@/components/ui/TextField';
import { ColumnsIcon, FilterIcon, PlusIcon, SearchIcon } from '@/components/ui/icons';
import { COLUMNS } from '@/features/applications/columns';
import { hasActiveFilters, type ApplicationFilters } from '@/features/applications/filterParams';
import { STATUS_CONFIG, SOURCE_LABELS, PRIORITY_CONFIG } from '@/lib/statusConfig';
import { APPLICATION_STATUSES, PRIORITIES, SOURCES } from '@/types/application';

interface ApplicationsToolbarProps {
  filters: ApplicationFilters;
  hiddenColumns: string[];
  onFiltersChange: (patch: Partial<ApplicationFilters>, options?: { replace?: boolean }) => void;
  onClearFilters: () => void;
  onHiddenColumnsChange: (hidden: string[]) => void;
  onCreate: () => void;
}

interface CheckboxFilterProps<T extends string> {
  legend: string;
  values: readonly T[];
  selected: readonly T[];
  labelOf: (value: T) => string;
  onChange: (next: T[]) => void;
}

function CheckboxFilter<T extends string>({
  legend,
  values,
  selected,
  labelOf,
  onChange,
}: CheckboxFilterProps<T>): JSX.Element {
  return (
    <fieldset className="mb-3 last:mb-0">
      <legend className="mb-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-content-subtle">
        {legend}
      </legend>

      {values.map((value) => (
        <label
          key={value}
          className="flex cursor-pointer items-center gap-2 rounded-control px-1 py-1 text-sm text-content hover:bg-surface-muted"
        >
          <input
            type="checkbox"
            checked={selected.includes(value)}
            onChange={() => {
              onChange(
                selected.includes(value)
                  ? selected.filter((entry) => entry !== value)
                  : [...selected, value],
              );
            }}
            className="h-4 w-4 rounded border-border-strong accent-[rgb(var(--color-primary))]"
          />
          {labelOf(value)}
        </label>
      ))}
    </fieldset>
  );
}

/**
 * Search, filters, column visibility and the create button.
 *
 * The search box is the one piece of list state with a local copy: the input has
 * to stay responsive on every keystroke, so it holds its own text and a 300 ms
 * timer writes into the URL.
 *
 * The timer is started by the change handler and cancelled whenever the URL
 * changes from elsewhere, rather than derived from the debounced value with an
 * effect. A pending write is then always the user's own typing and nothing else:
 * with the effect form, clearing the filters re-seeded the input and re-ran the
 * write in the same commit, where the debounced value was still the old term, and
 * the search the user had just cleared was written straight back into the URL.
 */
export function ApplicationsToolbar({
  filters,
  hiddenColumns,
  onFiltersChange,
  onClearFilters,
  onHiddenColumnsChange,
  onCreate,
}: ApplicationsToolbarProps): JSX.Element {
  const [searchText, setSearchText] = useState(filters.search);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const cancelPendingSearch = (): void => {
    if (timerRef.current !== null) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  // A filter cleared or a link opened elsewhere re-seeds the input and drops any
  // write the user's earlier keystrokes had queued.
  useEffect(() => {
    setSearchText(filters.search);
    cancelPendingSearch();
  }, [filters.search]);

  useEffect(() => cancelPendingSearch, []);

  const onSearchInput = (value: string): void => {
    setSearchText(value);
    cancelPendingSearch();

    timerRef.current = setTimeout(() => {
      onFiltersChange({ search: value }, { replace: true });
    }, 300);
  };

  const activeFilterCount = filters.status.length + filters.source.length + filters.priority.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative min-w-[12rem] flex-1">
        <SearchIcon
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle"
          aria-hidden="true"
        />
        <TextField
          label="Search applications"
          labelHidden
          type="search"
          placeholder="Search company, role or notes"
          value={searchText}
          onChange={(event) => {
            onSearchInput(event.target.value);
          }}
          className="h-9 pl-9"
        />
      </div>

      <Popover
        label="Filters"
        trigger={
          <>
            <FilterIcon className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary px-1.5 text-xs text-primary-fg">
                {activeFilterCount}
              </span>
            )}
          </>
        }
      >
        {() => (
          <>
            <CheckboxFilter
              legend="Status"
              values={APPLICATION_STATUSES}
              selected={filters.status}
              labelOf={(status) => STATUS_CONFIG[status].label}
              onChange={(status) => {
                onFiltersChange({ status });
              }}
            />
            <CheckboxFilter
              legend="Priority"
              values={PRIORITIES}
              selected={filters.priority}
              labelOf={(priority) => PRIORITY_CONFIG[priority].label}
              onChange={(priority) => {
                onFiltersChange({ priority });
              }}
            />
            <CheckboxFilter
              legend="Source"
              values={SOURCES}
              selected={filters.source}
              labelOf={(source) => SOURCE_LABELS[source]}
              onChange={(source) => {
                onFiltersChange({ source });
              }}
            />
            <label className="flex cursor-pointer items-center gap-2 border-t border-border px-1 pt-3 text-sm text-content">
              <input
                type="checkbox"
                checked={filters.archived}
                onChange={(event) => {
                  onFiltersChange({ archived: event.target.checked });
                }}
                className="h-4 w-4 rounded border-border-strong accent-[rgb(var(--color-primary))]"
              />
              Show archived
            </label>
          </>
        )}
      </Popover>

      <Popover
        label="Columns"
        align="right"
        trigger={
          <>
            <ColumnsIcon className="h-4 w-4" />
            Columns
          </>
        }
      >
        {() =>
          COLUMNS.map((column) => (
            <label
              key={column.id}
              className="flex cursor-pointer items-center gap-2 rounded-control px-1 py-1 text-sm text-content hover:bg-surface-muted"
            >
              <input
                type="checkbox"
                checked={column.locked === true || !hiddenColumns.includes(column.id)}
                disabled={column.locked === true}
                onChange={() => {
                  onHiddenColumnsChange(
                    hiddenColumns.includes(column.id)
                      ? hiddenColumns.filter((entry) => entry !== column.id)
                      : [...hiddenColumns, column.id],
                  );
                }}
                className="h-4 w-4 rounded border-border-strong accent-[rgb(var(--color-primary))] disabled:opacity-50"
              />
              {column.label}
            </label>
          ))
        }
      </Popover>

      {hasActiveFilters(filters) && (
        <Button variant="ghost" size="sm" onClick={onClearFilters}>
          Clear filters
        </Button>
      )}

      <Button size="sm" onClick={onCreate}>
        <PlusIcon className="h-4 w-4" />
        New application
      </Button>
    </div>
  );
}
