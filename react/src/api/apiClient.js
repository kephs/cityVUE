export class CityVueApiError extends Error {
    constructor(code, message, { status, requestId, cause } = {}) {
        super(message, { cause });
        this.name = "CityVueApiError";
        this.code = code;
        this.status = status;
        this.requestId = requestId;
    }
}

function publicMessage(status) {
    if (status === 404 || status === 409) return ["catalog-version", "The issue form has changed. Please review the latest questions before submitting."];
    if (status === 400 || status === 422) return ["validation", "Some request information is no longer valid. Please review your answers and try again."];
    return ["server", "CityVUE could not complete the request. Please try again."];
}

export function createApiClient({ baseUrl, fetchImplementation = fetch, timeoutMs = 10000 }) {
    async function request(path, { method = "GET", body, signal } = {}) {
        const timeoutController = new AbortController();
        const timeout = setTimeout(() => timeoutController.abort("timeout"), timeoutMs);
        const combinedSignal = signal && typeof AbortSignal.any === "function"
            ? AbortSignal.any([signal, timeoutController.signal]) : timeoutController.signal;
        const abortFromCaller = () => timeoutController.abort(signal.reason);
        if (signal && typeof AbortSignal.any !== "function") signal.addEventListener("abort", abortFromCaller, { once: true });
        try {
            const response = await fetchImplementation(`${baseUrl}${path}`, {
                method, signal: combinedSignal, headers: { Accept: "application/json", ...(body ? { "Content-Type": "application/json" } : {}) },
                ...(body ? { body: JSON.stringify(body) } : {})
            });
            const requestId = response.headers?.get?.("x-request-id") || undefined;
            if (!response.ok) {
                const [code, message] = publicMessage(response.status);
                throw new CityVueApiError(code, message, { status: response.status, requestId });
            }
            return response.status === 204 ? undefined : response.json();
        } catch (error) {
            if (error instanceof CityVueApiError) throw error;
            if (signal?.aborted) throw new CityVueApiError("cancelled", "Request cancelled.", { cause: error });
            if (timeoutController.signal.aborted) throw new CityVueApiError("timeout", "The request took too long. Please try again.", { cause: error });
            throw new CityVueApiError("network", "CityVUE cannot reach the service right now. Check your connection and try again.", { cause: error });
        } finally {
            clearTimeout(timeout);
            if (signal && typeof AbortSignal.any !== "function") signal.removeEventListener("abort", abortFromCaller);
        }
    }
    return { get: (path, options) => request(path, options), post: (path, body, options) => request(path, { ...options, method: "POST", body }) };
}
