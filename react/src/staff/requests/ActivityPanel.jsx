import { useState } from "react";
import { ContentCard } from "../../components/ui/RequestPresentation.jsx";
import RequestActivity from "./RequestActivity.jsx";
import RequestDialog from "./RequestDialog.jsx";

export default function ActivityPanel({
  repository,
  id,
  revision,
  onAccessFailure,
}) {
  const [open, setOpen] = useState(false);
  return (
    <ContentCard className="request-history">
      <RequestActivity
        key={`${id}:${revision}`}
        preview
        embedded
        repository={repository}
        id={id}
        onAccessFailure={onAccessFailure}
      />
      <button
        type="button"
        className="btn btn-secondary"
        onClick={() => setOpen(true)}
      >
        View full activity
      </button>
      {open && (
        <RequestDialog
          title="Full Request Activity"
          wide
          onClose={() => setOpen(false)}
        >
          <RequestActivity
            key={`${id}:${revision}`}
            embedded
            repository={repository}
            id={id}
            onAccessFailure={onAccessFailure}
          />
        </RequestDialog>
      )}
    </ContentCard>
  );
}
