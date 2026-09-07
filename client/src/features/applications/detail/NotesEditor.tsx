import { useEffect, useMemo, useRef, useState } from 'react';
import { TextArea } from '@/components/ui/TextArea';
import { useDebouncedValue } from '@/hooks/useDebouncedValue';
import { renderMarkdown } from '@/lib/markdown';
import { cn } from '@/lib/cn';
import { MAX_NOTES_LENGTH } from '@/types/application';

interface NotesEditorProps {
  /** The notes as the server last confirmed them. */
  savedNotes: string;
  isSaving: boolean;
  onSave: (notes: string) => void;
}

/**
 * Markdown notes with a preview and a one-second autosave.
 *
 * "Has anything changed?" is answered by comparing the debounced draft against
 * `lastSavedRef`, which holds the exact text the server last acknowledged — not
 * against a dirty flag. That distinction matters three ways: typing a character
 * and deleting it again returns to the saved text and correctly saves nothing;
 * the write that lands in `savedNotes` on success re-syncs the ref, so the
 * component does not immediately try to save the value it just saved; and a
 * refetch that brings in someone else's edit becomes the new baseline instead of
 * looking like a local change.
 */
export function NotesEditor({ savedNotes, isSaving, onSave }: NotesEditorProps): JSX.Element {
  const [draft, setDraft] = useState(savedNotes);
  const [showPreview, setShowPreview] = useState(false);
  const lastSavedRef = useRef(savedNotes);
  const debouncedDraft = useDebouncedValue(draft, 1000);

  useEffect(() => {
    lastSavedRef.current = savedNotes;
    setDraft((current) => (current === '' && savedNotes !== '' ? savedNotes : current));
  }, [savedNotes]);

  useEffect(() => {
    if (debouncedDraft === lastSavedRef.current) return;
    if (debouncedDraft.length > MAX_NOTES_LENGTH) return;

    lastSavedRef.current = debouncedDraft;
    onSave(debouncedDraft);
  }, [debouncedDraft, onSave]);

  const preview = useMemo(() => renderMarkdown(draft), [draft]);
  const isDirty = draft !== lastSavedRef.current;

  return (
    <section aria-labelledby="notes-heading" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="notes-heading" className="text-sm font-semibold text-content">
          Notes
        </h2>

        <div className="flex items-center gap-3">
          <p className="text-xs text-content-subtle" role="status" aria-live="polite">
            {isSaving ? 'Saving…' : isDirty ? 'Unsaved changes' : 'Saved'}
          </p>

          <div
            role="tablist"
            aria-label="Notes view"
            className="flex rounded-control border border-border p-0.5"
          >
            {[
              { id: 'write', label: 'Write', active: !showPreview },
              { id: 'preview', label: 'Preview', active: showPreview },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={tab.active}
                onClick={() => {
                  setShowPreview(tab.id === 'preview');
                }}
                className={cn(
                  'rounded-[0.4rem] px-2.5 py-1 text-xs font-medium',
                  tab.active ? 'bg-primary-fill text-primary-fill-fg' : 'text-content-muted',
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {showPreview ? (
        <div
          data-testid="notes-preview"
          className="prose-sm min-h-[10rem] rounded-control border border-border bg-surface px-3 py-2 text-sm text-content [&_a]:text-primary [&_a]:underline [&_code]:rounded [&_code]:bg-surface-muted [&_code]:px-1 [&_li]:ml-4 [&_li]:list-disc"
          dangerouslySetInnerHTML={{ __html: preview }}
        />
      ) : (
        <TextArea
          label="Notes"
          labelHidden
          rows={8}
          value={draft}
          maxLength={MAX_NOTES_LENGTH}
          placeholder="What happened, who you spoke to, what to prepare next…"
          onChange={(event) => {
            setDraft(event.target.value);
          }}
        />
      )}
    </section>
  );
}
