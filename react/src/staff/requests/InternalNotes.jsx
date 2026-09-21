import { useEffect, useRef, useState } from "react";
import {
  ContentCard,
  SectionHeading,
} from "../../components/ui/RequestPresentation.jsx";

const maximum = 4000;
function bodyError(body) {
  if (!body.trim()) return "Enter an internal note.";
  if (body.length > maximum)
    return "Internal notes must be 4,000 characters or fewer.";
  if (
    /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(
      body,
    )
  )
    return "Remove unsupported control characters from the note.";
  return "";
}

/** A new request or authorization context cannot render an old stream or draft, even for one frame. */
export default function InternalNotes(props) {
  return (
    <NotesStream
      key={`${props.id}:${Boolean(props.canRead)}:${Boolean(props.canCreate)}`}
      {...props}
    />
  );
}

function NotesStream({ repository, id, canRead, canCreate, onAccessFailure }) {
  const [items, setItems] = useState([]),
    [cursor, setCursor] = useState(null),
    [loading, setLoading] = useState(Boolean(canRead)),
    [loaded, setLoaded] = useState(false),
    [denied, setDenied] = useState(false),
    [createDenied, setCreateDenied] = useState(false),
    [draft, setDraft] = useState(""),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [pending, setPending] = useState(false);
  const lifecycle = useRef(null),
    submitting = useRef(false),
    reading = useRef(false),
    submission = useRef(null),
    textarea = useRef(null),
    firstNewNote = useRef(null);
  const accessFailure = useRef(onAccessFailure);
  accessFailure.current = onAccessFailure;
  async function failure(problem, signal, creating = false) {
    if (signal.aborted) return;
    if ([401, 403, 404].includes(problem?.status)) {
      setDraft("");
      setNotice("");
      submission.current = null;
      if (creating && problem.status === 403) setCreateDenied(true);
      else {
        setDenied(true);
        setItems([]);
        setCursor(null);
      }
      await accessFailure.current?.(problem);
    } else
      setError(
        creating
          ? "The note could not be added. Your draft is retained; try again."
          : "Internal notes could not be loaded. Please try again.",
      );
  }
  async function readPage(before, signal) {
    if (!canRead || reading.current || signal.aborted) return;
    reading.current = true;
    setLoading(true);
    setError("");
    if (!before) {
      setItems([]);
      setLoaded(false);
    }
    try {
      const data = await repository.notes(id, before, signal);
      if (signal.aborted) return;
      setItems((current) => {
        const rows = before ? [...current, ...data.items] : data.items;
        return [...new Map(rows.map((row) => [row.id, row])).values()];
      });
      setCursor(data.nextCursor);
      setLoaded(true);
      if (before) {
        firstNewNote.current = data.items[0]?.id;
        setNotice("Older notes loaded.");
      }
    } catch (problem) {
      await failure(problem, signal);
    } finally {
      if (!signal.aborted) {
        reading.current = false;
        setLoading(false);
      }
    }
  }
  useEffect(() => {
    const controller = new AbortController();
    lifecycle.current = controller;
    reading.current = false;
    if (canRead) void readPage(null, controller.signal);
    return () => controller.abort();
  }, [repository, id, canRead]);
  useEffect(() => {
    if (firstNewNote.current) {
      document.getElementById(`note-${firstNewNote.current}`)?.focus();
      firstNewNote.current = null;
    }
  }, [items]);
  useEffect(() => {
    if (!pending && notice === "Internal note added.")
      textarea.current?.focus();
  }, [pending, notice]);
  async function add(event) {
    event.preventDefault();
    if (
      submitting.current ||
      reading.current ||
      !canRead ||
      !canCreate ||
      denied ||
      createDenied
    )
      return;
    const validation = bodyError(draft);
    if (validation) {
      setError(validation);
      textarea.current?.focus();
      return;
    }
    submitting.current = true;
    setPending(true);
    setError("");
    setNotice("");
    const signal = lifecycle.current.signal;
    try {
      if (!submission.current || submission.current.body !== draft)
        submission.current = { body: draft, key: crypto.randomUUID() };
      const note = await repository.createNote(
        id,
        draft,
        submission.current.key,
        signal,
      );
      if (signal.aborted) return;
      setItems((current) =>
        [note, ...current.filter((item) => item.id !== note.id)].sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        ),
      );
      setDraft("");
      submission.current = null;
      setNotice("Internal note added.");
      textarea.current?.focus();
    } catch (problem) {
      await failure(problem, signal, true);
    } finally {
      if (!signal.aborted) {
        submitting.current = false;
        setPending(false);
      }
    }
  }
  return (
    <ContentCard className="request-notes">
      <SectionHeading icon="chat-left-text">Internal Notes</SectionHeading>
      {!canRead || denied ? (
        <>
          <p>
            <i className="bi bi-lock" aria-hidden="true" />{" "}
            <strong>Protected</strong>
          </p>
          <p>You don't have permission to view internal notes.</p>
        </>
      ) : (
        <>
          <p className="text-body-secondary">
            Internal notes are visible only to authorized staff. Avoid entering
            unnecessary sensitive information.
          </p>
          {loading && <p role="status">Loading internal notes…</p>}
          {error && (
            <p role="alert" id="internal-note-error">
              {error}
            </p>
          )}
          <p role="status" className="request-notes-notice">
            {pending ? "Adding internal note…" : notice}
          </p>
          {loaded && !items.length && <p>No internal notes have been added.</p>}
          <ol
            className="request-notes-list"
            aria-label="Internal notes, newest first"
          >
            {items.map((note) => (
              <li key={note.id} id={`note-${note.id}`} tabIndex="-1">
                <div className="request-note-attribution">
                  <strong>{note.author.displayName}</strong>
                  <time dateTime={note.createdAt}>
                    {new Date(note.createdAt).toLocaleString()}
                  </time>
                </div>
                <p className="request-note-body">{note.body}</p>
              </li>
            ))}
          </ol>
          <div className="request-notes-controls">
            {cursor && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || pending}
                onClick={() => readPage(cursor, lifecycle.current.signal)}
              >
                Load older notes
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || pending}
              onClick={() => readPage(null, lifecycle.current.signal)}
            >
              {error && !loaded ? "Retry notes" : "Refresh notes"}
            </button>
          </div>
          {canCreate && !createDenied && (
            <form onSubmit={add} className="request-note-composer">
              <h4>Add Internal Note</h4>
              <label htmlFor="internal-note-body" className="form-label">
                Internal Note
              </label>
              <textarea
                id="internal-note-body"
                className="form-control"
                rows="5"
                maxLength={maximum}
                ref={textarea}
                value={draft}
                disabled={pending}
                onChange={(event) => {
                  setDraft(event.target.value);
                  setError("");
                }}
                aria-invalid={Boolean(error && bodyError(draft))}
                aria-describedby={`internal-note-help internal-note-count${error ? " internal-note-error" : ""}`}
              />
              <p id="internal-note-help" className="text-body-secondary">
                Plain text only. Added notes cannot be edited or deleted.
              </p>
              <p id="internal-note-count" className="text-body-secondary">
                {draft.length.toLocaleString()} / 4,000 characters
              </p>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={pending || loading}
              >
                {pending ? "Adding Note…" : "Add Note"}
              </button>
            </form>
          )}
        </>
      )}
    </ContentCard>
  );
}
