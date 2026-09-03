import { STATUS_CONFIG } from '@/lib/statusConfig';
import {
  APPLICATION_STATUSES,
  type Application,
  type ApplicationStatus,
} from '@/types/application';

/** The server caps `limit` at 100, so that is what one board page can hold. */
export const BOARD_LIMIT = 100;

export interface BoardColumnModel {
  status: ApplicationStatus;
  label: string;
  /** Position in the board; the keyboard sensor steps through this, not pixels. */
  index: number;
  applications: Application[];
}

/**
 * One column per status, in the order SPEC section 4 declares them, which reads
 * left to right as a funnel. Colour and label come from `STATUS_CONFIG`, so the
 * board, the table and the timeline cannot drift apart.
 */
export function buildColumns(applications: Application[]): BoardColumnModel[] {
  return APPLICATION_STATUSES.map((status, index) => ({
    status,
    label: STATUS_CONFIG[status].label,
    index,
    applications: applications.filter((application) => application.status === status),
  }));
}
