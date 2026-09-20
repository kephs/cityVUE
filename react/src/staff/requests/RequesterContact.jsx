import {
  ContentCard,
  SectionHeading,
} from "../../components/ui/RequestPresentation.jsx";

export default function RequesterContact({ canRead, state, onLoad }) {
  const protectedState = !canRead || state?.protected;
  return (
    <ContentCard className="request-contact">
      <SectionHeading icon="person-lock">Requester Contact</SectionHeading>
      {protectedState ? (
        <>
          <p>
            <i className="bi bi-lock" aria-hidden="true" />{" "}
            <strong>Protected</strong>
          </p>
          <p>
            You don't have permission to view requester contact information.
          </p>
        </>
      ) : (
        <>
          {state?.loading && <p role="status">Loading requester contact…</p>}
          {state?.error && (
            <p role="alert">
              Requester contact could not be loaded. Please try again.
            </p>
          )}
          {state?.data &&
            (state.data.name || state.data.email ? (
              <dl>
                {state.data.name && (
                  <div>
                    <dt>
                      <i className="bi bi-person" aria-hidden="true" /> Name
                    </dt>
                    <dd>{state.data.name}</dd>
                  </div>
                )}
                {state.data.email && (
                  <div>
                    <dt>
                      <i className="bi bi-envelope" aria-hidden="true" /> Email
                    </dt>
                    <dd>{state.data.email}</dd>
                  </div>
                )}
              </dl>
            ) : (
              <p>No contact information was provided.</p>
            ))}
          {!state && (
            <p>
              View protected structured contact for this request. Access is
              audited.
            </p>
          )}
          <button
            className="btn btn-secondary"
            type="button"
            disabled={state?.loading}
            onClick={onLoad}
          >
            {state?.data
              ? "Refresh requester contact"
              : state?.error
                ? "Retry requester contact"
                : "View requester contact"}
          </button>
        </>
      )}
    </ContentCard>
  );
}
