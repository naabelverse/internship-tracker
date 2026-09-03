import { Button } from '@/components/ui/Button';
import { ChevronLeftIcon, ChevronRightIcon } from '@/components/ui/icons';
import type { PaginationMeta } from '@/types/api';

interface PaginationBarProps {
  meta: PaginationMeta;
  onPageChange: (page: number) => void;
}

export function PaginationBar({ meta, onPageChange }: PaginationBarProps): JSX.Element {
  const first = meta.total === 0 ? 0 : (meta.page - 1) * meta.limit + 1;
  const last = Math.min(meta.page * meta.limit, meta.total);

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 text-sm text-content-muted"
    >
      <p aria-live="polite">
        Showing {first}–{last} of {meta.total}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          aria-label="Previous page"
          disabled={meta.page <= 1}
          onClick={() => {
            onPageChange(meta.page - 1);
          }}
        >
          <ChevronLeftIcon className="h-4 w-4" />
          Previous
        </Button>

        <span className="px-1">
          Page {meta.page} of {Math.max(meta.totalPages, 1)}
        </span>

        <Button
          variant="secondary"
          size="sm"
          aria-label="Next page"
          disabled={meta.page >= meta.totalPages}
          onClick={() => {
            onPageChange(meta.page + 1);
          }}
        >
          Next
          <ChevronRightIcon className="h-4 w-4" />
        </Button>
      </div>
    </nav>
  );
}
