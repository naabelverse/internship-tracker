import type { Types } from 'mongoose';
import { Application } from '@/models/Application';

export interface CalendarEvent {
  id: string;
  applicationId: string;
  kind: 'deadline' | 'interview';
  at: string;
  company: string;
  role: string;
  status: string;
  interviewType?: string;
  mode?: string;
  outcome?: string;
}

interface DeadlineRow {
  _id: Types.ObjectId;
  at: Date;
  company: string;
  role: string;
  status: string;
}

interface InterviewRow extends DeadlineRow {
  interviewId: Types.ObjectId;
  interviewType: string;
  mode: string;
  outcome: string;
}

/**
 * Deadlines and interviews merged into one ordered stream. Both live in the same
 * collection, so a single aggregation with two facet branches beats two round
 * trips, and the match on user is the first stage of the pipeline.
 */
export async function getCalendar(
  userId: Types.ObjectId,
  from: Date,
  to: Date,
): Promise<CalendarEvent[]> {
  const window = { $gte: from, $lte: to };

  const [facet] = await Application.aggregate<{
    deadlines: DeadlineRow[];
    interviews: InterviewRow[];
  }>([
    { $match: { user: userId, archived: false } },
    {
      $facet: {
        deadlines: [
          { $match: { deadline: window } },
          { $project: { at: '$deadline', company: 1, role: 1, status: 1 } },
        ],
        interviews: [
          { $unwind: '$interviews' },
          { $match: { 'interviews.scheduledAt': window } },
          {
            $project: {
              at: '$interviews.scheduledAt',
              company: 1,
              role: 1,
              status: 1,
              interviewId: '$interviews._id',
              interviewType: '$interviews.type',
              mode: '$interviews.mode',
              outcome: '$interviews.outcome',
            },
          },
        ],
      },
    },
  ]);

  const events: CalendarEvent[] = [
    ...facet.deadlines.map((row) => ({
      id: `deadline:${row._id.toString()}`,
      applicationId: row._id.toString(),
      kind: 'deadline' as const,
      at: row.at.toISOString(),
      company: row.company,
      role: row.role,
      status: row.status,
    })),
    ...facet.interviews.map((row) => ({
      id: `interview:${row.interviewId.toString()}`,
      applicationId: row._id.toString(),
      kind: 'interview' as const,
      at: row.at.toISOString(),
      company: row.company,
      role: row.role,
      status: row.status,
      interviewType: row.interviewType,
      mode: row.mode,
      outcome: row.outcome,
    })),
  ];

  return events.sort((a, b) => a.at.localeCompare(b.at));
}
