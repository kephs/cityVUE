import { CityVueApiError } from "../api/apiClient.js";
const uuid =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function attachmentProjection(row) {
  if (
    !row ||
    !uuid.test(row.id) ||
    typeof row.filename !== "string" ||
    !/^[a-zA-Z0-9._ -]{1,120}$/.test(row.filename) ||
    !["image/jpeg", "image/png", "image/webp"].includes(row.mediaType) ||
    !Number.isInteger(row.byteSize) ||
    row.byteSize < 1 ||
    row.byteSize > 5242880 ||
    row.state !== "CLEAN"
  )
    throw new CityVueApiError("invalid-response", "Attachment unavailable.");
  return {
    id: row.id,
    filename: row.filename,
    mediaType: row.mediaType,
    byteSize: row.byteSize,
    state: "CLEAN",
  };
}
export function createAttachmentRepository(api, staff = false) {
  const root = staff ? "/staff/attachments" : "/intake/attachments";
  const options = (signal, claim) => ({
    authenticated: staff,
    signal,
    ...(claim ? { attachmentToken: claim.token } : {}),
  });
  const batchPath = (claim) => {
    if (!uuid.test(claim.batchId) || !/^[\w-]{43}$/.test(claim.token))
      throw new Error("Invalid attachment session");
    return `${root}/batches/${claim.batchId}`;
  };
  const filePath = (claim, id) => {
    if (!uuid.test(id)) throw new Error("Invalid attachment");
    return `${batchPath(claim)}/files/${id}`;
  };
  const checkedBlob = async (promise) => {
    const blob = await promise;
    if (
      !["image/jpeg", "image/png", "image/webp"].includes(blob.type) ||
      blob.size > 5242880
    )
      throw new Error("Attachment unavailable");
    return blob;
  };
  return {
    policy: (signal) => api.get("/intake/attachments/policy", { signal }),
    async start(binding, signal) {
      if (staff && !uuid.test(binding.requestId))
        throw new Error("Invalid request");
      const result = await api.post(
        staff
          ? `${root}/requests/${binding.requestId}/batches`
          : `${root}/batches`,
        staff
          ? { context: binding.context }
          : { issueId: binding.issueId, versionId: binding.versionId },
        options(signal),
      );
      if (!uuid.test(result?.batchId) || !/^[\w-]{43}$/.test(result.token))
        throw new Error("Attachment staging unavailable");
      return { batchId: result.batchId, token: result.token };
    },
    async upload(claim, id, file, signal) {
      const form = new FormData();
      form.append("file", file);
      return attachmentProjection(
        await api.upload(filePath(claim, id), form, options(signal, claim)),
      );
    },
    remove: (claim, id, signal) =>
      api.remove(
        id ? filePath(claim, id) : batchPath(claim),
        options(signal, claim),
      ),
    preview: (claim, id, signal) =>
      checkedBlob(api.blob(filePath(claim, id), options(signal, claim))),
    async evidence(id, signal) {
      if (!uuid.test(id)) throw new Error("Invalid request");
      const result = await api.get(
        `${root}/requests/${id}/evidence`,
        options(signal),
      );
      if (!Array.isArray(result?.items) || result.items.length > 5)
        throw new Error("Attachment unavailable");
      return result.items.map(attachmentProjection);
    },
    download(requestId, context, parentId, fileId, signal) {
      if (
        ![requestId, parentId, fileId].every((x) => uuid.test(x)) ||
        ![
          "REQUEST_EVIDENCE",
          "INTERNAL_NOTE",
          "REQUESTER_COMMUNICATION",
        ].includes(context)
      )
        throw new Error("Attachment unavailable");
      return checkedBlob(
        api.blob(
          `${root}/requests/${requestId}/${context}/${parentId}/files/${fileId}`,
          options(signal),
        ),
      );
    },
  };
}
