import { useEffect, useState } from "react";

export function createParticipationRepository(client) {
  return {
    async areas(signal) {
      const data = await client.get("/intake/participation-areas", { signal });
      if (
        typeof data?.collectionEnabled !== "boolean" ||
        !Array.isArray(data?.items) ||
        data.items.some(
          (x) => typeof x.id !== "string" || typeof x.label !== "string",
        )
      )
        throw new Error("Invalid areas");
      return {
        collectionEnabled: data.collectionEnabled,
        items: data.items.map(({ id, label }) => ({ id, label })),
      };
    },
  };
}
export default function ParticipationInput({
  repository,
  value,
  onChange,
  onAvailabilityChange,
}) {
  const [state, setState] = useState({ loading: true });
  useEffect(() => {
    const controller = new AbortController();
    setState({ loading: true });
    repository.areas(controller.signal).then(
      (configuration) => {
        if (!controller.signal.aborted) setState(configuration);
      },
      () => {
        if (!controller.signal.aborted) setState({ error: true });
      },
    );
    return () => controller.abort();
  }, [repository]);
  const available = state.collectionEnabled === true && state.items?.length > 0;
  useEffect(() => {
    onAvailabilityChange?.(Boolean(available));
  }, [available, onAvailabilityChange]);
  useEffect(() => {
    if (!state.loading && !available && value !== undefined)
      onChange(undefined);
  }, [state, available, value, onChange]);
  if (!available) return null;
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
      <label className="form-label" htmlFor="participation-area">
        Which area do you associate with this service request? (Optional)
      </label>
      <select
        id="participation-area"
        className="form-select"
        aria-describedby="participation-help"
        value={value?.state === "DECLINED" ? "declined" : value?.areaId || ""}
        onChange={(e) => {
          const selected = e.target.value;
          onChange(
            selected === "declined"
              ? { state: "DECLINED" }
              : selected
                ? {
                    state: "PROVIDED",
                    areaId: selected,
                    label: state.items.find((x) => x.id === selected)?.label,
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
    </section>
  );
}
