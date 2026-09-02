import type { Types } from 'mongoose';
import { Application, type ApplicationDocument } from '@/models/Application';
import type { CreateInterviewInput, UpdateInterviewInput } from '@/schemas/application.schema';
import { computeNextActionDate } from '@/services/application.service';
import { ApiError } from '@/utils/ApiError';

async function loadOwned(userId: Types.ObjectId, id: string): Promise<ApplicationDocument> {
  const application = await Application.findOne({ _id: id, user: userId });

  if (!application) {
    throw ApiError.notFound('Application not found', 'APPLICATION_NOT_FOUND');
  }

  return application;
}

function requireInterviewIndex(application: ApplicationDocument, interviewId: string): number {
  const index = application.interviews.findIndex(
    (interview) => interview._id.toString() === interviewId,
  );

  if (index === -1) {
    throw ApiError.notFound('Interview not found', 'INTERVIEW_NOT_FOUND');
  }

  return index;
}

export async function addInterview(
  userId: Types.ObjectId,
  applicationId: string,
  input: CreateInterviewInput,
): Promise<ApplicationDocument> {
  const application = await loadOwned(userId, applicationId);

  application.interviews.push({ outcome: 'pending', ...input });
  application.set('nextActionDate', computeNextActionDate(application));
  await application.save();

  return application;
}

export async function updateInterview(
  userId: Types.ObjectId,
  applicationId: string,
  interviewId: string,
  input: UpdateInterviewInput,
): Promise<ApplicationDocument> {
  const application = await loadOwned(userId, applicationId);
  const index = requireInterviewIndex(application, interviewId);

  application.interviews[index].set(input);
  application.set('nextActionDate', computeNextActionDate(application));
  await application.save();

  return application;
}

export async function removeInterview(
  userId: Types.ObjectId,
  applicationId: string,
  interviewId: string,
): Promise<ApplicationDocument> {
  const application = await loadOwned(userId, applicationId);
  const index = requireInterviewIndex(application, interviewId);

  application.interviews.splice(index, 1);
  application.set('nextActionDate', computeNextActionDate(application));
  await application.save();

  return application;
}
