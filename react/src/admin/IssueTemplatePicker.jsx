import { useEffect, useId, useRef, useState } from "react";

export default function IssueTemplatePicker({
  client,
  disabled,
  onChange,
  onDenied,
}) {
  const id = useId(),
    input = useRef(null);
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState(null),
    [items, setItems] = useState([]),
    [expanded, setExpanded] = useState(false),
    [active, setActive] = useState(-1),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(false),
    [more, setMore] = useState(false),
    [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (selected) return;
    const abort = new AbortController();
    setLoading(true);
    setError(false);
    setItems([]);
    setActive(-1);
    const timer = setTimeout(() => {
      client
        .get(
          `/admin/issues/templates?${new URLSearchParams({ search: search.trim() })}`,
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
        );
    }, 300);
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [client, search, selected, attempt, onDenied]);
  function choose(item) {
    setSelected(item);
    setExpanded(false);
    onChange(item.id);
  }
  const change = useRef(null);
  useEffect(() => {
    if (selected) change.current?.focus();
  }, [selected]);
  return (
    <div className="issue-template-picker">
      <label htmlFor={id}>Intake template</label>
      {selected ? (
        <div className="issue-template-selection">
          <span>
            <strong>{selected.name}</strong>
            <br />
            {selected.category}
          </span>
          <button
            ref={change}
            type="button"
            className="btn btn-outline-primary"
            disabled={disabled}
            onClick={() => {
              setSelected(null);
              setSearch("");
              onChange("");
              setExpanded(true);
              requestAnimationFrame(() => input.current?.focus());
            }}
          >
            Change template
          </button>
        </div>
      ) : (
        <>
          <input
            ref={input}
            id={id}
            role="combobox"
            className="form-control"
            autoComplete="off"
            aria-expanded={expanded}
            aria-controls={`${id}-options`}
            aria-autocomplete="list"
            aria-activedescendant={
              expanded && active >= 0 ? `${id}-option-${active}` : undefined
            }
            aria-describedby={`${id}-help`}
            value={search}
            maxLength={100}
            disabled={disabled}
            onFocus={() => setExpanded(true)}
            onBlur={() => setExpanded(false)}
            onChange={(event) => {
              setSearch(event.target.value);
              setExpanded(true);
              setActive(-1);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault();
                setExpanded(false);
              }
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setExpanded(true);
                setActive((old) =>
                  items.length
                    ? (old +
                        (event.key === "ArrowDown" ? 1 : -1) +
                        items.length) %
                      items.length
                    : -1,
                );
              }
              if (event.key === "Enter") {
                event.preventDefault();
                if (expanded && items[active]) choose(items[active]);
              }
            }}
          />
          {expanded && (
            <ul
              id={`${id}-options`}
              role="listbox"
              aria-label="Intake templates"
              className="issue-template-options"
            >
              {items.map((item, index) => (
                <li
                  key={item.id}
                  id={`${id}-option-${index}`}
                  role="option"
                  aria-selected={index === active}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => choose(item)}
                >
                  <strong>{item.name}</strong>
                  <span>{item.category}</span>
                </li>
              ))}
            </ul>
          )}
          <div role="status">
            {loading
              ? "Finding templates…"
              : !error && !items.length
                ? "No eligible templates match your search."
                : more
                  ? "Keep typing to narrow the results."
                  : `${items.length} eligible templates found.`}
          </div>
          {error && (
            <p role="alert">
              Templates could not be loaded.{" "}
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => setAttempt((n) => n + 1)}
              >
                Retry templates
              </button>
            </p>
          )}
        </>
      )}
      <p id={`${id}-help`}>
        Search by Issue or Category name. Copies the Category and intake
        form/settings once; later template changes do not affect the new Issue.
      </p>
    </div>
  );
}
