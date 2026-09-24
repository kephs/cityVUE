import { useEffect, useRef, useState } from "react";
import IntakeCollectionEditor from "./IntakeCollectionEditor.jsx";
import ParticipationAreaEditor from "./ParticipationAreaEditor.jsx";

function DiscardDialog({ onCancel, onConfirm }) {
  const ref = useRef(null);
  useEffect(() => {
    const previous = document.activeElement;
    ref.current.showModal();
    return () => {
      ref.current?.close();
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="configuration-dialog"
      aria-labelledby="participation-discard-title"
      onCancel={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      <h2 id="participation-discard-title">Discard unsaved changes?</h2>
      <p>Refresh will replace your edits with the latest settings.</p>
      <div className="d-flex flex-wrap gap-2 justify-content-end">
        <button autoFocus className="btn btn-secondary" onClick={onCancel}>
          Keep editing
        </button>
        <button className="btn btn-primary" onClick={onConfirm}>
          Discard and refresh
        </button>
      </div>
    </dialog>
  );
}

// UI composition only: each resource keeps its own draft, revision, API and audit.
export default function ParticipationSetup({
  client,
  initial,
  onRefresh,
  onDenied,
}) {
  const [collection, setCollection] = useState(initial.collection);
  const [areas, setAreas] = useState(initial.participationAreas);
  const [capabilities, setCapabilities] = useState(initial.capabilities);
  const [collectionDirty, setCollectionDirty] = useState(false);
  const [areaDirty, setAreaDirty] = useState(false);
  const [collectionBusy, setCollectionBusy] = useState(false);
  const [areaBusy, setAreaBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [discard, setDiscard] = useState(null);
  const [areaKey, setAreaKey] = useState(0);
  const [areaNotice, setAreaNotice] = useState(null);
  const [collectionNotice, setCollectionNotice] = useState("");
  const pending = useRef(null);
  useEffect(() => () => pending.current?.abort(), []);
  async function loadAreas(page = areas.page) {
    pending.current?.abort();
    const controller = new AbortController();
    pending.current = controller;
    setLoading(true);
    setLoadError(false);
    try {
      const next = await client.get(
        `/admin/configuration?issuePage=1&areaPage=${page}`,
        { authenticated: true, signal: controller.signal },
      );
      if (controller.signal.aborted) return false;
      setAreas(next.participationAreas);
      setCapabilities(next.capabilities);
      // Do not replace collection or its unsaved draft after an area operation.
      return true;
    } catch {
      if (!controller.signal.aborted) {
        // Clear protected content and recheck read authority in the parent.
        setLoadError(true);
        onDenied();
      }
      return false;
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }
  function requestRefresh(action, dirty = collectionDirty || areaDirty) {
    if (dirty) setDiscard(() => action);
    else action();
  }
  return (
    <div className="participation-setup">
      <div className="participation-page-actions">
        <button
          className="btn btn-outline-primary"
          aria-label="Refresh Participation Setup"
          disabled={collectionBusy || areaBusy || loading}
          onClick={() => requestRefresh(onRefresh)}
        >
          Refresh
        </button>
      </div>
      <IntakeCollectionEditor
        client={client}
        collection={collection}
        activeAreas={areas.active}
        canWrite={capabilities?.canWriteIntakeSettings === true}
        notice={collectionNotice}
        onDirtyChange={setCollectionDirty}
        onBusyChange={setCollectionBusy}
        onDenied={onDenied}
        onRefresh={() => requestRefresh(onRefresh)}
        onSaved={(result) => {
          setCollection({ enabled: result.enabled, revision: result.revision });
          setCollectionNotice(
            result.changed
              ? `Service Participation turned ${result.enabled ? "on" : "off"}.`
              : "Service Participation is unchanged.",
          );
        }}
      />
      {!loadError && (
        <ParticipationAreaEditor
          key={areaKey}
          client={client}
          areas={areas}
          collection={collection}
          canWrite={capabilities?.canWriteParticipationAreas === true}
          notice={areaNotice}
          refreshing={loading}
          onDirtyChange={setAreaDirty}
          onBusyChange={setAreaBusy}
          onDenied={onDenied}
          onRefresh={() =>
            requestRefresh(async () => {
              if (await loadAreas()) {
                setAreaKey((k) => k + 1);
                setAreaNotice(null);
              }
            }, areaDirty)
          }
          onSaved={async (result, message) => {
            if (await loadAreas())
              setAreaNotice({ message, areaId: result.area.id });
          }}
        />
      )}
      {areas.total > areas.pageSize && (
        <nav
          className="d-flex flex-wrap gap-3 align-items-center"
          aria-label="Areas pages"
        >
          <button
            className="btn btn-outline-primary"
            disabled={areas.page <= 1 || areaBusy || loading}
            onClick={() =>
              requestRefresh(async () => {
                if (await loadAreas(areas.page - 1)) {
                  setAreaKey((k) => k + 1);
                  setAreaNotice(null);
                }
              }, areaDirty)
            }
          >
            Previous areas
          </button>
          <span>
            Page {areas.page} of {Math.ceil(areas.total / areas.pageSize)}
          </span>
          <button
            className="btn btn-outline-primary"
            disabled={
              areas.page * areas.pageSize >= areas.total || areaBusy || loading
            }
            onClick={() =>
              requestRefresh(async () => {
                if (await loadAreas(areas.page + 1)) {
                  setAreaKey((k) => k + 1);
                  setAreaNotice(null);
                }
              }, areaDirty)
            }
          >
            Next areas
          </button>
        </nav>
      )}
      {discard && (
        <DiscardDialog
          onCancel={() => setDiscard(null)}
          onConfirm={() => {
            const action = discard;
            setDiscard(null);
            action();
          }}
        />
      )}
    </div>
  );
}
