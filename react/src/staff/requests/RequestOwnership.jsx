import { useEffect, useRef, useState } from "react";
import { workspaceError } from "./requestRepository.js";

export const targetLabels = { staff: "Staff", role: "Role", group: "Team" };
export function TargetLabel({ target }) {
  return target ? (
    <>
      <i
        className={`bi bi-${{ staff: "person", role: "person-badge", group: "people" }[target.type] || "person"}`}
        aria-hidden="true"
      />{" "}
      {target.displayName} · {targetLabels[target.type]}
      {target.active === false ? " (inactive)" : ""}
    </>
  ) : (
    <>Unassigned</>
  );
}

function TargetPicker({
  repository,
  id,
  mode,
  busy,
  onChoose,
  onCancel,
  onAccessFailure,
}) {
  const [type, setType] = useState("staff"),
    [search, setSearch] = useState(""),
    [submitted, setSubmitted] = useState(""),
    [attempt, setAttempt] = useState(0),
    [state, setState] = useState(null),
    [selected, setSelected] = useState("");
  const first = useRef(null);
  useEffect(() => {
    first.current?.focus();
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    setState(null);
    setSelected("");
    repository
      .targets(
        id,
        type,
        submitted,
        controller.signal,
        mode === "assign" ? "assignment" : "watchers",
      )
      .then(
        (data) => {
          if (!controller.signal.aborted) setState({ data });
        },
        (error) => {
          if (controller.signal.aborted) return;
          if ([401, 403, 404].includes(error.status)) onAccessFailure(error);
          else setState({ error });
        },
      );
    return () => controller.abort();
  }, [repository, id, type, submitted, attempt, onAccessFailure, mode]);
  return (
    <form
      className="ownership-picker"
      aria-label={mode === "assign" ? "Choose assignment" : "Choose watcher"}
      onSubmit={(e) => {
        e.preventDefault();
        const target = state?.data.items.find((t) => t.id === selected);
        if (target) onChoose(target);
      }}
      onKeyDown={(e) => {
        if (e.key === "Escape" && !busy) {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      <h4>{mode === "assign" ? "Choose assignment" : "Choose watcher"}</h4>
      <fieldset disabled={busy}>
        <legend className="visually-hidden">Eligible operational target</legend>
        <label htmlFor="ownership-type">Target type</label>
        <select
          id="ownership-type"
          className="form-select"
          ref={first}
          value={type}
          onChange={(e) => setType(e.target.value)}
        >
          {Object.entries(targetLabels).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
        <label htmlFor="ownership-search">Search eligible targets</label>
        <input
          id="ownership-search"
          className="form-control"
          maxLength={100}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              setSubmitted(search);
              setAttempt((n) => n + 1);
            }
          }}
        />
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setSubmitted(search);
            setAttempt((n) => n + 1);
          }}
        >
          Search targets
        </button>
        {!state && <p role="status">Loading eligible targets…</p>}
        {state?.error && (
          <p role="alert">Targets could not be loaded. Try searching again.</p>
        )}
        {state?.data &&
          (state.data.items.length ? (
            <>
              <label htmlFor="ownership-result">Eligible target</label>
              <select
                id="ownership-result"
                className="form-select"
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
              >
                <option value="">Choose a target</option>
                {state.data.items.map((target) => (
                  <option key={target.id} value={target.id}>
                    {target.displayName}
                  </option>
                ))}
              </select>
              <p role="status">
                {selected
                  ? `Selected: ${state.data.items.find((t) => t.id === selected)?.displayName}`
                  : "Up to 25 eligible targets. Search to narrow results."}
              </p>
            </>
          ) : (
            <p role="status">No eligible targets found.</p>
          ))}
        <div className="request-action-buttons">
          <button
            className="btn btn-primary"
            disabled={!selected || !state?.data}
          >
            {mode === "assign" ? "Confirm assignment" : "Confirm watcher"}
          </button>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={onCancel}
          >
            Cancel selection
          </button>
        </div>
      </fieldset>
    </form>
  );
}

export default function RequestOwnership({
  repository,
  id,
  row,
  capabilities,
  busy,
  onMutate,
  onAccessFailure,
}) {
  const [watchers, setWatchers] = useState(null),
    [retry, setRetry] = useState(0),
    [mode, setMode] = useState(null);
  const trigger = useRef(null);
  useEffect(() => {
    setMode(null);
  }, [row.revision]);
  useEffect(() => {
    const controller = new AbortController();
    setWatchers(null);
    repository.watchers(id, controller.signal).then(
      (data) => {
        if (!controller.signal.aborted) setWatchers({ data });
      },
      (error) => {
        if (controller.signal.aborted) return;
        if ([401, 403, 404].includes(error.status)) onAccessFailure(error);
        else setWatchers({ error });
      },
    );
    return () => controller.abort();
  }, [repository, id, row.revision, retry, onAccessFailure]);
  const cancel = () => {
    setMode(null);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const open = (event, next) => {
    trigger.current = event.currentTarget;
    setMode(next);
  };
  return (
    <div className="request-ownership">
      <section aria-labelledby="assignment-heading">
        <h3 id="assignment-heading">Assignment</h3>
        <p>
          <TargetLabel target={row.assignment} />
        </p>
        {capabilities.canAssign && (
          <div className="request-action-buttons">
            <button
              className="btn btn-secondary"
              disabled={busy || !!mode}
              onClick={(e) => open(e, "assign")}
            >
              {row.assignment ? "Change Assignment" : "Assign Request"}
            </button>
            {row.assignment && (
              <button
                className="btn btn-secondary"
                disabled={busy || !!mode}
                onClick={() => onMutate("unassign", {})}
              >
                Unassign Request
              </button>
            )}
          </div>
        )}
      </section>
      <section aria-labelledby="watchers-heading">
        <h3 id="watchers-heading">Watchers</h3>
        <p>
          Following is separate from assignment and access. Notifications are
          not sent.
        </p>
        {!watchers && <p role="status">Loading watchers…</p>}
        {watchers?.error && (
          <>
            <p role="alert">{workspaceError(watchers.error)}</p>
            <button
              className="btn btn-secondary"
              onClick={() => setRetry((n) => n + 1)}
            >
              Retry watchers
            </button>
          </>
        )}
        {watchers?.data && (
          <>
            {!watchers.data.items.length ? (
              <p>No watchers</p>
            ) : (
              <ul className="watcher-list">
                {watchers.data.items.map((target) => (
                  <li key={`${target.type}:${target.id}`}>
                    <span>
                      <TargetLabel target={target} />
                    </span>
                    {capabilities.canManageWatchers && (
                      <button
                        className="btn btn-secondary"
                        disabled={busy || !!mode}
                        aria-label={`Remove watcher: ${target.displayName}`}
                        onClick={() =>
                          onMutate("removeWatcher", {
                            targetType: target.type,
                            targetId: target.id,
                          })
                        }
                      >
                        Remove watcher
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="request-action-buttons">
              <button
                className="btn btn-secondary"
                disabled={busy || !!mode || !capabilities.canWatchSelf}
                onClick={() =>
                  onMutate(
                    watchers.data.watchingSelf ? "unwatchSelf" : "watchSelf",
                    {},
                  )
                }
              >
                {watchers.data.watchingSelf
                  ? "Stop watching"
                  : "Watch this request"}
              </button>
              {capabilities.canManageWatchers && (
                <button
                  className="btn btn-secondary"
                  disabled={busy || !!mode}
                  onClick={(e) => open(e, "watcher")}
                >
                  Add Watcher
                </button>
              )}
            </div>
          </>
        )}
      </section>
      {mode && (
        <TargetPicker
          repository={repository}
          id={id}
          mode={mode}
          busy={busy}
          onCancel={cancel}
          onAccessFailure={onAccessFailure}
          onChoose={(target) =>
            onMutate(mode === "assign" ? "assign" : "addWatcher", {
              targetType: target.type,
              targetId: target.id,
            })
          }
        />
      )}
    </div>
  );
}
