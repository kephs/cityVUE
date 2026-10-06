import { StrictMode } from "react";
import { act, fireEvent, render, screen } from "@testing-library/react";
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
      this.loaded = vi.fn(() => true);
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
  vi.unstubAllGlobals();
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

function MapView({ point = { latitude: 0.2, longitude: 0.3 } }) {
  return (
    <StrictMode>
      <ThemeProvider>
        <ServiceLocationMap
          boundary={boundary}
          point={point}
          onSelect={vi.fn()}
        />
      </ThemeProvider>
    </StrictMode>
  );
}
test("StrictMode cleanup and stale callbacks cannot change the new map; resize follows layout and visibility", () => {
  const observers = [];
  vi.stubGlobal(
    "ResizeObserver",
    class {
      constructor(callback) {
        this.callback = callback;
        this.observe = vi.fn();
        this.disconnect = vi.fn();
        observers.push(this);
      }
    },
  );
  const view = render(<MapView />, { reactStrictMode: true });
  const old = mock.maps[0],
    map = mock.maps.at(-1);
  expect(old.remove).toHaveBeenCalledOnce();
  act(() => map.events.load());
  const count = map.resize.mock.calls.length;
  act(() => {
    observers.at(-1).callback();
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("resize"));
  });
  expect(map.resize.mock.calls.length).toBe(count + 3);
  act(() => {
    old.events.error();
    old.events.load();
    observers[0].callback();
  });
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(map.remove).not.toHaveBeenCalled();
  expect(mock.markers.at(-1).point).toEqual([0.3, 0.2]);
  view.unmount();
  expect(map.remove).toHaveBeenCalledOnce();
  expect(observers.at(-1).disconnect).toHaveBeenCalledOnce();
  render(<MapView />, { reactStrictMode: true });
  act(() => mock.maps.at(-1).events.load());
  expect(mock.markers.at(-1).point).toEqual([0.3, 0.2]);
});
test("renderer retry retains selected coordinates and ignores failed-instance events", () => {
  render(<MapView />, { reactStrictMode: true });
  const failed = mock.maps.at(-1);
  act(() => failed.events.load());
  act(() => failed.events.error());
  fireEvent.click(screen.getByRole("button", { name: "Try map again" }));
  const restarted = mock.maps.at(-1);
  expect(restarted).not.toBe(failed);
  expect(failed.remove).toHaveBeenCalledOnce();
  act(() => restarted.events.load());
  act(() => failed.events.error());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(mock.markers.at(-1).point).toEqual([0.3, 0.2]);
});
test("a genuine context loss shows fallback and restoration recovers only when loaded", () => {
  render(<MapView />, { reactStrictMode: true });
  const map = mock.maps.at(-1);
  act(() => map.events.load());
  act(() => map.events.webglcontextlost());
  expect(screen.getByRole("alert")).toBeInTheDocument();
  act(() => map.events.webglcontextrestored());
  map.loaded.mockReturnValue(false);
  act(() => map.events.idle());
  expect(screen.getByRole("status")).toBeInTheDocument();
  map.loaded.mockReturnValue(true);
  act(() => map.events.idle());
  expect(screen.queryByRole("status")).not.toBeInTheDocument();
  expect(mock.markers.at(-1).point).toEqual([0.3, 0.2]);
});
test("a late successful load recovers the timeout fallback", () => {
  vi.useFakeTimers();
  render(<MapView />, { reactStrictMode: true });
  act(() => vi.advanceTimersByTime(8000));
  expect(screen.getByRole("alert")).toBeInTheDocument();
  act(() => mock.maps.at(-1).events.load());
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
});
