import { useEffect, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import workerUrl from "maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url";
import { useTheme } from "../theme/useTheme.js";

export default function ServiceLocationMap({ boundary, point, onSelect }) {
  const host = useRef(null),
    mapRef = useRef(null),
    marker = useRef(null),
    selectRef = useRef(onSelect);
  const [state, setState] = useState("loading");
  const { theme } = useTheme();
  selectRef.current = onSelect;
  useEffect(() => {
    let map, observer;
    const timeout = setTimeout(() => setState("error"), 8000);
    setState("loading");
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
      mapRef.current = map;
      map.addControl(new maplibregl.NavigationControl({ showCompass: false }));
      map.on("load", () => {
        clearTimeout(timeout);
        setState("ready");
      });
      map.on("error", () => {
        clearTimeout(timeout);
        setState("error");
      });
      map.on("click", (event) =>
        selectRef.current({
          longitude: event.lngLat.lng,
          latitude: event.lngLat.lat,
        }),
      );
      if (typeof ResizeObserver !== "undefined") {
        observer = new ResizeObserver(() => map.resize());
        observer.observe(host.current);
      }
    } catch {
      clearTimeout(timeout);
      setState("error");
    }
    return () => {
      clearTimeout(timeout);
      observer?.disconnect();
      marker.current?.remove();
      marker.current = null;
      map?.remove();
      mapRef.current = null;
    };
  }, [boundary, theme]);
  useEffect(() => {
    marker.current?.remove();
    marker.current = null;
    if (point && mapRef.current && state === "ready") {
      marker.current = new maplibregl.Marker()
        .setLngLat([point.longitude, point.latitude])
        .addTo(mapRef.current);
      mapRef.current.easeTo({
        center: [point.longitude, point.latitude],
        duration: 0,
      });
    }
  }, [point, state, theme]);
  return (
    <div className="service-location-map">
      <div
        ref={host}
        className="service-location-canvas"
        aria-label="Service Location map"
      />
      {state === "loading" && <p role="status">Loading map…</p>}
      {state === "error" && (
        <p role="alert">
          The map is unavailable. Use search or the manual location fields
          below.
        </p>
      )}
    </div>
  );
}
