import {
  useDraggable,
  type DraggableAttributes,
  type DraggableSyntheticListeners,
} from '@dnd-kit/core';
import { Badge } from '@/components/ui/Badge';
import { GripIcon } from '@/components/ui/icons';
import { DeadlineChip } from '@/features/applications/DeadlineChip';
import { companyInitials, toDate } from '@/lib/formatters';
import { PRIORITY_CONFIG, STATUS_CONFIG } from '@/lib/statusConfig';
import { cn } from '@/lib/cn';
import type { Application, ApplicationStatus } from '@/types/application';
import { cardSurface } from '@/components/ui/Card';

/** What `onDragEnd` reads back off the card that was picked up. */
export interface CardDragData {
  /** The column the card was rendered in, so a drop onto it is a no-op. */
  status: ApplicationStatus;
  /** The version the card was rendered with, sent so a stale drag gets a 409. */
  version: number;
  company: string;
}

interface BoardCardFaceProps {
  application: Application;
  /** Opens the application. Left out on the drag preview, whose buttons do nothing. */
  onOpen?: (id: string) => void;
  /** The Move button's drag wiring. Left out on the drag preview. */
  handle?: { listeners: DraggableSyntheticListeners; attributes: DraggableAttributes };
}

/**
 * What a card shows, shared by the card in its column and the copy that follows
 * the pointer during a drag (`BoardDragLayer`), so the two cannot drift apart.
 * Without `handle` and `onOpen` the buttons are inert and out of the tab order.
 */
export function BoardCardFace({ application, onOpen, handle }: BoardCardFaceProps): JSX.Element {
  const hasDeadline = toDate(application.deadline) !== null;
  const tags = application.tags.slice(0, 2);

  return (
    <>
      <div className="flex items-start gap-2.5">
        <span
          aria-hidden="true"
          className="grid h-8 w-8 shrink-0 place-items-center rounded-control bg-surface-muted text-xs font-semibold text-content-muted"
        >
          {companyInitials(application.company)}
        </span>

        <div className="min-w-0 flex-1">
          <button
            type="button"
            tabIndex={onOpen ? undefined : -1}
            onClick={() => {
              onOpen?.(application.id);
            }}
            className="block w-full truncate text-left text-sm font-medium text-content transition-colors hover:text-primary"
          >
            {application.company}
          </button>
          <p className="truncate text-xs text-content-muted">{application.role}</p>
        </div>

        <span
          aria-hidden="true"
          title={`${PRIORITY_CONFIG[application.priority].label} priority`}
          className={cn(
            'mt-1.5 h-2 w-2 shrink-0 rounded-full',
            PRIORITY_CONFIG[application.priority].dot,
          )}
        />
      </div>

      {/*
        No deadline means no chip rather than DeadlineChip's bare "—", which only
        reads as "none" under the table's Deadline header. With no tags either,
        the row goes too, so the card keeps the same padding as its neighbours.
      */}
      {(hasDeadline || tags.length > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {hasDeadline && <DeadlineChip deadline={application.deadline} />}
          {tags.map((tag) => (
            <Badge key={tag} className="bg-surface-muted text-content-muted">
              {tag}
            </Badge>
          ))}
        </div>
      )}

      {/*
        A real button carries the drag listeners so the keyboard sensor has
        something focusable to activate: Space picks the card up, the arrow keys
        step it between columns, Space drops it. `touch-none` keeps a finger on
        it from being taken for a pan: with `touch-action: auto` the browser
        claimed the touch and cancelled the pointer stream before the sensor's
        4px, so on a phone it never started a drag (issue #95).
      */}
      <button
        type="button"
        tabIndex={handle ? undefined : -1}
        {...handle?.listeners}
        {...handle?.attributes}
        aria-label={`Move ${application.company} from ${STATUS_CONFIG[application.status].label}`}
        className="mt-2.5 flex w-full cursor-grab touch-none items-center justify-center gap-1 rounded-control border border-border px-2 py-1 text-xs text-content-subtle transition-colors hover:bg-surface-muted hover:text-content"
      >
        {/* The only part of the card that drags, so it carries the grip mark. */}
        <GripIcon className="h-3.5 w-3.5 shrink-0" />
        Move
      </button>
    </>
  );
}

interface BoardCardProps {
  application: Application;
  cardIndex: number;
  onOpen: (id: string) => void;
}

export function BoardCard({ application, cardIndex, onOpen }: BoardCardProps): JSX.Element {
  const data: CardDragData = {
    status: application.status,
    version: application.version,
    company: application.company,
  };

  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: application.id,
    data,
  });

  return (
    // Mid-drag the card stays put and goes transparent, leaving the gap it
    // always left, while `BoardDragLayer` draws the copy under the pointer. The
    // card itself used to be the thing that moved, and the column's scrolling
    // list clipped it the moment it left that column.
    <li
      ref={setNodeRef}
      data-card-id={application.id}
      data-card-index={cardIndex}
      className={cn(cardSurface, 'p-3', isDragging && 'opacity-0')}
    >
      <BoardCardFace application={application} onOpen={onOpen} handle={{ listeners, attributes }} />
    </li>
  );
}
