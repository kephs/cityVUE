export const accessPresets = [
  {
    id: "public-viewer",
    label: "PUBLIC Request Viewer",
    description: "Read PUBLIC requests within existing operational scope.",
    keys: ["service_request.view"],
  },
  {
    id: "public-work",
    label: "PUBLIC Request Work",
    description:
      "Read, start, hold, resume and close PUBLIC requests within existing scope.",
    keys: [
      "service_request.view",
      "service_request.start_work",
      "service_request.hold",
      "service_request.resume",
      "service_request.close",
    ],
  },
  {
    id: "issue-configuration",
    label: "Issue Configuration",
    description:
      "Read configuration and configure Issues. Issue Handling is selected separately.",
    keys: ["admin.configuration.read", "admin.issues.write"],
  },
];
export const canonical = (keys) => [...new Set(keys)].sort();
export const sameAccess = (a, b) =>
  JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
export function accessDraft(detail, desired) {
  const managed = detail.contributions
    .filter((c) => c.managed)
    .map((c) => c.key);
  const outside = detail.contributions
    .filter((c) => c.existing)
    .map((c) => c.key);
  const effective = canonical([...outside, ...desired]);
  const metadata = new Map(detail.permissions.map((p) => [p.key, p]));
  const added = desired.filter((k) => !managed.includes(k));
  const removed = managed.filter((k) => !desired.includes(k));
  const violations = effective.flatMap((key) => {
    const p = metadata.get(key);
    return p?.classification === "manageable"
      ? (p.requires || [])
          .filter((k) => !effective.includes(k))
          .map((required) => ({ key, required }))
      : [];
  });
  const prerequisites = [
    "admin.configuration.read",
    "admin.access.read",
    "admin.access.manage",
  ];
  return {
    managed,
    outside,
    effective,
    added,
    removed,
    remains: removed.filter((k) => outside.includes(k)),
    sensitive: added.filter((k) => metadata.get(k)?.sensitive),
    violations,
    changesAdministrator:
      prerequisites.every((k) => detail.effective.includes(k)) !==
      prerequisites.every((k) => effective.includes(k)),
    dirty: !sameAccess(managed, desired),
  };
}
export function requiredAccess(detail, desired) {
  const next = new Set(desired);
  for (let i = 0; i < detail.permissions.length; i++) {
    const missing = accessDraft(detail, [...next]).violations.map(
      (v) => v.required,
    );
    const add = missing.filter(
      (k) =>
        detail.permissions.some(
          (p) => p.key === k && p.classification === "manageable",
        ) && !next.has(k),
    );
    if (!add.length) break;
    add.forEach((k) => next.add(k));
  }
  return canonical([...next]);
}
export function presetAccess(preset, detail) {
  const managed = new Set(
    detail.contributions.filter((c) => c.managed).map((c) => c.key),
  );
  const outside = new Set(
    detail.contributions.filter((c) => c.existing).map((c) => c.key),
  );
  return canonical(
    preset.keys.filter((k) => !outside.has(k) || managed.has(k)),
  );
}
