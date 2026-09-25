import { Component, lazy, Suspense, useEffect, useRef, useState } from "react";
import { toNeutralLocation } from "../map/geospatialData.js";
import {
  boundaryContains,
  LOCATION_DEBOUNCE_MS,
  LOCATION_QUERY_MIN,
  LOCATION_RESULT_LIMIT,
  normalizeLocationResult,
} from "./locationSearch.js";
import "./serviceLocation.css";
const LocationMap = lazy(() => import("./ServiceLocationMap.jsx"));
class MapFallback extends Component {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? (
      <p role="alert">The map is unavailable. Use search or manual entry.</p>
    ) : (
      this.props.children
    );
  }
}

export default function ServiceLocationInput({
  text,
  point,
  onChange,
  repository,
  required,
  geographicPolicy,
  error,
  MapComponent = LocationMap,
}) {
  const [config, setConfig] = useState(null),
    [query, setQuery] = useState(""),
    [results, setResults] = useState([]),
    [searchState, setSearchState] = useState("idle"),
    [searchAttempt, setSearchAttempt] = useState(0);
  const [editing, setEditing] = useState(false);
  const selected = useRef(null);
  const [device, setDevice] = useState(""),
    [pending, setPending] = useState(false),
    [manual, setManual] = useState({ latitude: "", longitude: "" }),
    [manualError, setManualError] = useState("");
  const generation = useRef(0),
    searchGeneration = useRef(0),
    alive = useRef(true),
    devicePending = useRef(false);
  useEffect(() => {
    alive.current = true;
    const controller = new AbortController();
    setConfig(null);
    repository
      ?.load({ signal: controller.signal })
      .then((value) => {
        if (!controller.signal.aborted) setConfig(value);
      })
      .catch(() => {
        if (!controller.signal.aborted) setConfig({});
      });
    return () => {
      alive.current = false;
      controller.abort();
      generation.current++;
    };
  }, [repository]);
  useEffect(() => {
    const sequence = ++searchGeneration.current,
      controller = new AbortController();
    setResults([]);
    if (query.trim().length < LOCATION_QUERY_MIN || !config?.search) {
      setSearchState("idle");
      return () => controller.abort();
    }
    setSearchState("loading");
    const timer = setTimeout(async () => {
      try {
        const rows = await config.search.search(query, {
          signal: controller.signal,
        });
        if (
          sequence === searchGeneration.current &&
          !controller.signal.aborted
        ) {
          setResults(
            rows
              .map(normalizeLocationResult)
              .filter(Boolean)
              .slice(0, LOCATION_RESULT_LIMIT),
          );
          setSearchState("ready");
        }
      } catch {
        if (sequence === searchGeneration.current && !controller.signal.aborted)
          setSearchState("error");
      }
    }, LOCATION_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, config, searchAttempt]);
  const choose = (candidate, label) => {
    const valid = toNeutralLocation([
      candidate?.longitude,
      candidate?.latitude,
    ]);
    generation.current++;
    searchGeneration.current++;
    setResults([]);
    setQuery("");
    setSearchState("idle");
    setManualError("");
    if (!valid) {
      setManualError("Enter valid latitude and longitude.");
      return;
    }
    setDevice("");
    onChange(label || "Selected Service Location", valid);
    setEditing(false);
  };
  const locate = () => {
    if (devicePending.current) return;
    if (!navigator.geolocation) {
      setDevice(
        "Device location is unavailable. Use search, map or manual entry.",
      );
      return;
    }
    const sequence = ++generation.current;
    devicePending.current = true;
    setPending(true);
    setDevice("Requesting your location…");
    const finish = () => {
      devicePending.current = false;
      if (alive.current) setPending(false);
    };
    try {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          finish();
          if (!alive.current || sequence !== generation.current) return;
          const valid = toNeutralLocation([
            position?.coords?.longitude,
            position?.coords?.latitude,
          ]);
          if (!valid) {
            setDevice(
              "Device location is unavailable. Use another location method.",
            );
            return;
          }
          choose(valid);
          setDevice(
            "Approximate device location selected. Check that this is where the issue is.",
          );
        },
        (failure) => {
          finish();
          if (!alive.current || sequence !== generation.current) return;
          setDevice(
            failure?.code === 1
              ? "Location permission was denied. Search, map and manual entry remain available."
              : failure?.code === 3
                ? "Finding your location timed out. Try again or use another method."
                : "Device location is unavailable. Use another location method.",
          );
        },
        { enableHighAccuracy: false, timeout: 10000, maximumAge: 0 },
      );
    } catch {
      finish();
      setDevice("Device location is unavailable. Use another location method.");
    }
  };
  const inside = boundaryContains(point, config?.boundary);
  return (
    <fieldset className="service-location">
      <legend>
        Find the Issue Location {required ? "(Required)" : "(Optional)"}
      </legend>
      <p>Choose where the issue is. Device location is optional.</p>
      {config?.synthetic && (
        <p className="prototype-notice">
          <strong>Development Notice</strong> Fictional locations and service
          area, without street tiles or authoritative addresses.
        </p>
      )}
      <label htmlFor="location-search" className="form-label">
        Search address or location
      </label>
      <input
        id="location-search"
        className="form-control"
        type="search"
        placeholder="Search for an address, intersection, or landmark"
        maxLength={200}
        value={query}
        disabled={!config?.search}
        onChange={(e) => {
          searchGeneration.current++;
          setQuery(e.target.value);
        }}
        aria-describedby="location-search-help"
      />
      <p id="location-search-help" className="form-text">
        {config?.search
          ? "Enter at least 3 characters. Tab to a result and press Enter to select."
          : "Address search is unavailable. Use manual entry below."}
      </p>
      <div role="status">
        {searchState === "loading"
          ? "Searching…"
          : searchState === "ready" && !results.length
            ? "No matches found. Try another search or enter the location manually."
            : ""}
      </div>
      {searchState === "error" && (
        <p role="alert">
          Search is unavailable. Use another method or{" "}
          <button
            type="button"
            className="btn btn-link"
            onClick={() => setSearchAttempt((attempt) => attempt + 1)}
          >
            Try search again
          </button>
          .
        </p>
      )}
      {!!results.length && (
        <ul className="location-results" aria-label="Location results">
          {results.map((result) => (
            <li key={result.id}>
              <button
                type="button"
                className="btn btn-outline-primary"
                onClick={() => {
                  choose(result, result.displayLabel);
                  requestAnimationFrame(() => selected.current?.focus());
                }}
              >
                {result.displayLabel}
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        className="btn btn-outline-primary location-device"
        type="button"
        disabled={pending}
        onClick={locate}
      >
        {pending ? "Finding location…" : "Use My Current Location"}
      </button>
      <p role="status">{device}</p>
      {config?.boundary && (
        <>
          <p>Click or tap the map to choose or correct the issue location.</p>
          <MapFallback>
            <Suspense fallback={<p role="status">Loading map…</p>}>
              <MapComponent
                boundary={config.boundary}
                point={point}
                onSelect={choose}
              />
            </Suspense>
          </MapFallback>
        </>
      )}
      {(text || point) && (
        <div
          className="location-summary"
          role="status"
          ref={selected}
          tabIndex={-1}
        >
          <strong>Selected Location</strong>
          <p>{text}</p>
          {point && (
            <p>
              Latitude {point.latitude}, longitude {point.longitude}
            </p>
          )}
          {point && (
            <p>
              {inside === true
                ? "Inside the fictional service area."
                : inside === false
                  ? `This location appears outside the service area.${geographicPolicy === "no_geographic_restriction" ? " This Issue has no geographic restriction." : " Eligibility will be checked before submission."}`
                  : "Service-area validation is unavailable. Eligibility will be checked before submission."}
            </p>
          )}
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => {
              setQuery("");
              document.getElementById("location-search")?.focus();
              if (!config?.search) setEditing(true);
            }}
          >
            Change Location
          </button>
        </div>
      )}
      <details
        open={editing || Boolean(error)}
        onToggle={(event) => setEditing(event.currentTarget.open)}
      >
        <summary>
          {text
            ? "Edit location description manually"
            : "Can't find the location? Enter it manually"}
        </summary>
        <label className="form-label" htmlFor="location">
          Service Location {required ? "(required)" : "(optional)"}
        </label>
        <input
          id="location"
          className="form-control"
          value={text}
          maxLength={2000}
          required={required}
          onChange={(e) => {
            generation.current++;
            onChange(e.target.value, point);
          }}
          aria-invalid={Boolean(error)}
          aria-describedby={`location-help${error ? " location-error" : ""}`}
        />
        <p id="location-help" className="form-text">
          Describe the address, intersection or landmark. You can complete this
          without a map where the Issue permits.
        </p>
      </details>
      {error && (
        <p id="location-error" role="alert">
          {error}
        </p>
      )}
      <details>
        <summary>Enter coordinates manually (optional)</summary>
        <div className="location-coordinate-fields">
          {["latitude", "longitude"].map((name) => (
            <div key={name}>
              <label htmlFor={`location-${name}`}>
                {name === "latitude" ? "Latitude" : "Longitude"}
              </label>
              <input
                id={`location-${name}`}
                className="form-control"
                inputMode="decimal"
                value={manual[name]}
                onChange={(e) =>
                  setManual((old) => ({ ...old, [name]: e.target.value }))
                }
              />
            </div>
          ))}
        </div>
        <button
          type="button"
          className="btn btn-outline-secondary"
          onClick={() => {
            if (!manual.latitude.trim() || !manual.longitude.trim())
              setManualError("Enter both latitude and longitude.");
            else
              choose(
                {
                  latitude: Number(manual.latitude),
                  longitude: Number(manual.longitude),
                },
                text || undefined,
              );
          }}
        >
          Use these coordinates
        </button>
      </details>
      {manualError && <p role="alert">{manualError}</p>}
      {point && (
        <button
          type="button"
          className="btn btn-link"
          onClick={() => {
            generation.current++;
            onChange(text, null);
          }}
        >
          Remove coordinates; keep description
        </button>
      )}
    </fieldset>
  );
}
