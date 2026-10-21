/**
 * F069 frontend-only boundary. No API, tenant identifier, storage or mutation
 * transport is accepted here. A future authorized adapter must replace this
 * boundary, not merge tenant records with these fictional examples.
 * Editable fields map to department.name/description/status/display_order.
 * IDs and relationship labels below are presentation-only fictional keys.
 */
export const departmentStatuses = ["active", "inactive", "archived"];
export const statusLabel = (status) =>
  status.charAt(0).toUpperCase() + status.slice(1);

export function createDepartmentPreview() {
  return [
    {
      id: "example-public-works",
      name: "Public Works",
      description: "Fictional example of street and infrastructure services.",
      status: "active",
      displayOrder: 10,
      divisions: [{ id: "example-streets", name: "Street Maintenance" }],
      categories: [
        {
          name: "Roads",
          divisionId: "example-streets",
          services: ["Report a pothole", "Report a damaged sign"],
        },
      ],
    },
    {
      id: "example-parks",
      name: "Parks & Recreation",
      description: "Fictional example of parks and shared outdoor spaces.",
      status: "active",
      displayOrder: 20,
      divisions: [],
      categories: [
        {
          name: "Park Facilities",
          divisionId: null,
          services: ["Report damaged park equipment"],
        },
      ],
    },
    {
      id: "example-community",
      name: "Community Services",
      description:
        "Fictional inactive department for previewing configuration.",
      status: "inactive",
      displayOrder: 30,
      divisions: [],
      categories: [],
    },
    {
      id: "example-legacy",
      name: "Former Programs",
      description: "Fictional archived department retained for reference.",
      status: "archived",
      displayOrder: 40,
      divisions: [],
      categories: [],
    },
  ];
}

export function departmentDraft(record) {
  return {
    name: record?.name ?? "",
    description: record?.description ?? "",
    status: record?.status ?? "inactive",
    displayOrder: String(record?.displayOrder ?? 0),
  };
}

export function departmentErrors(draft, records, id) {
  const errors = {};
  const name = draft.name.trim();
  if (!name || Array.from(name).length > 200)
    errors.name = "Enter a department name of 1–200 characters.";
  else if (records.some((item) => item.id !== id && item.name === name))
    errors.name = "This name already exists in the fictional preview.";
  if (!departmentStatuses.includes(draft.status))
    errors.status = "Choose an available status.";
  if (
    !/^\d+$/.test(draft.displayOrder) ||
    Number(draft.displayOrder) > 2147483647
  )
    errors.displayOrder = "Enter a whole number from 0 to 2147483647.";
  return errors;
}
