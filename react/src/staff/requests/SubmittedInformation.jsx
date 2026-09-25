import { useEffect, useRef, useState } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import AnswerValue from "../../components/ui/AnswerValue.jsx";
import { formatCalendarDate } from "../../components/ui/calendarDate.js";

/** Protected content stays in memory and is never inferred from ordinary detail. */
export default function SubmittedInformation({ id, repository, canRead }) {
  const auth = useAuth();
  const [state, setState] = useState(null);
  const pending = useRef(null);
  const context = `${auth.account?.homeAccountId ?? "staff"}:${auth.isAuthenticated}`;
  useEffect(() => {
    setState(null);
    return () => {
      pending.current?.abort();
      pending.current = null;
    };
  }, [id, repository, canRead, context, auth.isAuthenticated]);
  if (!canRead || state?.denied) return null;
  const load = async () => {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setState({ loading: true, id, context });
    try {
      const result = await repository.readAnswers(id, {
        signal: controller.signal,
      });
      if (!controller.signal.aborted)
        setState({ data: result.answers, id, context });
    } catch (error) {
      if (!controller.signal.aborted)
        setState(
          [401, 403, 404].includes(error.status)
            ? { denied: true, id, context }
            : { error: true, id, context },
        );
    } finally {
      if (pending.current === controller) pending.current = null;
    }
  };
  const current = state?.id === id && state.context === context ? state : null;
  return (
    <section
      className="request-details-panel"
      aria-label="Submitted information"
    >
      <h2>Submitted information</h2>
      {current?.loading && <p role="status">Loading submitted information…</p>}
      {current?.error && (
        <p role="alert">
          Submitted information could not be loaded. Please try again.
        </p>
      )}
      {current?.data &&
        (current.data.length ? (
          <dl>
            {current.data.map((answer) => (
              <div key={answer.questionId}>
                <dt style={{ overflowWrap: "anywhere" }}>{answer.label}</dt>
                <dd
                  style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}
                >
                  <AnswerValue
                    value={
                      answer.type === "multi_select"
                        ? answer.selectedLabels
                        : answer.type === "date"
                          ? formatCalendarDate(answer.dateValue)
                          : answer.displayValue
                    }
                  />
                </dd>
              </div>
            ))}
          </dl>
        ) : (
          <p>No submitted information was provided.</p>
        ))}
      <button
        type="button"
        className="btn btn-secondary"
        disabled={current?.loading}
        onClick={load}
      >
        {current?.data
          ? "Refresh submitted information"
          : "View submitted information"}
      </button>
    </section>
  );
}
