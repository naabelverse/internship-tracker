/** The merged deadline and interview stream `GET /calendar` returns. */
export interface CalendarEvent {
  /** `deadline:<applicationId>` or `interview:<interviewId>`, unique per event. */
  id: string;
  applicationId: string;
  kind: 'deadline' | 'interview';
  /** ISO instant. */
  at: string;
  company: string;
  role: string;
  status: string;
  interviewType?: string;
  mode?: string;
  outcome?: string;
}
