import { expect, test, vi } from "vitest";
import { createServiceRequestDetailsData } from "../src/serviceRequests/serviceRequestDetailsData.js";

test("details data is unavailable in legacy mode and unless the development flag is explicit", () => {
    expect(createServiceRequestDetailsData({ environment: {} }).mode).toBe("unavailable");
    expect(createServiceRequestDetailsData({ environment: { VITE_CITYVUE_DATA_SOURCE: "api", VITE_CITYVUE_API_BASE_URL: "http://localhost:3000/api/v1" } }).mode).toBe("unavailable");
});

test("enabled API repository fetches encoded canonical request details", async () => {
    const fetchImplementation = vi.fn(async () => ({ ok: true, status: 200, headers: { get: () => null }, json: async () => ({ serviceRequest: { id: "id" } }) }));
    const data = createServiceRequestDetailsData({ environment: { VITE_CITYVUE_DATA_SOURCE: "api", VITE_CITYVUE_API_BASE_URL: "http://localhost:3000/api/v1", VITE_CITYVUE_ENABLE_DEVELOPMENT_SERVICE_REQUEST_READS: "true" }, fetchImplementation });
    await data.repository.getServiceRequestDetails("request/id");
    expect(fetchImplementation).toHaveBeenCalledWith("http://localhost:3000/api/v1/service-requests/request%2Fid", expect.any(Object));
});
