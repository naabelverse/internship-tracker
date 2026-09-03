import { apiClient } from '@/api/client';
import type { ApiSuccessBody } from '@/types/api';
import type { Application } from '@/types/application';

/** SPEC section 5: 5 MB and pdf/doc/docx/png/jpg only. Mirrored client-side. */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

export const ALLOWED_ATTACHMENT_TYPES: Record<string, string> = {
  'application/pdf': 'PDF',
  'application/msword': 'DOC',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
  'image/png': 'PNG',
  'image/jpeg': 'JPG',
};

/**
 * Rejects a file before it is uploaded, so an oversized or wrong-typed pick fails
 * instantly instead of after a round trip. The server enforces the same rules;
 * this only saves the user the wait.
 */
export function validateAttachment(file: File): string | null {
  if (!ALLOWED_ATTACHMENT_TYPES[file.type]) {
    return 'Only PDF, DOC, DOCX, PNG and JPG files can be attached.';
  }

  if (file.size > MAX_ATTACHMENT_BYTES) {
    return 'That file is larger than the 5 MB limit.';
  }

  return null;
}

export async function uploadAttachment(applicationId: string, file: File): Promise<Application> {
  const body = new FormData();
  body.append('file', file);

  const { data } = await apiClient.post<ApiSuccessBody<{ application: Application }>>(
    `/applications/${applicationId}/attachments`,
    body,
    // Letting the browser set the boundary is why the JSON default is cleared.
    { headers: { 'Content-Type': undefined } },
  );

  return data.data.application;
}

export async function deleteAttachment(
  applicationId: string,
  attachmentId: string,
): Promise<Application> {
  const { data } = await apiClient.delete<ApiSuccessBody<{ application: Application }>>(
    `/applications/${applicationId}/attachments/${attachmentId}`,
  );

  return data.data.application;
}
