import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Button } from '@/components/ui/Button';
import { FileIcon, TrashIcon, UploadIcon } from '@/components/ui/icons';
import * as attachmentsApi from '@/api/attachments';
import { getErrorMessage } from '@/api/errors';
import { commitCachedApplication } from '@/features/applications/optimisticCache';
import { queryKeys } from '@/api/queryKeys';
import { formatDate, formatFileSize } from '@/lib/formatters';
import { cn } from '@/lib/cn';
import type { Application } from '@/types/application';

/**
 * Upload dropzone plus the attachment list.
 *
 * The file is checked against the 5 MB and mimetype limits before any request is
 * made, so an obviously invalid pick fails instantly. The server enforces the
 * same rules; this only spares the user a round trip and a wasted upload.
 */
export function AttachmentsPanel({ application }: { application: Application }): JSX.Element {
  const queryClient = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [rejection, setRejection] = useState<string | null>(null);

  const commit = (saved: Application): void => {
    commitCachedApplication(queryClient, saved);
    void queryClient.invalidateQueries({ queryKey: queryKeys.applications.lists() });
  };

  const upload = useMutation({
    mutationFn: (file: File) => attachmentsApi.uploadAttachment(application.id, file),
    onSuccess: (saved) => {
      commit(saved);
      toast.success('Attachment uploaded');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'The upload did not complete'));
    },
  });

  const remove = useMutation({
    mutationFn: (attachmentId: string) =>
      attachmentsApi.deleteAttachment(application.id, attachmentId),
    onSuccess: (saved) => {
      commit(saved);
      toast.success('Attachment removed');
    },
    onError: (error) => {
      toast.error(getErrorMessage(error, 'The attachment could not be removed'));
    },
  });

  function accept(file: File | undefined): void {
    if (!file) return;

    const problem = attachmentsApi.validateAttachment(file);
    setRejection(problem);

    if (problem !== null) {
      toast.error(problem);
      return;
    }

    upload.mutate(file);
  }

  return (
    <section aria-labelledby="attachments-heading" className="space-y-3">
      <h2 id="attachments-heading" className="text-sm font-semibold text-content">
        Attachments
      </h2>

      <div
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => {
          setIsDragging(false);
        }}
        onDrop={(event) => {
          event.preventDefault();
          setIsDragging(false);
          accept(event.dataTransfer.files[0]);
        }}
        className={cn(
          'rounded-card border border-dashed px-4 py-6 text-center transition-colors',
          isDragging ? 'border-primary bg-primary/5' : 'border-border-strong bg-surface',
        )}
      >
        <UploadIcon className="mx-auto h-6 w-6 text-content-subtle" />
        <p className="mt-2 text-sm text-content-muted">
          Drop a file here, or choose one. PDF, DOC, DOCX, PNG or JPG, up to 5 MB.
        </p>

        <input
          ref={inputRef}
          type="file"
          className="sr-only"
          aria-label="Attachment file"
          accept=".pdf,.doc,.docx,.png,.jpg,.jpeg"
          onChange={(event) => {
            accept(event.target.files?.[0]);
            event.target.value = '';
          }}
        />

        <Button
          variant="secondary"
          size="sm"
          className="mt-3"
          isLoading={upload.isPending}
          loadingLabel="Uploading"
          onClick={() => {
            inputRef.current?.click();
          }}
        >
          Choose a file
        </Button>

        {rejection !== null && (
          <p role="alert" className="mt-3 text-sm text-danger">
            {rejection}
          </p>
        )}
      </div>

      {application.attachments.length === 0 ? (
        <p className="text-sm text-content-subtle">Nothing attached yet.</p>
      ) : (
        <ul className="space-y-2">
          {application.attachments.map((attachment) => (
            <li
              key={attachment.id}
              className="flex items-center gap-3 rounded-control border border-border bg-surface px-3 py-2"
            >
              <FileIcon className="h-5 w-5 shrink-0 text-content-subtle" />

              <div className="min-w-0 flex-1">
                <a
                  href={attachment.url}
                  target="_blank"
                  rel="noreferrer"
                  className="block truncate text-sm font-medium text-content hover:text-primary"
                >
                  {attachment.originalName}
                </a>
                <p className="text-xs text-content-subtle">
                  {formatFileSize(attachment.size)} · {formatDate(attachment.uploadedAt)}
                </p>
              </div>

              <button
                type="button"
                aria-label={`Remove ${attachment.originalName}`}
                disabled={remove.isPending}
                onClick={() => {
                  remove.mutate(attachment.id);
                }}
                className="rounded-control p-1.5 text-content-subtle transition-colors hover:bg-surface-muted hover:text-danger"
              >
                <TrashIcon className="h-4 w-4" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
