import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/Button';
import { Popover } from '@/components/ui/Popover';
import { TextField } from '@/components/ui/TextField';
import { CloseIcon, ColumnsIcon, FilterIcon, PlusIcon, SearchIcon } from '@/components/ui/icons';
import { COLUMNS, visibleColumns } from '@/features/applications/columns';
import { ExportMenu } from '@/features/applications/ExportMenu';
import {
  hasFiltersBeyondSearch,
  type ApplicationFilters,
} from '@/features/applications/filterParams';
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
          className="flex cursor-pointer items-center gap-2 rounded-control px-1 py-1 text-sm text-content transition-colors hover:bg-surface-muted"
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
            className="h-4 w-4 rounded-chip border-border-strong accent-primary"
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
 *
 * "Clear filters" sits right after Filters, the control it undoes, and shows only
 * for filters beyond the search text, which has its own clear button. From `xl`
 * the search field stops growing and Columns, Export and New application keep
 * to the right edge, so the button takes free space when it appears instead of
 * pushing Filters, and its open panel, to the left. The cap is 18rem up to
 * 1375px and 24rem above: showing the button needs about 156px, and a 24rem
 * field left only 60px spare at 1280 (issue #87). 18rem still fits the
 * placeholder, which needs about 271px.
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
  const searchRef = useRef<HTMLInputElement | null>(null);
  const filtersRef = useRef<HTMLButtonElement | null>(null);

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
    // `data-stable-gutter` reserves the page's scrollbar gutter while the
    // toolbar is mounted (`index.css`, issue #88).
    <div className="flex flex-wrap items-center gap-2" data-stable-gutter="">
      <div className="min-w-[12rem] flex-1 xl:max-w-[18rem] [@media(min-width:1376px)]:max-w-sm">
        {/*
          The platform's own cancel button is hidden so this one is the only
          clear control. It writes through the same debounced path as typing.
        */}
        <TextField
          ref={searchRef}
          label="Search applications"
          labelHidden
          type="search"
          placeholder="Search company, role, tags or notes"
          value={searchText}
          onChange={(event) => {
            onSearchInput(event.target.value);
          }}
          leading={<SearchIcon className="h-4 w-4 text-content-subtle" aria-hidden="true" />}
          trailing={
            searchText !== '' && (
              <button
                type="button"
                onClick={() => {
                  onSearchInput('');
                  searchRef.current?.focus();
                }}
                aria-label="Clear search"
                className="rounded-control p-1.5 text-content-subtle transition-colors hover:text-content"
              >
                <CloseIcon className="h-4 w-4" aria-hidden="true" />
              </button>
            )
          }
          className="h-9 [&::-webkit-search-cancel-button]:hidden"
        />
      </div>

      <Popover
        ref={filtersRef}
        label="Filters"
        trigger={
          <>
            <FilterIcon className="h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="rounded-full bg-primary-fill px-1.5 text-xs text-primary-fill-fg">
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
                className="h-4 w-4 rounded-chip border-border-strong accent-primary"
              />
              Show archived
            </label>
          </>
        )}
      </Popover>

      {hasFiltersBeyondSearch(filters) && (
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            // The button goes with the filters it clears, so focus moves to the
            // Filters button first rather than falling to the page body.
            filtersRef.current?.focus();
            onClearFilters();
          }}
        >
          <CloseIcon className="h-4 w-4" />
          Clear filters
        </Button>
      )}

      <Popover
        label="Columns"
        align="right"
        className="xl:ml-auto"
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
              className="flex cursor-pointer items-center gap-2 rounded-control px-1 py-1 text-sm text-content transition-colors hover:bg-surface-muted"
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
                className="h-4 w-4 rounded-chip border-border-strong accent-primary disabled:opacity-50"
              />
              {column.label}
            </label>
          ))
        }
      </Popover>

      {/*
        "Shown columns" is derived with the same `visibleColumns` the table
        renders from, off the same stored choice, so the file and the table
        cannot disagree about which columns are showing.
      */}
      <ExportMenu shownColumns={visibleColumns(hiddenColumns).map((column) => column.id)} />

      <Button size="sm" onClick={onCreate}>
        <PlusIcon className="h-4 w-4" />
        New application
      </Button>
    </div>
  );
}
