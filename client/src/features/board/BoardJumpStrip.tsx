import type { BoardColumnModel } from '@/features/board/boardColumns';

interface BoardJumpStripProps {
  columns: BoardColumnModel[];
  /** Scrolls the board to the column at this index. */
  onJump: (index: number) => void;
}

/**
 * Every column's name and count in one row above the board, each a button that
 * scrolls the board to it.
 *
 * At 1440 px the board shows three and a bit of its eight columns, and nothing
 * on screen said the other four existed: an overlay scrollbar (macOS, phones)
 * shows no thumb until you scroll. This row names all of them.
 *
 * It stays one row and scrolls sideways itself when it runs out of room, as on
 * a phone, rather than wrapping: three rows there would cost 120 px, a fifth of
 * the board. The padding, taken back by the negative margin, is room for the
 * focus ring, which a scroll container would otherwise clip.
 *
 * Focus stays on the button after a jump, so the board's tab order is as it was.
 */
export function BoardJumpStrip({ columns, onJump }: BoardJumpStripProps): JSX.Element {
  return (
    <nav
      aria-label="Jump to column"
      className="scrollbar-themed relative -mx-1 -mt-1 mb-2 overflow-x-auto p-1"
    >
      <ul className="flex gap-1">
        {columns.map((column) => (
          <li key={column.status} className="shrink-0">
            <button
              type="button"
              onClick={() => {
                onJump(column.index);
              }}
              className="inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border border-border bg-surface px-2.5 text-xs font-medium text-content-muted transition-colors hover:bg-surface-muted hover:text-content"
            >
              {/* A flex container drops the space from layout but keeps it in
                  the accessible name: "Saved 16 applications", not "Saved16". */}
              <span>{column.label}</span>{' '}
              <span className="tabular-nums text-content-subtle">{column.applications.length}</span>
              <span className="sr-only"> applications</span>
            </button>
          </li>
        ))}
      </ul>
    </nav>
  );
}
