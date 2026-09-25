import { useEffect, useId, useRef, useState } from "react";
import {
  ContentCard,
  SectionHeading,
} from "../components/ui/RequestPresentation.jsx";
import RequestDialog from "../staff/requests/RequestDialog.jsx";
import "./attachments.css";
const types = ["image/jpeg", "image/png", "image/webp"];
const maxFile = 5242880,
  maxTotal = 15728640,
  maxCount = 5;
export const displayFilename = (name) =>
  name
    .normalize("NFKC")
    .replace(/%[0-9a-f]{2}/gi, "_")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .replace(/\.{2,}/g, "_")
    .replace(/^[ .]+|[ .]+$/g, "")
    .slice(-120) || "image";
export const fileSize = (bytes) => `${(bytes / 1048576).toFixed(2)} MiB`;
function validation(files) {
  const total = files.reduce((n, x) => n + x.file.size, 0);
  return files.map((entry) => ({
    ...entry,
    error:
      !types.includes(entry.file.type) ||
      !/^.+\.(jpe?g|png|webp)$/i.test(entry.file.name)
        ? "Unsupported file type."
        : entry.file.size === 0
          ? "File is empty."
          : entry.file.size > maxFile
            ? "File is too large."
            : files.length > maxCount
              ? "Too many files selected."
              : total > maxTotal
                ? "Selected files are too large together."
                : "",
  }));
}
/** File objects and opaque claims live only in component memory. Each parent owns a separate instance. */
export function useAttachmentDraft(repository, binding, onAccessFailure) {
  const [files, setFiles] = useState([]),
    [pending, setPending] = useState(false),
    [enabled, setEnabled] = useState(false),
    [error, setError] = useState("");
  const current = useRef([]),
    claim = useRef(null),
    busy = useRef(false),
    controller = useRef(null),
    bindingRef = useRef(binding);
  bindingRef.current = binding;
  const key = JSON.stringify(binding);
  const update = (rows) => {
    current.current = rows;
    setFiles(rows);
  };
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    busy.current = false;
    setPending(false);
    setError("");
    update([]);
    claim.current = null;
    setEnabled(false);
    repository
      ?.policy(abort.signal)
      .then((policy) => {
        if (!abort.signal.aborted) setEnabled(policy.enabled === true);
      })
      .catch(() => {});
    return () => {
      abort.abort();
      const staged = claim.current;
      claim.current = null;
      if (staged) repository?.remove(staged).catch(() => {});
    };
  }, [repository, key]);
  const select = (list) => {
    if (busy.current) return;
    setError("");
    update(
      validation([
        ...current.current,
        ...Array.from(list)
          .slice(0, 20)
          .map((file) => ({
            id: crypto.randomUUID(),
            file,
            filename: displayFilename(file.name),
            state: "Selected",
          })),
      ]),
    );
  };
  async function remove(id) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    const signal = controller.current.signal;
    try {
      if (claim.current) await repository.remove(claim.current, id, signal);
      if (signal.aborted) return;
      update(validation(current.current.filter((x) => x.id !== id)));
      setError("");
    } catch (problem) {
      if (signal.aborted) return;
      if (problem.status === 404) {
        // Expired/finalized stages cannot be mutated; discard only this local selection.
        claim.current = null;
        update(
          validation(
            current.current
              .filter((x) => x.id !== id)
              .map((x) => ({ ...x, state: "Selected" })),
          ),
        );
        setError("");
      } else if ([401, 403].includes(problem.status)) {
        claim.current = null;
        update([]);
        await onAccessFailure?.(problem);
      } else setError("The file could not be removed. Try again.");
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  async function prepare() {
    if (
      busy.current ||
      current.current.some((x) => x.error) ||
      !current.current.length
    )
      return;
    busy.current = true;
    setPending(true);
    setError("");
    const signal = controller.current.signal;
    try {
      if (!claim.current) {
        const started = await repository.start(bindingRef.current, signal);
        if (signal.aborted) {
          repository.remove(started).catch(() => {});
          return;
        }
        claim.current = started;
      }
      for (const entry of [...current.current]) {
        if (entry.state === "Ready" || entry.state === "Rejected") continue;
        update(
          current.current.map((x) =>
            x.id === entry.id ? { ...x, state: "Uploading" } : x,
          ),
        );
        // Server decoding/scanning follows upload. This is an indeterminate status, never a fabricated percentage.
        const notice = setTimeout(() => {
          if (!signal.aborted)
            update(
              current.current.map((x) =>
                x.id === entry.id
                  ? { ...x, state: "Processing / scanning" }
                  : x,
              ),
            );
        }, 100);
        try {
          const metadata = await repository.upload(
            claim.current,
            entry.id,
            entry.file,
            signal,
          );
          if (signal.aborted) return;
          update(
            current.current.map((x) =>
              x.id === entry.id
                ? {
                    ...x,
                    metadata,
                    filename: metadata.filename,
                    state: "Ready",
                  }
                : x,
            ),
          );
        } catch (problem) {
          if (signal.aborted) return;
          update(
            current.current.map((x) =>
              x.id === entry.id
                ? {
                    ...x,
                    state: [400, 413, 422].includes(problem.status)
                      ? "Rejected"
                      : "Failed",
                  }
                : x,
            ),
          );
          throw problem;
        } finally {
          clearTimeout(notice);
        }
      }
    } catch (problem) {
      if (!signal.aborted) {
        setError(
          [400, 413, 422].includes(problem.status)
            ? "File could not be processed. Remove the rejected file."
            : "Files could not be prepared. Retry or remove them and select again.",
        );
        if (problem.status === 404) {
          claim.current = null;
          update(current.current.map((x) => ({ ...x, state: "Failed" })));
        }
        if ([401, 403].includes(problem.status)) {
          claim.current = null;
          update([]);
          await onAccessFailure?.(problem);
        }
      }
    } finally {
      if (!signal.aborted) {
        busy.current = false;
        setPending(false);
      }
    }
  }
  const ready = !pending && files.every((x) => !x.error && x.state === "Ready");
  return {
    files,
    pending,
    enabled,
    error,
    ready,
    select,
    remove,
    prepare,
    claim: () => (files.length && ready ? claim.current : undefined),
    preview: async (id, signal) => {
      try {
        return await repository.preview(claim.current, id, signal);
      } catch (problem) {
        if (!signal.aborted && [401, 403, 404].includes(problem.status)) {
          claim.current = null;
          update(
            problem.status === 404
              ? current.current.map((x) => ({ ...x, state: "Selected" }))
              : [],
          );
          setError(
            problem.status === 404
              ? "File staging expired. Prepare files again or remove them."
              : "Attachment access is unavailable.",
          );
          await onAccessFailure?.(problem);
        }
        throw problem;
      }
    },
    clear: () => {
      claim.current = null;
      update([]);
      setError("");
    },
  };
}

export function AttachmentSelector({
  draft,
  disabled = false,
  camera = false,
  label = "Attachments",
  requesterDirected = false,
}) {
  const id = useId(),
    picker = useRef(null),
    capture = useRef(null);
  if (!draft.enabled) return null;
  const choose = (event) => {
    draft.select(event.target.files);
    event.target.value = "";
  };
  return (
    <fieldset
      className="attachment-selector"
      disabled={disabled || draft.pending}
      aria-describedby={`${id}-help`}
    >
      <legend className="h5">{label}</legend>
      {requesterDirected && (
        <p>
          Attachments added here are intended for the requester. Do not include
          staff-only information. Delivery is not enabled.
        </p>
      )}
      <p id={`${id}-help`} className="text-body-secondary">
        Add up to 5 images, 5 MiB each (15 MiB total). JPEG, PNG or WebP. Photo
        metadata is removed during processing.
      </p>
      <p className="small attachment-development-notice">
        <strong>Development Notice</strong> Use fictional images only. Malware
        detection is not enabled.
      </p>
      <div className="attachment-controls">
        {camera && (
          <>
            <button
              type="button"
              className="btn btn-secondary"
              onClick={() => capture.current.click()}
            >
              Take Photo
            </button>
            <input
              ref={capture}
              className="visually-hidden"
              tabIndex="-1"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              capture="environment"
              aria-label="Take Photo"
              onChange={choose}
            />
          </>
        )}
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => picker.current.click()}
        >
          {camera ? "Choose Files" : "Add files"}
        </button>
        <input
          ref={picker}
          className="visually-hidden"
          tabIndex="-1"
          type="file"
          multiple
          accept="image/jpeg,image/png,image/webp"
          aria-label="Choose attachment files"
          onChange={choose}
        />
      </div>
      <p role="status">
        {draft.files.length} selected ·{" "}
        {fileSize(draft.files.reduce((n, x) => n + x.file.size, 0))}
        {draft.pending ? " · Uploading / processing files…" : ""}
      </p>
      {draft.error && <p role="alert">{draft.error}</p>}
      <ul className="attachment-list">
        {draft.files.map((file) => (
          <AttachmentDraftItem key={file.id} file={file} draft={draft} />
        ))}
      </ul>
      {draft.files.length > 0 && !draft.ready && (
        <>
          <button
            type="button"
            className="btn btn-secondary"
            disabled={draft.files.some(
              (x) => x.error || x.state === "Rejected",
            )}
            onClick={draft.prepare}
          >
            {draft.files.some((x) => x.state === "Failed")
              ? "Retry files"
              : "Prepare files"}
          </button>
          <p>Prepare all files, or remove invalid files, before submitting.</p>
        </>
      )}
    </fieldset>
  );
}

function AttachmentDraftItem({ file, draft }) {
  const details = (
    <div className="attachment-copy">
      <strong>{file.filename}</strong>
      <span>
        {fileSize(file.file.size)} · {file.error ? "Rejected" : file.state}
      </span>
      {file.error && <span role="alert">{file.error}</span>}
    </div>
  );
  const remove = (
    <button
      type="button"
      className="btn btn-sm btn-secondary"
      onClick={() => draft.remove(file.id)}
      aria-label={`Remove ${file.filename}`}
    >
      Remove
    </button>
  );
  return (
    <li>
      {file.state === "Ready" ? (
        <AttachmentPreview
          filename={file.filename}
          load={(signal) => draft.preview(file.id, signal)}
          actions={remove}
        >
          {details}
        </AttachmentPreview>
      ) : (
        <div className="attachment-body">
          {details}
          <div className="attachment-controls">{remove}</div>
        </div>
      )}
    </li>
  );
}

function AttachmentPreview({
  filename,
  load,
  download = false,
  image = true,
  onAccessFailure,
  children,
  actions,
}) {
  const [url, setUrl] = useState(""),
    [error, setError] = useState(""),
    [pending, setPending] = useState(false),
    [enlarged, setEnlarged] = useState(false);
  const object = useRef(""),
    downloads = useRef(new Set()),
    lifecycle = useRef(null),
    lock = useRef(false),
    trigger = useRef(null);
  useEffect(() => {
    const abort = new AbortController();
    lifecycle.current = abort;
    return () => {
      abort.abort();
      if (object.current) URL.revokeObjectURL(object.current);
      for (const downloadUrl of downloads.current)
        URL.revokeObjectURL(downloadUrl);
      downloads.current.clear();
    };
  }, []);
  function clearPreview() {
    if (object.current) URL.revokeObjectURL(object.current);
    object.current = "";
    setUrl("");
    setEnlarged(false);
  }
  function imageFailed() {
    clearPreview();
    setError("Preview unavailable. The file may still be downloaded.");
  }
  async function open(asDownload, origin) {
    if (lock.current) return;
    if (!asDownload) trigger.current = origin;
    lock.current = true;
    setPending(true);
    setError("");
    try {
      const blob = await load(lifecycle.current.signal);
      if (lifecycle.current.signal.aborted) return;
      const loaded = URL.createObjectURL(blob);
      if (asDownload) {
        downloads.current.add(loaded);
        const link = document.createElement("a");
        link.href = loaded;
        link.download = filename;
        link.click();
        setTimeout(() => {
          if (downloads.current.delete(loaded)) URL.revokeObjectURL(loaded);
        }, 1000);
      } else {
        if (object.current) URL.revokeObjectURL(object.current);
        object.current = loaded;
        setUrl(loaded);
        setEnlarged(download);
      }
    } catch (problem) {
      if (!lifecycle.current.signal.aborted) {
        clearPreview();
        setError("Preview or download unavailable. Try again.");
        if ([401, 403, 404].includes(problem.status))
          await onAccessFailure?.(problem);
      }
    } finally {
      lock.current = false;
      if (!lifecycle.current.signal.aborted) setPending(false);
    }
  }
  const downloadButton = download && (
    <button
      type="button"
      className="btn btn-sm btn-secondary"
      disabled={pending}
      onClick={() => open(true)}
      aria-label={`Download ${filename}`}
    >
      Download
    </button>
  );
  const thumbnail = url && (
    <img src={url} alt={`Preview of ${filename}`} onError={imageFailed} />
  );
  return (
    <div className="attachment-preview">
      {thumbnail &&
        (download ? (
          <button
            type="button"
            className="attachment-thumbnail btn btn-sm btn-secondary"
            aria-label={`Enlarge ${filename}`}
            aria-disabled={pending}
            onClick={(event) => open(false, event.currentTarget)}
          >
            {thumbnail}
          </button>
        ) : (
          thumbnail
        ))}
      <div className="attachment-body">
        {children}
        <div className="attachment-controls">
          {image && (
            <button
              type="button"
              className="btn btn-sm btn-secondary"
              disabled={pending && !download}
              aria-disabled={download ? pending : undefined}
              onClick={(event) => open(false, event.currentTarget)}
              aria-label={`Preview ${filename}`}
            >
              {pending ? "Loading…" : "Preview"}
            </button>
          )}
          {downloadButton}
          {actions}
        </div>
        {error && <p role="alert">{error}</p>}
      </div>
      {enlarged && url && (
        <RequestDialog
          title="Image Preview"
          wide
          onClose={() => setEnlarged(false)}
          returnFocusRef={trigger}
        >
          <div className="attachment-image-dialog">
            <p>{filename}</p>
            <img
              src={url}
              alt={`Enlarged preview of ${filename}`}
              onError={imageFailed}
            />
            <div className="attachment-controls">{downloadButton}</div>
          </div>
        </RequestDialog>
      )}
    </div>
  );
}
export function AttachmentList({
  items,
  repository,
  requestId,
  context,
  parentId,
  onAccessFailure,
}) {
  if (!items?.length) return null;
  return (
    <div>
      <h5>
        {items.length === 1 ? "1 attachment" : `${items.length} attachments`}
      </h5>
      <ol className="attachment-list attachment-numbered-list">
        {items.map((item, index) => (
          <li
            key={`${requestId}:${context}:${parentId}:${item.id}:${item.filename}`}
          >
            <span className="attachment-ordinal" aria-hidden="true">
              {index + 1}.
            </span>
            <AttachmentPreview
              filename={item.filename}
              image={types.includes(item.mediaType)}
              download
              load={(signal) =>
                repository.download(
                  requestId,
                  context,
                  parentId,
                  item.id,
                  signal,
                )
              }
              onAccessFailure={onAccessFailure}
            >
              <div className="attachment-copy">
                <strong>{item.filename}</strong>
                <span>
                  {item.mediaType} · {fileSize(item.byteSize)}
                </span>
              </div>
            </AttachmentPreview>
          </li>
        ))}
      </ol>
    </div>
  );
}
export function RequestEvidence({ repository, requestId, onAccessFailure }) {
  const [items, setItems] = useState([]),
    [state, setState] = useState("Loading request evidence…");
  useEffect(() => {
    const abort = new AbortController();
    setItems([]);
    if (!repository) {
      setState("");
      return;
    }
    repository
      .policy(abort.signal)
      .then(async (policy) => {
        if (!policy.enabled) {
          if (!abort.signal.aborted) setState("");
          return;
        }
        const files = await repository.evidence(requestId, abort.signal);
        if (!abort.signal.aborted) {
          setItems(files);
          setState(files.length ? "" : "No attachments");
        }
      })
      .catch(async (problem) => {
        if (!abort.signal.aborted) {
          setItems([]);
          setState("Request evidence unavailable.");
          if ([401, 403, 404].includes(problem.status))
            await onAccessFailure?.(problem);
        }
      });
    return () => abort.abort();
  }, [repository, requestId]);
  if (!state && !items.length) return null;
  return (
    <ContentCard className="request-evidence">
      <SectionHeading icon="images">Request Evidence</SectionHeading>
      {state && <p role="status">{state}</p>}
      <AttachmentList
        items={items}
        repository={repository}
        requestId={requestId}
        parentId={requestId}
        context="REQUEST_EVIDENCE"
        onAccessFailure={onAccessFailure}
      />
    </ContentCard>
  );
}
