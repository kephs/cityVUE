import { useEffect, useId, useRef, useState } from "react";

/** Bounded creation lookup; the parent owns selection so stale/declined reviews cannot select a source. */
export default function IssueCreationPicker({
  client,
  endpoint,
  label,
  selection,
  disabled,
  onSelect,
  onClear,
  onDenied,
  inputRef,
}) {
  const id = useId(),
    input = useRef(null),
    change = useRef(null),
    [search, setSearch] = useState(""),
    [items, setItems] = useState([]),
    [open, setOpen] = useState(false),
    [active, setActive] = useState(-1),
    [loading, setLoading] = useState(false),
    [error, setError] = useState(false),
    [more, setMore] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setItems([]);
    setActive(-1);
    setError(false);
    setLoading(false);
    if (disabled || selection || !endpoint) return;
    const abort = new AbortController();
    setLoading(true);
    const timer = setTimeout(
      () =>
        client
          .get(
            `${endpoint}${endpoint.includes("?") ? "&" : "?"}search=${encodeURIComponent(search.trim())}`,
            { authenticated: true, signal: abort.signal },
          )
          .then(
            (result) => {
              if (abort.signal.aborted) return;
              setItems(result.items);
              setMore(result.hasMore);
              setLoading(false);
            },
            (failure) => {
              if (abort.signal.aborted) return;
              setLoading(false);
              setError(true);
              if ([401, 403].includes(failure.status)) onDenied();
            },
          ),
      300,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [client, endpoint, search, selection, disabled, attempt, onDenied]);
  function choose(item) {
    if (disabled) return;
    setOpen(false);
    onSelect(item);
    requestAnimationFrame(() => (change.current || input.current)?.focus());
  }
  return (
    <div className="issue-template-picker">
      <label htmlFor={id}>{label}</label>
      {selection ? (
        <div className="issue-template-selection">
          <span>
            <strong>{selection.name}</strong>
            <br />
            {selection.category ||
              [selection.department, selection.division]
                .filter(Boolean)
                .join(" / ")}
          </span>
          <button
            ref={change}
            type="button"
            className="btn btn-outline-secondary"
            disabled={disabled}
            onClick={() => {
              onClear();
              setSearch("");
              setOpen(true);
              requestAnimationFrame(() => input.current?.focus());
            }}
          >
            Change {label}
          </button>
        </div>
      ) : (
        <>
          <input
            id={id}
            ref={(node) => {
              input.current = node;
              if (inputRef) inputRef.current = node;
            }}
            role="combobox"
            className="form-control"
            autoComplete="off"
            aria-expanded={open}
            aria-controls={`${id}-options`}
            aria-autocomplete="list"
            aria-activedescendant={
              open && active >= 0 ? `${id}-${active}` : undefined
            }
            aria-describedby={`${id}-status`}
            value={search}
            maxLength={100}
            disabled={disabled || !endpoint}
            onFocus={() => setOpen(true)}
            onBlur={() => setOpen(false)}
            onChange={(e) => {
              setSearch(e.target.value);
              setOpen(true);
              setActive(-1);
            }}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                e.preventDefault();
                e.stopPropagation();
                setOpen(false);
              }
              if (["ArrowDown", "ArrowUp"].includes(e.key)) {
                e.preventDefault();
                setOpen(true);
                setActive((n) =>
                  items.length
                    ? (n + (e.key === "ArrowDown" ? 1 : -1) + items.length) %
                      items.length
                    : -1,
                );
              }
              if (e.key === "Enter") {
                e.preventDefault();
                if (open && items[active]) choose(items[active]);
              }
            }}
          />
          {open && (
            <ul
              id={`${id}-options`}
              role="listbox"
              aria-label={`${label} results`}
              className="issue-template-options"
            >
              {items.map((item, i) => (
                <li
                  key={item.id}
                  id={`${id}-${i}`}
                  role="option"
                  aria-selected={active === i}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => choose(item)}
                >
                  <strong>{item.name}</strong>
                  <span>
                    {item.category ||
                      [item.department, item.division]
                        .filter(Boolean)
                        .join(" / ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p id={`${id}-status`} role="status">
            {loading
              ? "Searching…"
              : error
                ? "Search could not be loaded."
                : !endpoint
                  ? "Select a Category first."
                  : !items.length
                    ? "No eligible results match your search."
                    : more
                      ? "Keep typing to narrow the results."
                      : `${items.length} eligible results found.`}
          </p>
          {error && (
            <button
              type="button"
              className="btn btn-outline-secondary"
              onClick={() => setAttempt((n) => n + 1)}
            >
              Retry {label}
            </button>
          )}
        </>
      )}
    </div>
  );
}
