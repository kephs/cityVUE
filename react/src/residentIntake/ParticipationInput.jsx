import { useEffect, useState } from "react";

export function createParticipationRepository(client) {
  return {
    async areas(signal) {
      const data = await client.get("/intake/participation-areas", { signal });
      if (
        !Array.isArray(data?.items) ||
        data.items.some(
          (x) => typeof x.id !== "string" || typeof x.label !== "string",
        )
      )
        throw new Error("Invalid areas");
      return data.items.map(({ id, label }) => ({ id, label }));
    },
  };
}
export default function ParticipationInput({ repository, value, onChange }) {
  const [state, setState] = useState({ loading: true });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    repository.areas(controller.signal).then(
      (items) => {
        if (!controller.signal.aborted) setState({ items });
      },
      () => {
        if (!controller.signal.aborted) setState({ error: true });
      },
    );
    return () => controller.abort();
  }, [repository, attempt]);
  return (
    <section className="mb-4" aria-labelledby="participation-heading">
      <h3 id="participation-heading" className="h5">
        Optional service participation
      </h3>
      <p id="participation-help">
        Your answer is optional and helps us understand service participation.
        It does not change or derive from Service Location. You can provide an
        area when submitting anonymously.
      </p>
      {state.loading ? (
        <p role="status">Loading participation areas…</p>
      ) : state.error ? (
        <div>
          <p role="status">
            Participation areas are unavailable. You can submit without this
            optional information.
          </p>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => setAttempt(attempt + 1)}
          >
            Retry participation areas
          </button>
        </div>
      ) : (
        <>
          <label className="form-label" htmlFor="participation-area">
            Which area do you associate with this service request? (Optional)
          </label>
          <select
            id="participation-area"
            className="form-select"
            aria-describedby="participation-help"
            value={
              value?.state === "DECLINED" ? "declined" : value?.areaId || ""
            }
            onChange={(e) => {
              const selected = e.target.value;
              onChange(
                selected === "declined"
                  ? { state: "DECLINED" }
                  : selected
                    ? {
                        state: "PROVIDED",
                        areaId: selected,
                        label: state.items.find((x) => x.id === selected)
                          ?.label,
                      }
                    : undefined,
              );
            }}
          >
            <option value="">No selection</option>
            <option value="declined">Prefer not to say</option>
            {state.items.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </select>
        </>
      )}
    </section>
  );
}
