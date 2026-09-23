import { useCallback, useEffect, useState } from "react";
import {
  ContentCard,
  SectionHeading,
} from "../../components/ui/RequestPresentation.jsx";
import RequestDialog from "./RequestDialog.jsx";
import RequestOwnership, { TargetLabel } from "./RequestOwnership.jsx";
import RequesterContact from "./RequesterContact.jsx";
import RequesterTracking from "./RequesterTracking.jsx";

export default function RequestManagement({
  repository,
  id,
  row,
  busy,
  onMutate,
  onAccessFailure,
  contactState,
  loadContact,
  clearContact,
}) {
  const [watcherSummary, setWatcherSummary] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    setWatcherSummary(null);
    repository.watchers(id, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted)
          setWatcherSummary({
            id,
            revision: row.revision,
            count: data.items.length,
          });
      },
      (problem) => {
        if (controller.signal.aborted) return;
        setWatcherSummary({ id, revision: row.revision, unavailable: true });
        if ([401, 403, 404].includes(problem.status)) onAccessFailure(problem);
      },
    );
    return () => controller.abort();
  }, [repository, id, row.revision, onAccessFailure]);
  const watcherState =
    watcherSummary?.id === id && watcherSummary.revision === row.revision
      ? watcherSummary
      : null;
  const [dialog, setDialog] = useState(null);
  const [error, setError] = useState("");
  const close = () => {
    if (dialog === "contact") clearContact();
    setDialog(null);
    setError("");
  };
  const denied = useCallback(
    (problem) => {
      setError(
        "This management information is unavailable. Close and reopen to try again.",
      );
      return onAccessFailure(problem);
    },
    [onAccessFailure],
  );
  const open = (name) => {
    setError("");
    setDialog(name);
    if (name === "contact") void loadContact();
  };
  const mutate = async (operation, input) => {
    setError("");
    const result = await onMutate(operation, input);
    if (result?.error) setError(result.error);
  };
  return (
    <ContentCard className="request-management">
      <SectionHeading icon="sliders">Request Management</SectionHeading>
      <div className="request-management-row">
        <div>
          <h4>Assignment</h4>
          <p>
            <TargetLabel target={row.assignment} />
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="Manage assignment"
          disabled={busy}
          onClick={() => open("assignment")}
        >
          Manage
        </button>
      </div>
      <div className="request-management-row">
        <div>
          <h4>Watchers</h4>
          <p>
            {!watcherState
              ? "Loading watcher count…"
              : watcherState.unavailable
                ? "Watcher count unavailable"
                : watcherState.count === 0
                  ? "No watchers are following this request"
                  : `${watcherState.count} ${watcherState.count === 1 ? "watcher" : "watchers"} following this request`}
          </p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="Manage watchers"
          disabled={busy}
          onClick={() => open("watchers")}
        >
          Manage
        </button>
      </div>
      {row.audience === "public" && (
        <RequesterTracking
          key={`${id}:${row.capabilities?.canManageRequesterTracking === true}`}
          repository={repository}
          id={id}
          allowed={row.capabilities?.canManageRequesterTracking === true}
          onAccessFailure={onAccessFailure}
        />
      )}
      <div className="request-management-row">
        <div>
          <h4>Requester Contact</h4>
          <p>
            {row.requesterIdentity === "anonymous"
              ? "Not provided — submitted anonymously"
              : row.canReadContact
                ? "Separate, audited access"
                : "Protected"}
          </p>
        </div>
        {row.requesterIdentity !== "anonymous" && (
          <button
            type="button"
            className="btn btn-secondary"
            aria-label="View requester contact"
            disabled={busy}
            onClick={() => open("contact")}
          >
            View
          </button>
        )}
      </div>
      {dialog && (
        <RequestDialog
          title={
            {
              assignment: "Assignment",
              watchers: "Watchers",
              contact: "Requester Contact",
            }[dialog]
          }
          onClose={close}
          busy={busy}
        >
          {error && <p role="alert">{error}</p>}
          {dialog === "contact" ? (
            <RequesterContact
              embedded
              canRead={row.canReadContact}
              state={contactState}
              onLoad={loadContact}
            />
          ) : (
            <RequestOwnership
              key={dialog}
              section={dialog}
              repository={repository}
              id={id}
              row={row}
              capabilities={row.capabilities || {}}
              busy={busy}
              onMutate={mutate}
              onAccessFailure={denied}
            />
          )}
        </RequestDialog>
      )}
    </ContentCard>
  );
}
