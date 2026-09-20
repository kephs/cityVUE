import { expect, test, vi } from "vitest";
import { createStaffRequestRepository } from "../src/staff/requests/requestRepository.js";
const id = "10000000-0000-4000-8000-000000000001";
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
