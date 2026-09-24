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
        Requesters will no longer be able to select this area on new Service
        Requests. Existing requests and historical analytics will be preserved.
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
      onSaved(
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
                  ? "At least one active Participation Area is required while Service Participation collection is enabled. First disable collection in Intake Settings."
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
    <section aria-label="Participation Area configuration">
      <p>
        Collection:{" "}
        <strong>{collection.enabled ? "Enabled" : "Disabled"}</strong>.{" "}
        {areas.active} active areas; {areas.total - areas.active} inactive. Area
        configuration does not identify requesters or show participation counts.
      </p>
      <p>
        Lower display-order values appear first. Equal values sort by name.
        Inactive areas keep their place and their name. Changes do not enable or
        disable collection.
      </p>
      {collection.enabled && areas.active === 0 && (
        <p role="alert">
          Service Participation collection is enabled, but no active
          Participation Areas are available. Add or reactivate an area.
        </p>
      )}
      {!areas.total && <p>No Participation Areas are configured.</p>}
      {!writable && (
        <p>
          Participation Areas are read-only. Management requires Participation
          Area write permission.
        </p>
      )}
      {writable && (
        <button
          className="btn btn-primary mb-3"
          disabled={busy || blocked || !!edit}
          onClick={(e) => open("add", null, e)}
        >
          Add Participation Area
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
                    ? "Participation Area order updated."
                    : "Participation Area renamed.",
              );
          }}
        >
          <h2>
            {edit.type === "add"
              ? "Add Participation Area"
              : edit.type === "order"
                ? `Change display order for ${edit.area.name}`
                : `Rename ${edit.area.name}`}
          </h2>
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
            Refresh configuration discards this edit.
          </p>
          <p id="area-form-validation">
            {!valid
              ? edit.type === "order"
                ? "Enter a whole number from −2147483648 to 2147483647."
                : "Enter a plain-text name of 1–120 characters."
              : ""}
          </p>
          {edit.type === "add" && (
            <p>
              New areas are active. Service Participation collection remains{" "}
              {collection.enabled ? "enabled" : "disabled"}.
            </p>
          )}
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
      <ul className="configuration-cards">
        {areas.items.map((area) => (
          <li key={area.id}>
            <h2>{area.name}</h2>
            <details>
              <summary>Configuration details</summary>
              <dl>
                <dt>Area revision</dt>
                <dd>{area.revision}</dd>
              </dl>
            </details>
            <p>
              <strong>{area.active ? "Active" : "Inactive"}</strong> · Display
              order: {area.displayOrder}
            </p>
            {writable && (
              <div className="d-flex flex-wrap gap-2">
                <button
                  className="btn btn-outline-primary"
                  disabled={busy || blocked || !!edit}
                  aria-label={`Rename ${area.name}`}
                  onClick={(e) => open("rename", area, e)}
                >
                  Rename
                </button>
                <button
                  className="btn btn-outline-primary"
                  disabled={busy || blocked || !!edit}
                  aria-label={`Change display order for ${area.name}`}
                  onClick={(e) => open("order", area, e)}
                >
                  Change display order
                </button>
                <button
                  className="btn btn-outline-primary"
                  disabled={
                    busy ||
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
                  At least one active Participation Area is required while
                  Service Participation collection is enabled. First disable
                  collection in Intake Settings.
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
