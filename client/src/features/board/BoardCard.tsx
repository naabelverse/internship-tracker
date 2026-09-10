import { useDraggable } from '@dnd-kit/core';
import { CSS } from '@dnd-kit/utilities';
import { Badge } from '@/components/ui/Badge';
import { DeadlineChip } from '@/features/applications/DeadlineChip';
import { companyInitials } from '@/lib/formatters';
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

  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: application.id,
    data,
  });

  return (
    <li
      ref={setNodeRef}
      data-card-id={application.id}
      data-card-index={cardIndex}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(cardSurface, 'p-3', isDragging && 'opacity-60 ring-2 ring-primary')}
    >
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
            onClick={() => {
              onOpen(application.id);
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

      <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
        <DeadlineChip deadline={application.deadline} />
        {application.tags.slice(0, 2).map((tag) => (
          <Badge key={tag} className="bg-surface-muted text-content-muted">
            {tag}
          </Badge>
        ))}
      </div>

      {/*
        A real button carries the drag listeners so the keyboard sensor has
        something focusable to activate: Space picks the card up, the arrow keys
        step it between columns, Space drops it.
      */}
      <button
        type="button"
        {...listeners}
        {...attributes}
        aria-label={`Move ${application.company} from ${STATUS_CONFIG[application.status].label}`}
        className="mt-2.5 w-full cursor-grab rounded-control border border-border px-2 py-1 text-xs text-content-subtle transition-colors hover:bg-surface-muted hover:text-content"
      >
        Move
      </button>
    </li>
  );
}
