import { act, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import ServiceLocationMap from "../src/residentIntake/ServiceLocationMap.jsx";
import { ThemeProvider } from "../src/theme/ThemeProvider.jsx";
const mock = vi.hoisted(() => ({ maps: [], markers: [], fail: false }));
vi.mock("maplibre-gl", () => ({
  setWorkerUrl: vi.fn(),
  NavigationControl: class {},
  Map: class {
    constructor(options) {
      if (mock.fail) throw new Error("WebGL");
      this.options = options;
      this.events = {};
      this.remove = vi.fn();
      this.resize = vi.fn();
      this.easeTo = vi.fn();
      mock.maps.push(this);
    }
    on(event, handler) {
      this.events[event] = handler;
    }
    addControl() {}
  },
  Marker: class {
    constructor() {
      this.remove = vi.fn();
      mock.markers.push(this);
    }
    setLngLat(point) {
      this.point = point;
      return this;
    }
    addTo() {
      return this;
    }
  },
}));
vi.mock("maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url", () => ({
  default: "/same-origin-worker.js",
}));
const boundary = {
  type: "Feature",
  properties: {},
  geometry: {
    type: "Polygon",
    coordinates: [
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
        [-1, -1],
      ],
    ],
  },
};
afterEach(() => {
  mock.maps = [];
  mock.markers = [];
  mock.fail = false;
  vi.useRealTimers();
});
test("map uses local GeoJSON, emits neutral selections and updates marker without recreating map", () => {
  const onSelect = vi.fn();
  const view = render(
    <ThemeProvider>
      <ServiceLocationMap
        boundary={boundary}
        point={null}
        onSelect={onSelect}
      />
    </ThemeProvider>,
  );
  const map = mock.maps[0];
  expect(Object.keys(map.options.style.sources)).toEqual(["boundary"]);
  expect(JSON.stringify(map.options.style)).not.toContain("https:");
  act(() => map.events.load());
  act(() => map.events.click({ lngLat: { lng: 0.1, lat: -0.2 } }));
  expect(onSelect).toHaveBeenCalledWith({ longitude: 0.1, latitude: -0.2 });
  view.rerender(
    <ThemeProvider>
      <ServiceLocationMap
        boundary={boundary}
        point={{ latitude: -0.2, longitude: 0.1 }}
        onSelect={onSelect}
      />
    </ThemeProvider>,
  );
  expect(mock.maps).toHaveLength(1);
  expect(mock.markers.at(-1).point).toEqual([0.1, -0.2]);
  view.unmount();
  expect(map.remove).toHaveBeenCalledOnce();
  expect(mock.markers.at(-1).remove).toHaveBeenCalled();
});
test.each(["constructor", "runtime", "timeout"])(
  "map %s failure provides manual fallback instructions",
  (failure) => {
    vi.useFakeTimers();
    mock.fail = failure === "constructor";
    render(
      <ThemeProvider>
        <ServiceLocationMap
          boundary={boundary}
          point={null}
          onSelect={vi.fn()}
        />
      </ThemeProvider>,
    );
    if (failure === "runtime") act(() => mock.maps[0].events.error());
    if (failure === "timeout") act(() => vi.advanceTimersByTime(8000));
    expect(screen.getByRole("alert")).toHaveTextContent(
      "manual location fields",
    );
  },
);
