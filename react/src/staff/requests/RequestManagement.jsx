import { useCallback, useEffect, useState } from "react";
import {
  ContentCard,
  SectionHeading,
  StatusBadge,
} from "../../components/ui/RequestPresentation.jsx";
import RequestDialog from "./RequestDialog.jsx";
import RequestOwnership, { TargetLabel } from "./RequestOwnership.jsx";
import RequesterContact from "./RequesterContact.jsx";
import RequesterTracking from "./RequesterTracking.jsx";
import RequesterHistory from "./RequesterHistory.jsx";

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
  section = "work",
  actions,
  routing,
}) {
  const [watcherSummary, setWatcherSummary] = useState(null);
  useEffect(() => {
    if (section === "requester") return;
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
  }, [repository, id, row.revision, onAccessFailure, section]);
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
    <ContentCard className={`request-management request-${section}`}>
      <SectionHeading icon={section === "requester" ? "person" : "sliders"}>
        {section === "requester" ? "Requester" : "Work"}
      </SectionHeading>
      {section === "work" && (
        <>
          <section className="request-work-lifecycle">
            <div className="request-work-status">
              <h4>Status</h4>
              <StatusBadge value={row.status} />
            </div>
            {actions}
          </section>
          <div className="request-management-row">
            <div>
              <h4>Assignment</h4>
              <p>
                <TargetLabel target={row.assignment} />
              </p>
            </div>
            {row.capabilities?.canAssign && (
              <button
                type="button"
                className="btn btn-secondary"
                disabled={busy}
                onClick={() => open("assignment")}
              >
                Change Assignment
              </button>
            )}
          </div>
          {routing}
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
        </>
      )}
      {section === "requester" && (
        <>
          <p>
            {row.requesterIdentity === "anonymous"
              ? "Submitted anonymously"
              : "Submitted with requester information"}
          </p>
          {row.intakeChannel && (
            <p className="text-body-secondary">
              Channel:{" "}
              {
                {
                  web: "Web",
                  phone: "Phone",
                  walk_in: "Walk-in",
                  staff: "Staff",
                  api: "API",
                }[row.intakeChannel]
              }
            </p>
          )}
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
                  ? "No contact information provided"
                  : "Protected contact information"}
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
          {row.audience === "public" &&
            row.requesterIdentity === "identified" &&
            row.canReadRequesterHistory && (
              <div className="request-management-row">
                <div>
                  <h4>Requester History</h4>
                  <p>Other requests available to you</p>
                </div>
                <button
                  type="button"
                  className="btn btn-secondary"
                  disabled={busy}
                  onClick={() => open("history")}
                >
                  View Request History
                </button>
              </div>
            )}
        </>
      )}
      {dialog && (
        <RequestDialog
          title={
            {
              assignment: "Assignment",
              watchers: "Watchers",
              contact: "Requester Contact",
              history: "Requester History",
            }[dialog]
          }
          onClose={close}
          busy={busy}
        >
          {error && <p role="alert">{error}</p>}
          {dialog === "history" ? (
            <RequesterHistory
              key={id}
              repository={repository}
              id={id}
              onAccessFailure={denied}
              onNavigate={close}
            />
          ) : dialog === "contact" ? (
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
