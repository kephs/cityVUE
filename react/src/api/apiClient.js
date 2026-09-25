import { getStaffAccessToken } from "../auth/tokenProvider.js";

export class CityVueApiError extends Error {
  constructor(code, message, { status, requestId, cause } = {}) {
    super(message, { cause });
    this.name = "CityVueApiError";
    this.code = code;
    this.status = status;
    this.requestId = requestId;
  }
}

function publicMessage(status, path, code) {
  if (path.startsWith("/admin/issues") && [400, 409].includes(status)) {
    const messages = {
      ISSUE_SOURCE_STALE:
        "The source Issue changed since you reviewed it. Refresh the source configuration before creating this Issue.",
      ISSUE_SOURCE_UNAVAILABLE:
        "The source Issue is no longer available. Select and review an eligible source.",
      ISSUE_CATEGORY_UNAVAILABLE:
        "The Category is no longer available. Select an eligible Category.",
    };
    if (messages[code]) return [code, messages[code]];
  }
  if (
    status === 400 &&
    path.startsWith("/admin/issues") &&
    code === "QUESTION_CONFIGURATION_INVALID"
  )
    return [
      code,
      "Check follow-up question text, options and unique order numbers.",
    ];
  if (
    status === 400 &&
    path.startsWith("/admin/issues") &&
    code === "QUESTION_DEPENDENCY"
  )
    return [code, "This change would break inherited conditional behavior."];
  if (
    status === 400 &&
    path.startsWith("/admin/issues") &&
    code === "ISSUE_DUPLICATE"
  )
    return [code, "An Issue with this name already exists."];
  if (status === 400 && path.startsWith("/admin/participation-areas")) {
    if (code === "PARTICIPATION_AREA_DUPLICATE")
      return [code, "A Participation Area with this name already exists."];
    if (code === "PARTICIPATION_AREA_LAST_ACTIVE")
      return [
        code,
        "At least one active Participation Area is required while Service Participation collection is enabled. First disable collection in Intake Settings.",
      ];
  }
  if (code === "LOCATION_INELIGIBLE")
    return [
      code,
      "This issue appears to be outside the service area for this request type.",
    ];
  if (code === "LOCATION_ELIGIBILITY_UNDETERMINED")
    return [
      code,
      "We could not confirm whether this location is eligible. Please check the location and try again.",
    ];
  if (code === "LOCATION_ELIGIBILITY_UNAVAILABLE")
    return [
      code,
      "Location validation is temporarily unavailable. Please try again.",
    ];
  if (status === 404 && path.startsWith("/service-requests/"))
    return ["not-found", "The requested service request is unavailable."];
  if (status === 404 || status === 409)
    return [
      "catalog-version",
      "The issue form has changed. Please review the latest questions before submitting.",
    ];
  if (status === 400 || status === 422)
    return [
      "validation",
      "Some request information is no longer valid. Please review your answers and try again.",
    ];
  return [
    "server",
    "CityVUE could not complete the request. Please try again.",
  ];
}

export function createApiClient({
  baseUrl,
  fetchImplementation = fetch,
  timeoutMs = 10000,
  getAccessToken = getStaffAccessToken,
}) {
  async function request(
    path,
    {
      method = "GET",
      body,
      signal,
      authenticated = false,
      idempotencyKey,
      attachmentToken,
      formData,
      responseType,
    } = {},
  ) {
    const timeoutController = new AbortController();
    const timeout = setTimeout(
      () => timeoutController.abort("timeout"),
      formData ? 30000 : timeoutMs,
    );
    const combinedSignal =
      signal && typeof AbortSignal.any === "function"
        ? AbortSignal.any([signal, timeoutController.signal])
        : timeoutController.signal;
    const abortFromCaller = () => timeoutController.abort(signal.reason);
    if (signal && typeof AbortSignal.any !== "function")
      signal.addEventListener("abort", abortFromCaller, { once: true });
    try {
      const accessToken = authenticated ? await getAccessToken() : null;
      const response = await fetchImplementation(`${baseUrl}${path}`, {
        method,
        signal: combinedSignal,
        headers: {
          Accept: "application/json",
          ...(body ? { "Content-Type": "application/json" } : {}),
          ...(idempotencyKey ? { "Idempotency-Key": idempotencyKey } : {}),
          ...(attachmentToken ? { "X-Reqro-Attachment": attachmentToken } : {}),
          ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        ...(formData ? { body: formData } : {}),
        ...(attachmentToken || formData || responseType === "blob"
          ? { credentials: "omit" }
          : {}),
      });
      const requestId = response.headers?.get?.("x-request-id") || undefined;
      if (!response.ok) {
        let payload = {};
        try {
          payload = await response.json();
        } catch {
          /* safe generic mapping below */
        }
        if (response.status === 401)
          throw new CityVueApiError(
            "authentication-required",
            "Your staff session has expired. Please sign in again.",
            { status: 401, requestId },
          );
        if (response.status === 403)
          throw new CityVueApiError(
            "access-denied",
            payload?.message === "CityVUE staff access has not been provisioned"
              ? "Your account has not been provisioned for CityVUE staff access."
              : "You do not have permission to access this CityVUE resource.",
            { status: 403, requestId },
          );
        const [code, message] = publicMessage(
          response.status,
          path,
          payload?.code,
        );
        throw new CityVueApiError(code, message, {
          status: response.status,
          requestId,
        });
      }
      return response.status === 204
        ? undefined
        : responseType === "blob"
          ? response.blob()
          : response.json();
    } catch (error) {
      if (error instanceof CityVueApiError) throw error;
      if (signal?.aborted)
        throw new CityVueApiError("cancelled", "Request cancelled.", {
          cause: error,
        });
      if (timeoutController.signal.aborted)
        throw new CityVueApiError(
          "timeout",
          "The request took too long. Please try again.",
          { cause: error },
        );
      throw new CityVueApiError(
        "network",
        "CityVUE cannot reach the service right now. Check your connection and try again.",
        { cause: error },
      );
    } finally {
      clearTimeout(timeout);
      if (signal && typeof AbortSignal.any !== "function")
        signal.removeEventListener("abort", abortFromCaller);
    }
  }
  return {
    upload: (path, formData, options) =>
      request(path, { ...options, method: "POST", formData }),
    remove: (path, options) => request(path, { ...options, method: "DELETE" }),
    blob: (path, options) =>
      request(path, { ...options, responseType: "blob" }),
    get: (path, options) => request(path, options),
    post: (path, body, options) =>
      request(path, { ...options, method: "POST", body }),
    patch: (path, body, options) =>
      request(path, { ...options, method: "PATCH", body }),
  };
}
