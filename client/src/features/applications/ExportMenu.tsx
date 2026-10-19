import { useId } from 'react';
import { Popover } from '@/components/ui/Popover';
import { DownloadIcon } from '@/components/ui/icons';
import type { ApplicationFilters } from '@/features/applications/filterParams';
import {
  useExportApplications,
  type ExportChoice,
} from '@/features/applications/useApplicationExport';

interface ExportMenuProps {
  /** The table's visible column ids, in table order, from the same state the table reads. */
  shownColumns: readonly string[];
  /** The list's current view, which the download follows (issue #83). */
  filters: ApplicationFilters;
  /** How many rows that view holds, from the list's `meta.total`; unknown while loading. */
  total?: number;
}

interface ChoiceDefinition extends ExportChoice {
  key: 'shown' | 'all';
  label: string;
  description: string;
}

/**
 * The toolbar's Export CSV control: a menu with "Shown columns", which carries
 * only the table's visible columns, and "All fields", the full export.
 *
 * SPEC section 17's manual pass ends with "export CSV", so the download has to
 * be reachable from the list itself rather than only from the API. The request
 * needs the `Authorization` header, so it goes through the axios client and is
 * saved from a blob rather than being a plain link.
 *
 * The trigger keeps the old button's label, icon and size; while a download is
 * being prepared the icon becomes a spinner of the same size, so nothing beside
 * it moves. The panel is the menus' standard 240px: right-aligned under the
 * trigger, that still fits inside a 375px screen, which a wider one did not.
 */
export function ExportMenu({ shownColumns, filters, total }: ExportMenuProps): JSX.Element {
  const idPrefix = useId();
  const exportApplications = useExportApplications();
  const isPending = exportApplications.isPending;

  // Both choices carry the rows the list shows, so each says how many.
  const rows =
    total === undefined
      ? ''
      : `${String(total)} ${total === 1 ? 'application' : 'applications'}, as listed. `;

  const choices: ChoiceDefinition[] = [
    {
      key: 'shown',
      label: `Shown columns (${String(shownColumns.length)})`,
      description: `${rows}The columns in the table. May not import again if Role is hidden.`,
      columns: shownColumns,
    },
    {
      key: 'all',
      label: 'All fields',
      description: `${rows}Every field. Can be imported again.`,
    },
  ];

  return (
    <Popover
      label="Export CSV"
      role="menu"
      align="right"
      busy={isPending}
      trigger={
        <>
          {isPending ? (
            <span
              className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent"
              aria-hidden="true"
            />
          ) : (
            <DownloadIcon className="h-4 w-4" />
          )}
          Export CSV
        </>
      }
    >
      {(close) =>
        choices.map((choice) => {
          const labelId = `${idPrefix}-${choice.key}-label`;
          const descriptionId = `${idPrefix}-${choice.key}-description`;

          return (
            <button
              key={choice.key}
              type="button"
              role="menuitem"
              tabIndex={-1}
              aria-labelledby={labelId}
              aria-describedby={descriptionId}
              onClick={() => {
                close();
                // One download at a time; a second pick while the first is
                // still being prepared is ignored rather than queued.
                if (!isPending) exportApplications.mutate({ filters, columns: choice.columns });
              }}
              className="flex w-full flex-col items-start gap-0.5 rounded-control px-2 py-1.5 text-left transition-colors hover:bg-surface-muted focus:bg-surface-muted"
            >
              <span id={labelId} className="text-sm font-medium text-content">
                {choice.label}
              </span>
              <span id={descriptionId} className="text-xs text-content-muted">
                {choice.description}
              </span>
            </button>
          );
        })
      }
    </Popover>
  );
}
