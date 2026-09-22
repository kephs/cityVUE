import { useCallback, useState } from "react";
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
          <p>Following this request</p>
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
      <div className="request-management-row">
        <div>
          <h4>Requester Contact</h4>
          <p>{row.canReadContact ? "Separate, audited access" : "Protected"}</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          aria-label="View requester contact"
          disabled={busy}
          onClick={() => open("contact")}
        >
          View
        </button>
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
