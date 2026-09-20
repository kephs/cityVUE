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
    organizationId: "forged",
    page: 1,
  });
  expect(client.get).toHaveBeenCalledWith(
    "/staff/internal-service-requests?search=REQ&page=1",
    expect.objectContaining({ authenticated: true }),
  );
  expect(data.items[0]).not.toHaveProperty("contact");
  expect(data.items[0]).not.toHaveProperty("description");
});
test.each(["public", "unknown"])(
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
    `/staff/internal-service-requests/${id}/activity?page=1&pageSize=25`,
    expect.objectContaining({ authenticated: true }),
  );
  expect(data.items[0]).not.toHaveProperty("staffIdentityId");
  expect(data.items[0]).not.toHaveProperty("metadata");
  client.get.mockResolvedValue({
    items: [{ ...event, type: "arbitrary_comment" }],
    page: 1,
  });
  await expect(repo.activity(id, 1)).rejects.toThrow(/unavailable/);
});
