import { useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import ServiceLocationInput from "../src/residentIntake/ServiceLocationInput.jsx";
import {
  boundaryContains,
  createDevelopmentLocationSearch,
  normalizeLocationResult,
} from "../src/residentIntake/locationSearch.js";
import { mapIntakeToCreateServiceRequest } from "../src/serviceRequests/canonicalSubmission.js";

const boundary = {
  type: "Feature",
  properties: { id: "fictional", name: "Fictional" },
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
const fixture = {
  id: "square",
  displayLabel: "Fictional Square",
  latitude: 0,
  longitude: 0,
};
const provider = {
  load: async () => ({
    boundary,
    synthetic: true,
    search: createDevelopmentLocationSearch([fixture]),
  }),
};
const FakeMap = ({ onSelect }) => (
  <button
    type="button"
    onClick={() => onSelect({ latitude: 0.1, longitude: 0.2 })}
  >
    Select fictional map point
  </button>
);
function Harness({ repository = provider, onChange = vi.fn() }) {
  const [location, setLocation] = useState({ text: "", point: null });
  return (
    <ServiceLocationInput
      repository={repository}
      {...location}
      geographicPolicy="no_geographic_restriction"
      onChange={(text, point) => {
        onChange(text, point);
        setLocation({ text, point });
      }}
      MapComponent={FakeMap}
    />
  );
}
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

test("search normalization rejects malformed results and drops provider metadata", async () => {
  expect(
    normalizeLocationResult({ ...fixture, rawProvider: "private" }),
  ).toEqual(fixture);
  for (const row of [
    { ...fixture, latitude: 91 },
    { ...fixture, longitude: NaN },
    { ...fixture, latitude: "0" },
    { ...fixture, displayLabel: "x".repeat(2001) },
  ])
    expect(normalizeLocationResult(row)).toBeNull();
  const search = createDevelopmentLocationSearch(
    Array.from({ length: 10 }, (_, i) => ({ ...fixture, id: String(i) })),
  );
  expect(await search.search("Fi")).toEqual([]);
  expect(await search.search("Fictional")).toHaveLength(5);
  expect(boundaryContains({ latitude: 1, longitude: 0 }, boundary)).toBe(true);
  expect(boundaryContains({ latitude: 2, longitude: 0 }, boundary)).toBe(false);
});

test("debounced search uses keyboard-operable bounded results and does not request device location", async () => {
  const getCurrentPosition = vi.fn();
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  const user = userEvent.setup();
  render(<Harness />);
  const input = await screen.findByLabelText("Search address or location");
  await waitFor(() => expect(input).toBeEnabled());
  await user.type(input, "Fictional");
  const result = await screen.findByRole("button", {
    name: "Fictional Square",
  });
  result.focus();
  await user.keyboard("{Enter}");
  expect(screen.getByLabelText("Service Location (optional)")).toHaveValue(
    "Fictional Square",
  );
  expect(screen.getByText("Latitude 0, longitude 0")).toBeInTheDocument();
  expect(getCurrentPosition).not.toHaveBeenCalled();
});

test("older search response is ignored after a new search and selection", async () => {
  let resolveOld;
  const search = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise((r) => {
          resolveOld = r;
        }),
    )
    .mockResolvedValue([fixture]);
  const repository = { load: async () => ({ search: { search }, boundary }) };
  render(<Harness repository={repository} />);
  const input = screen.getByLabelText("Search address or location");
  await waitFor(() => expect(input).toBeEnabled());
  fireEvent.change(input, { target: { value: "first" } });
  await waitFor(() => expect(search).toHaveBeenCalledTimes(1));
  fireEvent.change(input, { target: { value: "second" } });
  fireEvent.click(
    await screen.findByRole("button", { name: fixture.displayLabel }),
  );
  await act(async () =>
    resolveOld([{ ...fixture, displayLabel: "Old stale result" }]),
  );
  expect(screen.queryByText("Old stale result")).not.toBeInTheDocument();
  expect(screen.getByLabelText("Service Location (optional)")).toHaveValue(
    fixture.displayLabel,
  );
});

test.each([
  [1, "denied"],
  [2, "unavailable"],
  [3, "timed out"],
  [99, "unavailable"],
])(
  "explicit geolocation failure %s leaves manual and map alternatives",
  async (code, message) => {
    const getCurrentPosition = vi.fn((success, failure) => failure({ code }));
    vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
    render(<Harness />);
    expect(getCurrentPosition).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Use my current location" }),
    );
    expect(getCurrentPosition).toHaveBeenCalledTimes(1);
    expect(
      screen.getByText(new RegExp(message), { selector: 'p[role="status"]' }),
    ).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Service Location (optional)"), {
      target: { value: "Fictional manual landmark" },
    });
    fireEvent.click(
      await screen.findByRole("button", { name: "Select fictional map point" }),
    );
    expect(screen.getByText("Latitude 0.1, longitude 0.2")).toBeInTheDocument();
  },
);

test("device success is transient and a late callback cannot overwrite manual correction", async () => {
  let success;
  const getCurrentPosition = vi.fn((callback) => {
    success = callback;
  });
  vi.stubGlobal("navigator", { geolocation: { getCurrentPosition } });
  const onChange = vi.fn();
  render(<Harness onChange={onChange} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Use my current location" }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Finding location…" }));
  expect(getCurrentPosition).toHaveBeenCalledTimes(1);
  act(() =>
    success({ coords: { latitude: 0.01, longitude: -0.02, accuracy: 900 } }),
  );
  expect(onChange).toHaveBeenLastCalledWith("Selected Service Location", {
    latitude: 0.01,
    longitude: -0.02,
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Use my current location" }),
  );
  fireEvent.change(screen.getByLabelText("Service Location (optional)"), {
    target: { value: "Corrected landmark" },
  });
  act(() => success({ coords: { latitude: 1, longitude: 1 } }));
  expect(screen.getByLabelText("Service Location (optional)")).toHaveValue(
    "Corrected landmark",
  );
});

test("manual path survives unavailable providers and validates paired coordinates", async () => {
  render(
    <Harness
      repository={{
        load: async () => {
          throw new Error("private upstream");
        },
      }}
    />,
  );
  fireEvent.change(screen.getByLabelText("Service Location (optional)"), {
    target: { value: "<script>fictional</script> 🌳" },
  });
  fireEvent.click(screen.getByText("Enter coordinates manually (optional)"));
  fireEvent.click(
    screen.getByRole("button", { name: "Use these coordinates" }),
  );
  expect(screen.getByRole("alert")).toHaveTextContent("both");
  fireEvent.change(screen.getByLabelText("Latitude"), {
    target: { value: "-0.123456" },
  });
  fireEvent.change(screen.getByLabelText("Longitude"), {
    target: { value: "0.234567" },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Use these coordinates" }),
  );
  expect(
    screen.getByText("Latitude -0.123456, longitude 0.234567"),
  ).toBeInTheDocument();
  expect(document.querySelector("script")).toBeNull();
  expect(screen.queryByText("private upstream")).not.toBeInTheDocument();
});

test("canonical mapping persists only chosen Service Location, separate from Contact", () => {
  const mapped = mapIntakeToCreateServiceRequest({
    service: { id: "issue", questions: [] },
    answers: {},
    description: "Fictional",
    location: " Fictional park ",
    locationPoint: {
      latitude: -0.123456,
      longitude: 0.234567,
      accuracy: 3,
      provenance: "device",
    },
    reportingMode: "identified",
    reporterName: "Test person",
  });
  expect(mapped.location).toEqual({
    enteredAddress: "Fictional park",
    locationType: "other",
    latitude: -0.123456,
    longitude: 0.234567,
  });
  expect(mapped.contact).toEqual({ name: "Test person" });
  expect(JSON.stringify(mapped)).not.toMatch(/accuracy|provenance|device/);
});

test("search enforces minimum and 300 ms debounce, with cancellation", async () => {
  vi.useFakeTimers();
  const search = vi.fn().mockResolvedValue([fixture]);
  const repository = { load: async () => ({ search: { search } }) };
  render(<Harness repository={repository} />);
  await act(async () => {});
  const input = screen.getByLabelText("Search address or location");
  fireEvent.change(input, { target: { value: "Fi" } });
  await act(async () => vi.advanceTimersByTime(400));
  expect(search).not.toHaveBeenCalled();
  fireEvent.change(input, { target: { value: "Fic" } });
  await act(async () => vi.advanceTimersByTime(299));
  expect(search).not.toHaveBeenCalled();
  await act(async () => vi.advanceTimersByTime(1));
  expect(search).toHaveBeenCalledTimes(1);
  const signal = search.mock.calls[0][1].signal;
  fireEvent.change(input, { target: { value: "Fict" } });
  expect(signal.aborted).toBe(true);
});

test("malformed or unsupported device location never changes Service Location", () => {
  const onChange = vi.fn();
  vi.stubGlobal("navigator", {});
  const view = render(<Harness onChange={onChange} />);
  fireEvent.click(
    screen.getByRole("button", { name: "Use my current location" }),
  );
  expect(onChange).not.toHaveBeenCalled();
  vi.stubGlobal("navigator", {
    geolocation: {
      getCurrentPosition: (success) =>
        success({ coords: { latitude: NaN, longitude: 0 } }),
    },
  });
  fireEvent.click(
    screen.getByRole("button", { name: "Use my current location" }),
  );
  expect(onChange).not.toHaveBeenCalled();
  view.unmount();
});
