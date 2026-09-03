import { apiClient } from '@/api/client';
import type { ApiSuccessBody } from '@/types/api';
import type { Application, InterviewMode, InterviewType } from '@/types/application';

export interface InterviewPayload {
  type: InterviewType;
  scheduledAt: string;
  mode: InterviewMode;
  durationMins?: number;
  interviewer?: string;
  round?: number;
  link?: string;
  prepNotes?: string;
}

export async function createInterview(
  applicationId: string,
  payload: InterviewPayload,
): Promise<Application> {
  const { data } = await apiClient.post<ApiSuccessBody<{ application: Application }>>(
    `/applications/${applicationId}/interviews`,
    payload,
  );

  return data.data.application;
}

export async function deleteInterview(
  applicationId: string,
  interviewId: string,
): Promise<Application> {
  const { data } = await apiClient.delete<ApiSuccessBody<{ application: Application }>>(
    `/applications/${applicationId}/interviews/${interviewId}`,
  );

  return data.data.application;
}
