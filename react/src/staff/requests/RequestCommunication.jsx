import { useEffect, useRef, useState } from "react";
import {
  ContentCard,
  SectionHeading,
} from "../../components/ui/RequestPresentation.jsx";

const maximum = 4000;
function bodyError(body) {
  if (!body.trim()) return "Enter a message.";
  if (body.length > maximum)
    return "Messages must be 4,000 characters or fewer.";
  if (
    /[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069\ud800-\udfff]/u.test(
      body,
    )
  )
    return "Remove unsupported control characters from the message.";
  return "";
}

/** A new request or authorization context cannot render an old stream or draft, even for one frame. */
export default function RequestCommunication(props) {
  return (
    <CommunicationStream
      key={`${props.id}:${Boolean(props.canRead)}:${Boolean(props.canCreate)}`}
      {...props}
    />
  );
}

function CommunicationStream({
  repository,
  id,
  canRead,
  canCreate,
  onAccessFailure,
}) {
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
    firstNewMessage = useRef(null);
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
          ? "The message could not be added. Your draft is retained; try again."
          : "Messages could not be loaded. Please try again.",
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
      const data = await repository.communications(id, before, signal);
      if (signal.aborted) return;
      setItems((current) => {
        const rows = before ? [...current, ...data.items] : data.items;
        return [...new Map(rows.map((row) => [row.id, row])).values()];
      });
      setCursor(data.nextCursor);
      setLoaded(true);
      if (before) {
        firstNewMessage.current = data.items[0]?.id;
        setNotice("Older messages loaded.");
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
    if (firstNewMessage.current) {
      document.getElementById(`message-${firstNewMessage.current}`)?.focus();
      firstNewMessage.current = null;
    }
  }, [items]);
  useEffect(() => {
    if (!pending && notice === "Message added.") textarea.current?.focus();
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
      const message = await repository.createCommunication(
        id,
        draft,
        submission.current.key,
        signal,
      );
      if (signal.aborted) return;
      setItems((current) =>
        [message, ...current.filter((item) => item.id !== message.id)].sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id),
        ),
      );
      setDraft("");
      submission.current = null;
      setNotice("Message added.");
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
    <ContentCard className="request-communications">
      <SectionHeading icon="envelope">Requester Communication</SectionHeading>
      {!canRead || denied ? (
        <>
          <p>
            <i className="bi bi-lock" aria-hidden="true" />{" "}
            <strong>Protected</strong>
          </p>
          <p>You don't have permission to view messages.</p>
        </>
      ) : (
        <>
          <p className="text-body-secondary">
            Messages are intended for the requester. They are recorded in Reqro;
            requester delivery is not enabled. Do not include staff-only
            information.
          </p>
          {loading && <p role="status">Loading messages…</p>}
          {error && (
            <p role="alert" id="requester-message-error">
              {error}
            </p>
          )}
          <p role="status" className="request-communications-notice">
            {pending ? "Adding message…" : notice}
          </p>
          {loaded && !items.length && <p>No messages have been added.</p>}
          <ol
            className="request-communications-list"
            aria-label="Messages, newest first"
          >
            {items.map((message) => (
              <li key={message.id} id={`message-${message.id}`} tabIndex="-1">
                <div className="request-message-attribution">
                  <strong>{message.author.displayName}</strong>
                  <time dateTime={message.createdAt}>
                    {new Date(message.createdAt).toLocaleString()}
                  </time>
                </div>
                <p className="text-body-secondary">
                  Outbound · Portal · Recorded
                </p>
                <p className="request-message-body">{message.body}</p>
              </li>
            ))}
          </ol>
          <div className="request-communications-controls">
            {cursor && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={loading || pending}
                onClick={() => readPage(cursor, lifecycle.current.signal)}
              >
                Load older messages
              </button>
            )}
            <button
              type="button"
              className="btn btn-secondary"
              disabled={loading || pending}
              onClick={() => readPage(null, lifecycle.current.signal)}
            >
              {error && !loaded ? "Retry messages" : "Refresh messages"}
            </button>
          </div>
          {canCreate && !createDenied && (
            <form onSubmit={add} className="request-message-composer">
              <h4>Add Message</h4>
              <label htmlFor="requester-message-body" className="form-label">
                Message
              </label>
              <textarea
                id="requester-message-body"
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
                aria-describedby={`requester-message-help requester-message-count${error ? " requester-message-error" : ""}`}
              />
              <p id="requester-message-help" className="text-body-secondary">
                Plain text only. Added messages cannot be edited or deleted.
              </p>
              <p id="requester-message-count" className="text-body-secondary">
                {draft.length.toLocaleString()} / 4,000 characters
              </p>
              <button
                type="submit"
                className="btn btn-primary"
                disabled={pending || loading}
              >
                {pending ? "Adding Message…" : "Add Message"}
              </button>
            </form>
          )}
        </>
      )}
    </ContentCard>
  );
}
