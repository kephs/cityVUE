import { expect, test, vi } from "vitest";
import { createApiServiceRequestRepository } from "../src/serviceRequests/serviceRequestRepositories.js";

const CREDENTIAL = `F065${"A".repeat(39)}`;
const EXPIRES = "2027-04-14T12:00:00.000Z";

function repository(response) {
  const post = vi.fn(async () => response);
  return {
    post,
    repository: createApiServiceRequestRepository({
      post,
      get: vi.fn(),
    }),
  };
}

const intake = {
  category: { id: "category" },
  service: {
    id: "service",
    serviceDefinitionVersionId: "version",
    questions: [],
  },
  answers: {},
  description: "Fictional description",
  location: "100 Main Street",
  reportingMode: "anonymous",
};

test("F065 a well-formed tracking object survives the receipt allowlist", async () => {
  const { repository: repo } = repository({
    id: "request",
    referenceNumber: "SR-202609-000140",
    status: "open",
    createdAt: "2026-09-02T00:00:00Z",
    tracking: { credential: CREDENTIAL, expiresAt: EXPIRES },
  });
  const receipt = await repo.createServiceRequest(intake);
  expect(receipt).toEqual({
    id: "request",
    referenceNumber: "SR-202609-000140",
    status: "open",
    createdAt: "2026-09-02T00:00:00Z",
    tracking: { credential: CREDENTIAL, expiresAt: EXPIRES },
  });
});

test("F065 unexpected response fields never reach confirmation state", async () => {
  const { repository: repo } = repository({
    id: "request",
    referenceNumber: "SR-202609-000141",
    status: "open",
    createdAt: "2026-09-02T00:00:00Z",
    tracking: {
      credential: CREDENTIAL,
      expiresAt: EXPIRES,
      digest: "must not pass",
    },
    internalNotes: ["must not pass"],
    requesterContact: { email: "must-not-pass@example.invalid" },
  });
  const receipt = await repo.createServiceRequest(intake);
  expect(Object.keys(receipt).sort()).toEqual([
    "createdAt",
    "id",
    "referenceNumber",
    "status",
    "tracking",
  ]);
  expect(Object.keys(receipt.tracking).sort()).toEqual([
    "credential",
    "expiresAt",
  ]);
  expect(JSON.stringify(receipt)).not.toContain("must not pass");
});

test("F065 a malformed or absent tracking object yields no tracking at all", async () => {
  for (const tracking of [
    undefined,
    null,
    {},
    { credential: CREDENTIAL },
    { expiresAt: EXPIRES },
    { credential: "too-short", expiresAt: EXPIRES },
    { credential: `${CREDENTIAL}X`, expiresAt: EXPIRES },
    { credential: "A".repeat(43).replace("A", "!"), expiresAt: EXPIRES },
    { credential: CREDENTIAL, expiresAt: "not-a-date" },
    { credential: 42, expiresAt: EXPIRES },
  ]) {
    const { repository: repo } = repository({
      id: "request",
      referenceNumber: "SR-202609-000142",
      status: "open",
      createdAt: "2026-09-02T00:00:00Z",
      ...(tracking === undefined ? {} : { tracking }),
    });
    const receipt = await repo.createServiceRequest(intake);
    expect(receipt.tracking, JSON.stringify(tracking)).toBeUndefined();
  }
});
