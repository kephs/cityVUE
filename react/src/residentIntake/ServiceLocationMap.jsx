import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useTheme } from "../theme/useTheme.js";

export default function ServiceLocationMap({ boundary, point, onSelect }) {
  const host = useRef(null),
    mapRef = useRef(null),
    pointRef = useRef(point),
    selectRef = useRef(onSelect);
  const [state, setState] = useState("loading");
  const [attempt, setAttempt] = useState(0);
  pointRef.current = point;
  const { theme } = useTheme();
  selectRef.current = onSelect;
  useEffect(() => {
    let map, observer, timeout, frame;
    let disposed = false,
      ready = false,
      contextLost = false,
      selectedMarker;
    const current = () => !disposed;
    const fail = () => {
      if (!current()) return;
      clearTimeout(timeout);
      ready = false;
      setState("error");
    };
    const syncPoint = () => {
      if (!current() || !ready) return;
      selectedMarker?.remove();
      selectedMarker = null;
      const selected = pointRef.current;
      if (selected) {
        selectedMarker = new maplibregl.Marker()
          .setLngLat([selected.longitude, selected.latitude])
          .addTo(map);
        map.easeTo({
          center: [selected.longitude, selected.latitude],
          duration: 0,
        });
      }
    };
    const resize = () => {
      if (!current() || !map) return;
      try {
        map.resize();
      } catch {
        fail();
      }
    };
    const loaded = () => {
      if (!current() || ready || contextLost) return;
      clearTimeout(timeout);
      ready = true;
      resize();
      if (ready) {
        syncPoint();
        setState("ready");
      }
    };
    const loading = () => {
      if (!current()) return;
      ready = false;
      setState("loading");
      clearTimeout(timeout);
      timeout = setTimeout(fail, 8000);
    };
    loading();
    try {
      maplibregl.setWorkerUrl(workerUrl);
      const dark = theme === "dark";
      const ring = boundary.geometry.coordinates[0];
      map = new maplibregl.Map({
        container: host.current,
        attributionControl: false,
        dragRotate: false,
        touchPitch: false,
        center: [(ring[0][0] + ring[2][0]) / 2, (ring[0][1] + ring[2][1]) / 2],
        zoom: 10,
        style: {
          version: 8,
          sources: { boundary: { type: "geojson", data: boundary } },
          layers: [
            {
              id: "background",
              type: "background",
              paint: { "background-color": dark ? "#14263c" : "#e8f1f7" },
            },
            {
              id: "boundary",
              type: "fill",
              source: "boundary",
              paint: {
                "fill-color": dark ? "#276a73" : "#89c5b4",
                "fill-opacity": 0.6,
              },
            },
            {
              id: "outline",
              type: "line",
              source: "boundary",
              paint: {
                "line-color": dark ? "#82e2d2" : "#176b69",
                "line-width": 3,
              },
            },
          ],
        },
      });
      const instance = { map, syncPoint };
      mapRef.current = instance;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
      map.on("load", loaded);
      map.on("error", fail);
      // A recoverable source error or delayed load must not leave a healthy map
      // permanently marked unavailable. Only MapLibre's loaded state clears it.
      map.on("idle", () => {
        if (current() && map.loaded()) loaded();
      });
      map.on("webglcontextlost", () => {
        if (!current()) return;
        contextLost = true;
        fail();
      });
      map.on("webglcontextrestored", () => {
        if (!current()) return;
        contextLost = false;
        loading();
        resize();
      });
      map.on(
        "click",
        (event) =>
          current() &&
          selectRef.current({
            longitude: event.lngLat.lng,
            latitude: event.lngLat.lat,
          }),
      );
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(resize);
        observer.observe(host.current);
      }
      frame = requestAnimationFrame(resize);
      window.addEventListener("resize", resize);
      document.addEventListener("visibilitychange", resize);
    } catch {
      fail();
    }
    return () => {
      disposed = true;
      clearTimeout(timeout);
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener("resize", resize);
      document.removeEventListener("visibilitychange", resize);
      selectedMarker?.remove();
      map?.remove();
      if (mapRef.current?.map === map) mapRef.current = null;
    };
  }, [boundary, theme, attempt]);
  useEffect(() => {
    mapRef.current?.syncPoint();
  }, [point]);
  return (
    <div className="service-location-map">
      <div
        ref={host}
        className="service-location-canvas"
        aria-label="Service Location map"
      />
      {state === "loading" && <p role="status">Loading map…</p>}
      {state === "error" && (
        <div>
          <p role="alert">
            The map is unavailable. Use search or the manual location fields
            below.
          </p>
          <button
            type="button"
            className="btn btn-outline-secondary"
            onClick={() => setAttempt((value) => value + 1)}
          >
            Try map again
          </button>
        </div>
      )}
    </div>
  );
}
