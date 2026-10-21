import { useContext, useEffect, useRef, useState } from "react";
import { UNSAFE_DataRouterContext, useBlocker } from "react-router-dom";
import Confirmation from "./Confirmation.jsx";
import IssueDrawer from "./IssueDrawer.jsx";
import {
  createDepartmentPreview,
  departmentDraft,
  departmentErrors,
  departmentStatuses,
  relationshipCount,
  statusLabel,
} from "./departmentPreview.js";
import "./issueWorkspace.css";
import "./departmentsConfiguration.css";

function DraftNavigationGuard({ dirty }) {
  const blocker = useBlocker(dirty);
  return blocker.state === "blocked" ? (
    <Confirmation
      title="Leave this department preview?"
      cancelLabel="Keep editing"
      confirmLabel="Discard and leave"
      onCancel={() => blocker.reset()}
      onConfirm={() => blocker.proceed()}
      returnFocus={document.activeElement}
    >
      <p>
        Your unsaved draft and local preview will be discarded. Nothing has been
        saved to a server.
      </p>
    </Confirmation>
  ) : null;
}

function Relationships({ record }) {
  return (
    <section aria-labelledby="department-relationships">
      <h3 id="department-relationships">Fictional relationships</h3>
      <p>
        Read-only examples. Categories belong to a Department and may optionally
        belong to a Division. Service definitions belong to Categories.
      </p>
      <h4>Divisions</h4>
      {record.divisions.length ? (
        <ul>
          {record.divisions.map((division) => (
            <li key={division.id}>{division.name}</li>
          ))}
        </ul>
      ) : (
        <p>No divisions in this example.</p>
      )}
      <h4>Issue Categories & service definitions</h4>
      {record.categories.length ? (
        record.categories.map((category) => (
          <div className="department-relationship" key={category.name}>
            <strong>{category.name}</strong>
            <p>
              {category.divisionId
                ? `Division: ${record.divisions.find((division) => division.id === category.divisionId)?.name}`
                : "Directly under this Department; no Division."}
            </p>
            <ul>
              {category.services.map((name) => (
                <li key={name}>
                  {name}{" "}
                  <span className="text-body-secondary">
                    · Service definition
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))
      ) : (
        <p>No Issue Categories or service definitions in this example.</p>
      )}
      <h4>Operational routing</h4>
      <p>
        Unavailable. These examples do not establish live routing, staff scope,
        assignments or operational work groups. Relationship changes are not
        available.
      </p>
    </section>
  );
}

// Mounted only after the existing Admin Configuration read authorization succeeds.
export default function DepartmentsConfiguration({
  previewFactory = createDepartmentPreview,
}) {
  const dataRouter = useContext(UNSAFE_DataRouterContext);
  const [records, setRecords] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("order");
  const [panel, setPanel] = useState(null);
  const [draft, setDraft] = useState(departmentDraft());
  const [errors, setErrors] = useState({});
  const [confirmation, setConfirmation] = useState(false);
  const [notice, setNotice] = useState("");
  const origin = useRef(null);
  const form = useRef(null);
  const directoryHeading = useRef(null);
  const dirty =
    panel?.mode === "edit" &&
    JSON.stringify(draft) !== JSON.stringify(departmentDraft(panel.record));
  useEffect(() => {
    if (!dirty) return;
    const warn = (event) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
  const close = () => {
    setPanel(null);
    setConfirmation(false);
    setErrors({});
    requestAnimationFrame(() => {
      if (origin.current?.isConnected) origin.current.focus();
      else directoryHeading.current?.focus();
    });
  };
  const requestClose = () => (dirty ? setConfirmation(true) : close());
  const open = (record, mode, trigger) => {
    origin.current = trigger;
    setPanel({ record, mode });
    setDraft(departmentDraft(record));
    setErrors({});
    setNotice("");
  };
  const preview = (event) => {
    event.preventDefault();
    const nextErrors = departmentErrors(draft, records, panel.record?.id);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      form.current?.elements.namedItem(Object.keys(nextErrors)[0])?.focus();
      return;
    }
    const record = {
      ...(panel.record ?? {
        id: `preview-${crypto.randomUUID()}`,
        divisions: [],
        categories: [],
      }),
      name: draft.name.trim(),
      description: draft.description.trim(),
      status: draft.status,
      displayOrder: Number(draft.displayOrder),
    };
    setRecords((previous) =>
      panel.record
        ? previous.map((item) => (item.id === record.id ? record : item))
        : [...previous, record],
    );
    setNotice(
      `Local preview updated for ${record.name}. Nothing was saved to a server. Leaving Departments or reloading discards this preview.`,
    );
    close();
  };
  const visible = (records ?? [])
    .filter(
      (record) =>
        (status === "all" || record.status === status) &&
        `${record.name} ${record.description}`
          .toLocaleLowerCase()
          .includes(search.trim().toLocaleLowerCase()),
    )
    .sort((a, b) => {
      const names = a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
      return sort === "name-desc"
        ? -names
        : sort === "name"
          ? names
          : a.displayOrder - b.displayOrder || names;
    });

  return (
    <div className="departments-workspace">
      <p>
        Organize municipal departments and inspect their service relationships.
      </p>
      <div className="department-boundary" role="note">
        <strong>
          {records
            ? "Fictional preview · No changes are saved"
            : "Live department administration is unavailable"}
        </strong>
        <p className="mb-0">
          An authorized Department management API is not connected.{" "}
          {records
            ? "All departments, counts and relationships below are fictional. Changes exist only in this page’s memory and are discarded when you leave or reload."
            : "Open fictional examples to explore the interface. They are separate from your Organization’s records."}
        </p>
      </div>
      {!records ? (
        <section className="department-empty">
          <i className="bi bi-buildings" aria-hidden="true" />
          <h2>Department directory not connected</h2>
          <p>
            Live records and authoritative relationships cannot be displayed
            yet.
          </p>
          <button
            className="btn btn-primary"
            onClick={() => setRecords(previewFactory())}
          >
            Open fictional preview
          </button>
        </section>
      ) : (
        <>
          <dl
            className="department-summary"
            aria-label="Fictional department counts"
          >
            {[
              ["Total departments", records.length],
              ...departmentStatuses.map((value) => [
                statusLabel(value),
                records.filter((record) => record.status === value).length,
              ]),
            ].map(([label, count]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd>{count}</dd>
              </div>
            ))}
          </dl>
          <div className="department-directory-header">
            <div>
              <h2 ref={directoryHeading} tabIndex={-1}>
                Fictional department directory
              </h2>
              <p>Explore details or preview a configuration change.</p>
            </div>
            <button
              className="btn btn-primary"
              onClick={(event) => open(null, "edit", event.currentTarget)}
            >
              Create department preview
            </button>
          </div>
          <div className="department-controls">
            <label>
              Search departments
              <input
                className="form-control"
                type="search"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Search name or description"
              />
            </label>
            <label>
              Department status
              <select
                className="form-select"
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="all">All statuses</option>
                {departmentStatuses.map((value) => (
                  <option key={value} value={value}>
                    {statusLabel(value)}
                  </option>
                ))}
              </select>
            </label>
            <label>
              Sort departments
              <select
                className="form-select"
                value={sort}
                onChange={(event) => setSort(event.target.value)}
              >
                <option value="order">Display order</option>
                <option value="name">Name: A–Z</option>
                <option value="name-desc">Name: Z–A</option>
              </select>
            </label>
          </div>
          <p role="status">
            {visible.length} of {records.length} fictional departments shown.{" "}
            {notice}
          </p>
          {!visible.length ? (
            <section className="department-empty">
              <h3>
                {records.length
                  ? "No matching departments"
                  : "No departments in this preview"}
              </h3>
              <p>
                {records.length
                  ? "Try another name or status."
                  : "Create a local preview to explore department fields."}
              </p>
              {records.length > 0 && (
                <button
                  className="btn btn-outline-primary"
                  onClick={() => {
                    setSearch("");
                    setStatus("all");
                  }}
                >
                  Clear filters
                </button>
              )}
            </section>
          ) : (
            <ul className="department-directory">
              {visible.map((record) => (
                <li key={record.id}>
                  <div className="department-card-heading">
                    <h3>{record.name}</h3>
                    <span
                      className={`department-status department-status--${record.status}`}
                    >
                      {statusLabel(record.status)}
                    </span>
                  </div>
                  <p>{record.description || "No description provided."}</p>
                  <p className="text-body-secondary">
                    {relationshipCount(
                      record.divisions.length,
                      "division",
                      "divisions",
                    )}{" "}
                    ·{" "}
                    {relationshipCount(
                      record.categories.length,
                      "category",
                      "categories",
                    )}{" "}
                    · Display order {record.displayOrder}
                  </p>
                  <div className="d-flex flex-wrap gap-2">
                    <button
                      className="btn btn-outline-primary"
                      aria-label={`View ${record.name}`}
                      onClick={(event) =>
                        open(record, "view", event.currentTarget)
                      }
                    >
                      View details
                    </button>
                    <button
                      className="btn btn-outline-secondary"
                      aria-label={`Edit preview for ${record.name}`}
                      onClick={(event) =>
                        open(record, "edit", event.currentTarget)
                      }
                    >
                      Edit preview
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
      {panel && (
        <IssueDrawer
          title={
            panel.mode === "view"
              ? panel.record.name
              : panel.record
                ? "Edit department preview"
                : "Create department preview"
          }
          subtitle="Fictional example · Nonpersistent preview"
          onClose={requestClose}
        >
          {panel.mode === "view" ? (
            <>
              <p>{panel.record.description || "No description provided."}</p>
              <p>
                <strong>Status:</strong> {statusLabel(panel.record.status)} ·{" "}
                <strong>Display order:</strong> {panel.record.displayOrder}
              </p>
              <Relationships record={panel.record} />
            </>
          ) : (
            <form ref={form} onSubmit={preview} noValidate>
              <p>
                No server changes are possible. Preview only updates the
                fictional directory on this page.
              </p>
              {dirty && <p role="status">Unsaved preview changes</p>}
              {Object.keys(errors).length > 0 && (
                <p role="alert">
                  Review the highlighted fields before previewing.
                </p>
              )}
              <div className="department-fields">
                <label htmlFor="department-name">
                  Department name <span>(required)</span>
                </label>
                <input
                  id="department-name"
                  name="name"
                  className="form-control"
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                  aria-invalid={!!errors.name}
                  aria-describedby="department-name-help department-name-error"
                  required
                />
                <small id="department-name-help">
                  Up to 200 characters. Names must be unique within this
                  fictional preview.
                </small>
                <span
                  id="department-name-error"
                  className="department-field-error"
                >
                  {errors.name}
                </span>
                <label htmlFor="department-description">Description</label>
                <textarea
                  id="department-description"
                  name="description"
                  className="form-control"
                  rows={4}
                  value={draft.description}
                  onChange={(event) =>
                    setDraft({ ...draft, description: event.target.value })
                  }
                />
                <label htmlFor="department-status">Status</label>
                <select
                  id="department-status"
                  name="status"
                  className="form-select"
                  value={draft.status}
                  onChange={(event) =>
                    setDraft({ ...draft, status: event.target.value })
                  }
                  aria-invalid={!!errors.status}
                  aria-describedby="department-status-error"
                >
                  {departmentStatuses.map((value) => (
                    <option key={value} value={value}>
                      {statusLabel(value)}
                    </option>
                  ))}
                </select>
                <span
                  id="department-status-error"
                  className="department-field-error"
                >
                  {errors.status}
                </span>
                <label htmlFor="department-order">Display order</label>
                <input
                  id="department-order"
                  name="displayOrder"
                  className="form-control"
                  type="number"
                  min="0"
                  max="2147483647"
                  step="1"
                  value={draft.displayOrder}
                  onChange={(event) =>
                    setDraft({ ...draft, displayOrder: event.target.value })
                  }
                  aria-invalid={!!errors.displayOrder}
                  aria-describedby="department-order-help department-order-error"
                />
                <small id="department-order-help">
                  Lower numbers appear first in display-order sorting.
                </small>
                <span
                  id="department-order-error"
                  className="department-field-error"
                >
                  {errors.displayOrder}
                </span>
              </div>
              <div className="d-flex flex-wrap gap-2 my-4">
                <button type="submit" className="btn btn-primary">
                  Apply local preview
                </button>
                <button
                  type="button"
                  className="btn btn-outline-secondary"
                  onClick={requestClose}
                >
                  Cancel
                </button>
              </div>
              {panel.record ? (
                <Relationships record={panel.record} />
              ) : (
                <p>
                  Divisions, Categories and service definitions cannot be added
                  or linked in this preview.
                </p>
              )}
            </form>
          )}
        </IssueDrawer>
      )}
      {confirmation && (
        <Confirmation
          title="Discard unsaved preview changes?"
          cancelLabel="Keep editing"
          confirmLabel="Discard changes"
          onCancel={() => setConfirmation(false)}
          onConfirm={close}
          returnFocus={document.activeElement}
        >
          <p>Your draft will be discarded. No server changes have been made.</p>
        </Confirmation>
      )}
      {dataRouter && <DraftNavigationGuard dirty={!!dirty} />}
    </div>
  );
}
