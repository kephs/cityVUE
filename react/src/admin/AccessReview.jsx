import { accessText } from "./accessPresentation.js";

// Read-only presentation of the existing draft projection.
export default function AccessReview({ detail, state }) {
  const metadata = new Map(detail.permissions.map((p) => [p.key, p]));
  const label = (key) =>
    accessText(metadata.get(key)?.label) || "Unavailable permission";
  const needs = (key, required, seen = new Set()) => {
    if (seen.has(key)) return false;
    seen.add(key);
    return (metadata.get(key)?.requires || []).some(
      (k) => k === required || needs(k, required, seen),
    );
  };
  const reasons = (key) => {
    const dependents = state.added.filter((k) => k !== key && needs(k, key));
    return dependents.filter(
      (k) => !dependents.some((other) => other !== k && needs(other, k)),
    );
  };
  const additions = [...state.added].sort(
    (a, b) =>
      Number(state.sensitive.includes(b)) -
        Number(state.sensitive.includes(a)) || label(a).localeCompare(label(b)),
  );
  const keptManaged = state.managed.filter(
    (key) => !state.removed.includes(key) && !state.outside.includes(key),
  );
  const list = (keys) => (
    <ul>
      {keys.map((key) => (
        <li key={key}>{label(key)}</li>
      ))}
    </ul>
  );
  const memberships = (values) =>
    values.length
      ? values.map((d) => (
          <div key={d.id}>
            {d.name}
            {d.status === "inactive" ? " · Inactive" : ""}
          </div>
        ))
      : "None";
  return (
    <div className="access-review">
      {additions.length > 0 && (
        <section
          className="access-review-card"
          aria-labelledby="access-review-added"
        >
          <h4 id="access-review-added">Access being added</h4>
          <p>
            {state.added.length}{" "}
            {state.added.length === 1 ? "permission" : "permissions"} to add
          </p>
          <ul className="access-review-permissions">
            {additions.map((key) => (
              <li key={key}>
                <div className="access-review-permission-name">
                  <strong>{label(key)}</strong>
                  {state.sensitive.includes(key) && (
                    <span className="badge text-bg-secondary">
                      Sensitive access
                    </span>
                  )}
                </div>
                <p>{accessText(metadata.get(key)?.description)}</p>
                {reasons(key).length > 0 && (
                  <p className="access-review-reason">
                    Required by {reasons(key).map(label).join(", ")}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {state.removed.length > 0 && (
        <section
          className="access-review-card"
          aria-labelledby="access-review-removed"
        >
          <h4 id="access-review-removed">
            Access &amp; Permissions{" "}
            {state.removed.length === 1
              ? "assignment being removed"
              : "assignments being removed"}
          </h4>
          <p>
            {state.removed.length}{" "}
            {state.removed.length === 1 ? "assignment" : "assignments"} to
            remove
          </p>
          <ul className="access-review-permissions">
            {state.removed.map((key) => (
              <li key={key}>
                <strong>{label(key)}</strong>
                <p>
                  {state.remains.includes(key)
                    ? `${detail.staff.displayName} will still have this access because it is assigned elsewhere.`
                    : "The staff member will no longer have this access."}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section
        className="access-review-card"
        aria-labelledby="access-review-unchanged"
      >
        <h4 id="access-review-unchanged">Access that will not change</h4>
        <strong>
          {state.outside.length}{" "}
          {state.outside.length === 1 ? "permission" : "permissions"} assigned
          elsewhere
        </strong>
        <p>
          {detail.staff.displayName} will keep this access. It is managed
          outside Access &amp; Permissions.
        </p>
        <details>
          <summary>View permissions</summary>
          {list(state.outside)}
        </details>
        {keptManaged.length > 0 && (
          <details>
            <summary>
              {keptManaged.length}{" "}
              {keptManaged.length === 1
                ? "permission remains"
                : "permissions remain"}{" "}
              managed here
            </summary>
            {list(keptManaged)}
          </details>
        )}
        <dl className="access-review-values">
          <div>
            <dt>
              {detail.departments.length > 1 ? "Departments" : "Department"}
            </dt>
            <dd>{memberships(detail.departments)}</dd>
          </div>
          <div>
            <dt>{detail.divisions.length > 1 ? "Divisions" : "Division"}</dt>
            <dd>{memberships(detail.divisions)}</dd>
          </div>
        </dl>
        <p>These assignments will not change.</p>
        <details>
          <summary>About access scope</summary>
          <p>
            Some actions may also depend on this staff member's Department or
            Division access.
          </p>
        </details>
      </section>
      <section
        className="access-review-card"
        aria-labelledby="access-review-after"
      >
        <h4 id="access-review-after">After these changes</h4>
        <dl className="access-review-values">
          <div>
            <dt>Current access</dt>
            <dd>{detail.effective.length} permissions</dd>
          </div>
          <div>
            <dt>After changes</dt>
            <dd>{state.effective.length} permissions</dd>
          </div>
          <div>
            <dt>Access Administrator</dt>
            <dd>
              {detail.accessAdministrator ? "Yes" : "No"}
              <small>Managed outside Access &amp; Permissions</small>
            </dd>
          </div>
        </dl>
      </section>
    </div>
  );
}
