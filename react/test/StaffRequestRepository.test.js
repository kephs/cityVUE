import { expect, test, vi } from "vitest";
import { createStaffRequestRepository } from "../src/staff/requests/requestRepository.js";
const id = "10000000-0000-4000-8000-000000000001";
test("F039 contact uses explicit protected projection and authenticated request", async () => {
  const client = {
    get: vi.fn().mockResolvedValue({
      name: "Alex Example",
      email: null,
      phone: "not in schema",
      actor: "private",
    }),
  };
  const repo = createStaffRequestRepository({ client });
  expect(await repo.contact(id)).toEqual({ name: "Alex Example", email: null });
  expect(client.get).toHaveBeenCalledWith(
    `/staff/internal-service-requests/${id}/contact`,
    expect.objectContaining({ authenticated: true }),
  );
  for (const data of [
    { name: {}, email: null },
    { name: null },
    { name: "x".repeat(201), email: null },
  ]) {
    client.get.mockResolvedValue(data);
    await expect(repo.contact(id)).rejects.toThrow(/unavailable/);
  }
});
const row = {
  serviceRequestId: id,
  audience: "internal",
  referenceNumber: "REQ-2026-000123",
  issueName: "Fictional",
  departmentName: "Fictional",
  status: "open",
  description: "Plain text",
  revision: 2,
  contact: { email: "private@example.com" },
};
test("authenticated requests allowlist filters and discard unexpected sensitive fields", async () => {
  const client = {
    get: vi
      .fn()
      .mockResolvedValue({ items: [row], total: 1, page: 1, pageSize: 25 }),
  };
  const repository = createStaffRequestRepository({ client });
  const data = await repository.list({
    search: "REQ",
    q: "50%_ café",
    organizationId: "forged",
    page: 1,
  });
  expect(client.get).toHaveBeenCalledWith(
    "/staff/service-requests?search=REQ&q=50%25_+caf%C3%A9&page=1",
    expect.objectContaining({ authenticated: true }),
  );
  expect(data.items[0]).not.toHaveProperty("contact");
  expect(data.items[0]).not.toHaveProperty("description");
});
test.each(["unknown", "PUBLIC"])(
  "unexpected audience %s fails closed",
  async (audience) => {
    const client = { get: vi.fn().mockResolvedValue({ ...row, audience }) };
    await expect(
      createStaffRequestRepository({ client }).detail(id),
    ).rejects.toThrow(/unavailable/);
  },
);
test("UUID route is validated and capability must be literal true", async () => {
  const client = {
    get: vi
      .fn()
      .mockResolvedValue({ canUpdate: "true", departments: [], divisions: [] }),
  };
  const repo = createStaffRequestRepository({ client });
  await expect(repo.detail("../other")).rejects.toThrow(/unavailable/);
  expect(client.get).not.toHaveBeenCalled();
  expect((await repo.options()).canUpdate).toBe(false);
});

test("F040 mixed results retain audience, allowlist audience filters and derive controls only from server capabilities", async () => {
  const client = {
    get: vi.fn().mockResolvedValue({
      items: [row, { ...row, audience: "public" }],
      total: 2,
      page: 1,
      pageSize: 25,
    }),
  };
  const repo = createStaffRequestRepository({ client });
  const results = await repo.list({ audience: "all", view: "watching" });
  expect(results.items.map((value) => value.audience)).toEqual([
    "internal",
    "public",
  ]);
  expect(client.get).toHaveBeenCalledWith(
    "/staff/service-requests?audience=all&view=watching",
    expect.objectContaining({ authenticated: true }),
  );
  client.get.mockResolvedValue({
    ...row,
    audience: "public",
    intakeChannel: "phone",
    capabilities: {
      workflowActions: ["hold", "arbitrary"],
      canAssign: "true",
      canManageWatchers: true,
      canRoute: true,
    },
    permissions: ["private"],
  });
  const detail = await repo.detail(id);
  expect(detail.audience).toBe("public");
  expect(detail.intakeChannel).toBe("phone");
  expect(detail.capabilities).toEqual({
    canManageRequesterTracking: false,
    workflowActions: ["hold"],
    canAssign: false,
    canManageWatchers: true,
    canRoute: true,
    canReadContact: false,
    canReadNotes: false,
    canCreateNotes: false,
    canReadCommunications: false,
    canCreateCommunication: false,
    canWatchSelf: false,
  });
  expect(detail).not.toHaveProperty("permissions");
  expect(detail).not.toHaveProperty("contact");
});

test("F040 PUBLIC protected contact keeps its separate authenticated endpoint and never accepts an arbitrary audience path", async () => {
  const client = {
    get: vi
      .fn()
      .mockResolvedValue({ name: null, email: "fictional@example.com" }),
  };
  const repo = createStaffRequestRepository({ client });
  await repo.contact(id, undefined, "public");
  expect(client.get).toHaveBeenCalledWith(
    `/staff/public-service-requests/${id}/contact`,
    expect.objectContaining({ authenticated: true }),
  );
  client.get.mockClear();
  await expect(repo.contact(id, undefined, "../other")).rejects.toThrow(
    /unavailable/,
  );
  expect(client.get).not.toHaveBeenCalled();
});

test("activity uses protected bounded endpoint and drops identity/audit extras", async () => {
  const event = {
    id,
    type: "request_created",
    occurredAt: "2026-09-19T12:00:00Z",
    actorDisplay: "Staff member",
    narrative: null,
    staffIdentityId: "secret",
    metadata: { audit: "private" },
  };
  const client = {
    get: vi
      .fn()
      .mockResolvedValue({ items: [event], page: 1, hasNextPage: false }),
  };
  const repo = createStaffRequestRepository({ client });
  const data = await repo.activity(id, 1);
  expect(client.get).toHaveBeenCalledWith(
    `/staff/service-requests/${id}/activity?page=1&pageSize=25`,
    expect.objectContaining({ authenticated: true }),
  );
  expect(data.items[0]).not.toHaveProperty("staffIdentityId");
  expect(data.items[0]).not.toHaveProperty("metadata");
  client.get.mockResolvedValue({
    items: [
      {
        ...event,
        type: "request_auto_assigned",
        actorDisplay: "System",
        toTargetType: "group",
        toTargetName: "F048 Fictional Queue",
      },
    ],
    page: 1,
  });
  const automatic = await repo.activity(id, 1);
  expect(automatic.items[0]).toMatchObject({
    type: "request_auto_assigned",
    actorDisplay: "System",
    toTargetName: "F048 Fictional Queue",
  });
  expect(automatic.items[0]).not.toHaveProperty("metadata");
  client.get.mockResolvedValue({
    items: [{ ...event, type: "arbitrary_comment" }],
    page: 1,
  });
  await expect(repo.activity(id, 1)).rejects.toThrow(/unavailable/);
});

test("F043 preview uses five server-bounded rows and rejects unbounded page sizes before HTTP", async () => {
  const client = {
    get: vi.fn().mockResolvedValue({
      items: [],
      page: 1,
      hasNextPage: false,
      hasPreviousPage: false,
    }),
  };
  const repo = createStaffRequestRepository({ client });
  await repo.activity(id, 1, undefined, 5);
  expect(client.get).toHaveBeenCalledWith(
    `/staff/service-requests/${id}/activity?page=1&pageSize=5`,
    expect.objectContaining({ authenticated: true }),
  );
  for (const size of [0, -1, 101, 1.5])
    await expect(repo.activity(id, 1, undefined, size)).rejects.toThrow(
      "Invalid activity page size",
    );
  expect(client.get).toHaveBeenCalledTimes(1);
  client.get.mockResolvedValue({
    items: Array.from({ length: 6 }, () => ({})),
    page: 1,
  });
  await expect(repo.activity(id, 1, undefined, 5)).rejects.toThrow(
    /unavailable/,
  );
});

test("F044 tracking projection excludes raw secrets from state and scopes issuance to authenticated operation", async () => {
  const secret = "A".repeat(43);
  const client = {
    get: vi.fn().mockResolvedValue({
      status: "active",
      version: id,
      credential: secret,
      credentialDigest: "private",
    }),
    post: vi.fn().mockResolvedValue({
      status: "active",
      version: id,
      credential: secret,
      actor: "private",
    }),
  };
  const repo = createStaffRequestRepository({ client });
  expect(await repo.trackingState(id)).toEqual({
    status: "active",
    version: id,
  });
  expect(await repo.changeTracking(id, "rotate", id)).toEqual({
    status: "active",
    version: id,
    credential: secret,
  });
  expect(client.post).toHaveBeenCalledWith(
    "/staff/service-requests/" + id + "/requester-tracking/rotate",
    { expectedVersion: id },
    expect.objectContaining({ authenticated: true }),
  );
  client.get.mockResolvedValue({ status: "active", version: null });
  await expect(repo.trackingState(id)).rejects.toThrow();
  client.post.mockResolvedValue({ status: "active", version: id });
  await expect(repo.changeTracking(id, "issue", null)).rejects.toThrow();
});
