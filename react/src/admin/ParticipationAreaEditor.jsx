import { useEffect, useRef, useState } from "react";

function DeactivationDialog({ area, busy, onCancel, onConfirm, returnFocus }) {
  const ref = useRef(null);
  useEffect(() => {
    const dialog = ref.current;
    dialog.showModal();
    return () => {
      dialog.close();
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="configuration-dialog"
      aria-labelledby="area-deactivate-title"
      aria-describedby="area-deactivate-help"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <h2 id="area-deactivate-title">Deactivate {area.name}?</h2>
      <p id="area-deactivate-help">
        Requesters will no longer be able to choose this area. Existing
        responses and historical analytics will be kept. You can activate it
        again later.
      </p>
      <div className="d-flex flex-wrap gap-2 justify-content-end">
        <button
          className="btn btn-secondary"
          autoFocus
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button className="btn btn-primary" disabled={busy} onClick={onConfirm}>
          {busy ? "Saving…" : "Deactivate area"}
        </button>
      </div>
    </dialog>
  );
}

export default function ParticipationAreaEditor({
  client,
  areas,
  collection,
  canWrite,
  onSaved,
  onRefresh,
  onDenied,
  onDirtyChange,
  onBusyChange,
  notice,
  refreshing = false,
}) {
  const [edit, setEdit] = useState(null),
    [value, setValue] = useState("");
  const [confirm, setConfirm] = useState(null),
    [busy, setBusy] = useState(false);
  const [error, setError] = useState(null),
    [blocked, setBlocked] = useState(false),
    [denied, setDenied] = useState(false);
  const returnFocus = useRef(null),
    restoreEditFocus = useRef(false),
    mounted = useRef(true),
    inFlight = useRef(null),
    field = useRef(null),
    feedback = useRef(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      inFlight.current?.abort();
    };
  }, []);
  useEffect(() => {
    if (edit) field.current?.focus();
    else if (restoreEditFocus.current) {
      restoreEditFocus.current = false;
      if (returnFocus.current?.isConnected) returnFocus.current.focus();
    }
  }, [edit]);
  useEffect(() => {
    if (error) feedback.current?.focus();
  }, [error]);
  const areaElements = useRef(new Map()),
    noticeElement = useRef(null);
  useEffect(() => {
    onDirtyChange?.(!!edit);
  }, [edit, onDirtyChange]);
  useEffect(() => {
    onBusyChange?.(busy);
  }, [busy, onBusyChange]);
  useEffect(() => {
    if (notice)
      (
        areaElements.current.get(notice.areaId) || noticeElement.current
      )?.focus();
  }, [notice]);
  const writable = canWrite && !denied;
  const normalized = value.trim();
  const valid =
    edit?.type === "order"
      ? /^-?\d+$/.test(value) &&
        Number(value) >= -2147483648 &&
        Number(value) <= 2147483647
      : normalized.length > 0 &&
        [...normalized].length <= 120 &&
        !/[\p{Cc}\p{Cs}\p{Cf}]/u.test(normalized);
  const dirty =
    edit?.type === "add" ||
    (edit?.type === "order"
      ? Number(value) !== edit.area.displayOrder
      : normalized !== edit?.area.name);
  function open(type, area, event) {
    returnFocus.current = event.currentTarget;
    setError(null);
    setEdit({ type, area });
    setValue(
      type === "add"
        ? ""
        : type === "order"
          ? String(area.displayOrder)
          : area.name,
    );
  }
  function cancel() {
    restoreEditFocus.current = true;
    setEdit(null);
    setError(null);
  }
  async function save(area, body, notice) {
    if (inFlight.current || !writable || blocked) return;
    const controller = new AbortController();
    inFlight.current = controller;
    setBusy(true);
    setError(null);
    try {
      const options = { authenticated: true, signal: controller.signal };
      const result = area
        ? await client.patch(
            `/admin/participation-areas/${encodeURIComponent(area.id)}`,
            { ...body, expectedRevision: area.revision },
            options,
          )
        : await client.post("/admin/participation-areas", body, options);
      if (!mounted.current || controller.signal.aborted) return;
      setConfirm(null);
      setEdit(null);
      await onSaved(
        result,
        result.changed ? notice : "Participation Area is unchanged.",
      );
    } catch (failure) {
      if (!mounted.current || controller.signal.aborted) return;
      setConfirm(null);
      if ([401, 403].includes(failure.status)) {
        setDenied(true);
        setEdit(null);
        setValue("");
        onDenied?.(failure.status);
      }
      if (![400, 401, 403].includes(failure.status)) setBlocked(true);
      setError(
        failure.status === 409
          ? "This Participation Area changed since you opened it. Refresh the latest configuration before trying again."
          : failure.status === 403
            ? "You are not authorized to manage Participation Areas."
            : failure.status === 401
              ? "Your staff session has expired. Please sign in again."
              : failure.code === "PARTICIPATION_AREA_DUPLICATE"
                ? "A Participation Area with this name already exists. Inactive names remain reserved; reactivate the existing area to use that name again."
                : failure.code === "PARTICIPATION_AREA_LAST_ACTIVE"
                  ? "Turn off Service Participation first if you want to deactivate the last active area."
                  : failure.status === 400
                    ? "Check the name or display order. The Participation Area could not be saved."
                    : failure.status === 404
                      ? "Participation Area is unavailable. Refresh the configuration."
                      : "The change could not be confirmed. Refresh to check the current configuration before retrying.",
      );
    } finally {
      inFlight.current = null;
      if (mounted.current) setBusy(false);
    }
  }
  return (
    <section
      className="participation-section"
      id="participation-areas"
      aria-labelledby="participation-areas-title"
    >
      <div className="participation-section-heading">
        <div>
          <h2 id="participation-areas-title">Participation Areas</h2>
          <p>Choose the areas requesters can select.</p>
        </div>
        <span className="participation-count">
          {areas.active} active
          {areas.total > areas.active
            ? ` • ${areas.total - areas.active} inactive`
            : ""}
        </span>
      </div>
      {!collection.enabled && (
        <p className="participation-context">
          Areas are kept for future use and historical records.
        </p>
      )}
      <p className="participation-order-help">
        Lower numbers appear first. Areas with the same number are sorted by
        name.
      </p>
      {collection.enabled && areas.active === 0 && (
        <p role="alert" className="configuration-warning">
          Service Participation is On, but no active areas are available. Add or
          reactivate an area, or turn Service Participation off.
        </p>
      )}
      {!areas.total && <p>No Participation Areas are configured.</p>}
      {notice && (
        <p
          ref={noticeElement}
          tabIndex="-1"
          role="status"
          className="participation-notice"
        >
          {notice.message}
        </p>
      )}
      {writable && (
        <button
          className="btn btn-primary mb-3"
          disabled={busy || refreshing || blocked || !!edit}
          onClick={(e) => open("add", null, e)}
        >
          <span aria-hidden="true">+ </span>Add area
        </button>
      )}
      {edit && writable && (
        <form
          className="configuration-area-form mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (valid && dirty)
              save(
                edit.area,
                edit.type === "order"
                  ? { displayOrder: Number(value) }
                  : { displayName: normalized },
                edit.type === "add"
                  ? "Participation Area added."
                  : edit.type === "order"
                    ? "Order updated."
                    : "Participation Area renamed.",
              );
          }}
        >
          <h3>
            {edit.type === "add"
              ? "Add Participation Area"
              : edit.type === "order"
                ? `Change order for ${edit.area.name}`
                : `Rename ${edit.area.name}`}
          </h3>
          <label className="form-label" htmlFor="area-edit-value">
            {edit.type === "order"
              ? "Display order"
              : "Participation Area name"}
          </label>
          <input
            ref={field}
            id="area-edit-value"
            className="form-control"
            type={edit.type === "order" ? "number" : "text"}
            {...(edit.type === "order"
              ? { min: -2147483648, max: 2147483647, step: 1 }
              : {})}
            value={value}
            required
            disabled={busy || blocked}
            aria-invalid={!valid || undefined}
            aria-describedby="area-form-help area-form-validation area-feedback"
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
          />
          <p id="area-form-help">
            {edit.type === "order"
              ? "Use a whole number. Only this area's order changes."
              : "Use 1–120 characters. Names must be unique, including inactive areas, regardless of capitalization."}{" "}
            Refresh asks before discarding this edit.
          </p>
          <p id="area-form-validation">
            {!valid
              ? edit.type === "order"
                ? "Enter a whole number from −2147483648 to 2147483647."
                : "Enter a plain-text name of 1–120 characters."
              : ""}
          </p>
          {edit.type === "add" && <p>New areas are active.</p>}
          <div className="d-flex flex-wrap gap-2">
            <button
              className="btn btn-primary"
              disabled={busy || blocked || !valid || !dirty}
            >
              {busy ? "Saving…" : "Save area"}
            </button>
            <button
              type="button"
              className="btn btn-secondary"
              disabled={busy}
              onClick={cancel}
            >
              Cancel edit
            </button>
          </div>
        </form>
      )}
      <div id="area-feedback" tabIndex="-1" ref={feedback}>
        {error && (
          <>
            <p role="alert">{error}</p>
            <button
              className="btn btn-outline-primary mb-3"
              disabled={busy}
              onClick={onRefresh}
            >
              Refresh latest areas
            </button>
          </>
        )}
      </div>
      <ul className="configuration-cards participation-area-list">
        {areas.items.map((area) => (
          <li
            key={area.id}
            tabIndex="-1"
            ref={(el) => {
              if (el) areaElements.current.set(area.id, el);
              else areaElements.current.delete(area.id);
            }}
            aria-label={area.name}
          >
            <div className="participation-area-heading">
              <h3>{area.name}</h3>
              <span
                className={
                  area.active
                    ? "participation-state is-active"
                    : "participation-state"
                }
              >
                {area.active ? "Active" : "Inactive"}
              </span>
            </div>
            <p className="participation-order">Order {area.displayOrder}</p>
            {writable && (
              <div className="d-flex flex-wrap gap-2">
                <button
                  className="btn btn-outline-primary"
                  disabled={busy || refreshing || blocked || !!edit}
                  aria-label={`Rename ${area.name}`}
                  onClick={(e) => open("rename", area, e)}
                >
                  Rename
                </button>
                <button
                  className="btn btn-outline-primary"
                  disabled={busy || refreshing || blocked || !!edit}
                  aria-label={`Change order for ${area.name}`}
                  onClick={(e) => open("order", area, e)}
                >
                  Change order
                </button>
                <button
                  className="btn btn-outline-primary"
                  disabled={
                    busy ||
                    refreshing ||
                    blocked ||
                    !!edit ||
                    (area.active && collection.enabled && areas.active === 1)
                  }
                  aria-label={`${area.active ? "Deactivate" : "Activate"} ${area.name}`}
                  onClick={(e) => {
                    returnFocus.current = e.currentTarget;
                    if (area.active) setConfirm(area);
                    else
                      save(
                        area,
                        { active: true },
                        "Participation Area activated.",
                      );
                  }}
                >
                  {area.active ? "Deactivate" : "Activate"}
                </button>
              </div>
            )}
            {writable &&
              area.active &&
              collection.enabled &&
              areas.active === 1 && (
                <p>
                  Turn off Service Participation first if you want to deactivate
                  the last active area.
                </p>
              )}
          </li>
        ))}
      </ul>
      {confirm && (
        <DeactivationDialog
          area={confirm}
          busy={busy}
          returnFocus={returnFocus}
          onCancel={() => setConfirm(null)}
          onConfirm={() =>
            save(confirm, { active: false }, "Participation Area deactivated.")
          }
        />
      )}
    </section>
  );
}
