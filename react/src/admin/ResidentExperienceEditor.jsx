import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/AuthContext.jsx";
import { adaptResidentExperience } from "../pages/home/residentExperienceAdapter.js";
import {
  newResidentDraft,
  normalizedPhone,
  draftErrors,
} from "./residentExperienceDraft.js";
import ResidentExperiencePreview from "./ResidentExperiencePreview.jsx";
import "./residentExperience.css";

const base = "/admin/resident-experience";
const sections = [
  ["branding", "Branding"],
  ["hero", "Hero"],
  ["actions", "Resident Actions"],
  ["contacts", "Contacts"],
  ["benefits", "Benefits"],
  ["footer", "Footer"],
];
const at = (object, path) => path.reduce((value, key) => value[key], object);
const sectionValue = (draft, id) => {
  const p = draft.presentation;
  return {
    branding: [p.branding, p.metadata],
    hero: p.hero,
    actions: [p.actionsTitle, draft.actions],
    contacts: draft.contacts,
    benefits: [p.benefitsLabel, draft.benefits],
    footer: p.footer,
  }[id];
};
// Classify existing validation messages for navigation; do not add validation rules.
const errorSection = (message) => {
  if (message.startsWith("Actions")) return "actions";
  if (message.startsWith("Benefits")) return "benefits";
  if (message.startsWith("Contacts")) return "contacts";
  if (message === "Public application name is required.") return "branding";
  return null;
};
export default function ResidentExperienceEditor({ client }) {
  const auth = useAuth();
  const context = JSON.stringify([
    auth.enabled,
    auth.isAuthenticated,
    auth.account?.homeAccountId,
    auth.account?.localAccountId,
    auth.account?.tenantId,
  ]);
  const [state, setState] = useState(null),
    [attempt, setAttempt] = useState(0);
  const [activeTab, setActiveTab] = useState("branding");
  const tabRefs = useRef({});
  const generation = useRef(0),
    controllers = useRef(new Set());
  const current =
    state?.client === client && state.context === context ? state : null;
  useEffect(() => {
    const id = ++generation.current;
    setState(null);
    setActiveTab("branding");
    const controller = new AbortController();
    controllers.current.add(controller);
    if (auth.enabled && auth.isAuthenticated)
      client.get(base, { authenticated: true, signal: controller.signal }).then(
        (summary) => {
          if (generation.current === id && !controller.signal.aborted)
            setState({
              client,
              context,
              summary,
              draft: summary.draft || newResidentDraft(),
              busy: false,
              errors: [],
            });
        },
        () => {
          if (generation.current === id && !controller.signal.aborted)
            setState({ client, context, denied: true });
        },
      );
    return () => {
      generation.current++;
      for (const c of controllers.current) c.abort();
      controllers.current.clear();
    };
  }, [client, context, attempt, auth.enabled, auth.isAuthenticated]);
  function change(path, value) {
    setState((old) => {
      const draft = structuredClone(old.draft);
      const target = at(draft, path.slice(0, -1));
      target[path.at(-1)] = value;
      return { ...old, draft, dirty: true, preview: null, message: null };
    });
  }
  async function operation(preview) {
    const id = ++generation.current;
    let reauthorizing = false;
    if (!preview) {
      const errors = draftErrors(current.draft);
      if (errors.length) {
        setState((s) => ({ ...s, errors }));
        return;
      }
    }
    const controller = new AbortController();
    controllers.current.add(controller);
    setState((s) => ({
      ...s,
      busy: true,
      errors: [],
      preview: null,
      message: null,
    }));
    try {
      const result = preview
        ? await client.get(`${base}/preview`, {
            authenticated: true,
            signal: controller.signal,
          })
        : await client.put(
            `${base}/draft`,
            {
              expectedRevision: current.summary.revision,
              snapshot: current.draft,
            },
            { authenticated: true, signal: controller.signal },
          );
      if (id !== generation.current || controller.signal.aborted) return;
      if (preview)
        setState((s) => ({
          ...s,
          busy: false,
          preview: adaptResidentExperience(result.presentation),
          previewRevision: result.revision,
        }));
      else {
        // Reauthorize before keeping saved content/capabilities; never blindly retry PUT.
        reauthorizing = true;
        const summary = await client.get(base, {
          authenticated: true,
          signal: controller.signal,
        });
        if (id === generation.current && !controller.signal.aborted)
          setState({
            client,
            context,
            summary,
            draft: summary.draft || newResidentDraft(),
            busy: false,
            errors: [],
            message: result.changed
              ? "Draft saved. Public content is unchanged."
              : "No changes to save.",
          });
      }
    } catch (error) {
      if (id !== generation.current || controller.signal.aborted) return;
      if (reauthorizing || [401, 403].includes(error.status)) {
        generation.current++;
        setState({ client, context, denied: true });
      } else
        setState((s) => ({
          ...s,
          busy: false,
          conflict: error.status === 409,
          errors: [
            error.status === 409
              ? "The draft changed elsewhere. Reload and review before saving; your changes were not retried."
              : error.status === 400
                ? "Draft is invalid. Review required text, unique orders, registry keys, phone numbers and destinations."
                : "Unable to complete this operation. Reload and review the current saved draft before trying again.",
          ],
          uncertain: !preview && error.status !== 400,
        }));
    } finally {
      controllers.current.delete(controller);
    }
  }
  if (!auth.enabled || !auth.isAuthenticated || current?.denied)
    return (
      <p role="alert">
        Resident Experience access is not authorized. Sign in or reload
        Administration to reauthorize.
      </p>
    );
  if (!current?.draft) return <p role="status">Loading resident experience…</p>;
  const { draft, summary, busy } = current;
  const write = summary.capabilities.canWrite,
    contact = summary.capabilities.canManageContacts;
  const p = draft.presentation,
    registry = summary.registry;
  const savedDraft = summary.draft || newResidentDraft();
  function panelProps(id) {
    return {
      id: `resident-editor-${id}`,
      role: "tabpanel",
      "aria-labelledby": `resident-tab-${id}`,
      hidden: activeTab !== id,
      tabIndex: 0,
      className: "resident-editor-panel",
    };
  }
  function tabKeyDown(event, index) {
    let next;
    if (event.key === "ArrowRight") next = (index + 1) % sections.length;
    else if (event.key === "ArrowLeft")
      next = (index + sections.length - 1) % sections.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = sections.length - 1;
    else return;
    event.preventDefault();
    const id = sections[next][0];
    setActiveTab(id);
    tabRefs.current[id]?.focus();
  }
  const assets = (role) =>
    Object.entries(registry.assets)
      .filter(([, value]) => value.role === role)
      .map(([key]) => key);
  function field(label, path, options = {}) {
    const value = at(draft, path);
    const disabled = busy || !write || (options.contact && !contact);
    return (
      <label
        key={path.join(".")}
        className={
          typeof value === "boolean" ? "resident-editor-check" : undefined
        }
      >
        {label}
        {options.choices ? (
          <select
            className="form-select"
            disabled={disabled}
            value={value ?? ""}
            onChange={(e) => change(path, e.target.value || null)}
          >
            {options.choices.map((key) => (
              <option key={key} value={key}>
                {key || "None"}
              </option>
            ))}
          </select>
        ) : (
          <input
            className={
              typeof value === "boolean" ? "form-check-input" : "form-control"
            }
            disabled={disabled}
            type={
              typeof value === "boolean"
                ? "checkbox"
                : typeof value === "number"
                  ? "number"
                  : "text"
            }
            value={typeof value === "boolean" ? undefined : (value ?? "")}
            checked={typeof value === "boolean" ? value : undefined}
            maxLength={options.max || 500}
            onChange={(e) =>
              change(
                path,
                typeof value === "boolean"
                  ? e.target.checked
                  : typeof value === "number"
                    ? Number(e.target.value)
                    : path.at(-1) === "organizationDisplayName" &&
                        e.target.value === ""
                      ? null
                      : e.target.value,
              )
            }
          />
        )}
      </label>
    );
  }
  const textFields = (root, object, keys, options) =>
    keys.map(([key, label]) => field(label, [...root, key], options));
  function add(collection, item, max) {
    if (draft[collection].length < max)
      change([collection], [...draft[collection], item]);
  }
  function nextId(collection) {
    let n = 1;
    while (draft[collection].some((r) => r.id === `${collection}-${n}`)) n++;
    return `${collection}-${n}`;
  }
  return (
    <div className="resident-editor">
      <p className="resident-editor-help">
        Saving changes does not publish them. The status below reflects the
        saved draft.
      </p>
      <dl className="resident-editor-summary">
        <div>
          <dt>Draft revision</dt>
          <dd>{summary.revision}</dd>
        </div>
        <div>
          <dt>Publication</dt>
          <dd>
            {summary.hasPublication
              ? "Separate publication active"
              : "No publication exists"}
          </dd>
        </div>
        <div>
          <dt>High-impact changes</dt>
          <dd>{summary.consequential ? "Detected" : "None detected"}</dd>
        </div>
        <div>
          <dt>Editing status</dt>
          <dd aria-live="polite">
            {current.conflict || current.uncertain
              ? "Reload and review required"
              : current.dirty
                ? "Unsaved changes"
                : summary.draft
                  ? "Saved"
                  : "Not saved yet"}
          </dd>
        </div>
      </dl>
      {!contact && (
        <p>
          Contacts, actions and navigation destinations are read-only without
          contact authority. Their saved values are preserved.
        </p>
      )}
      {!summary.draft && (
        <p>
          New drafts start with generic content and no contact details. Contact
          permission is required to add contact-based actions.
        </p>
      )}
      {current.errors?.map((message) => (
        <p role="alert" key={message}>
          {message}
        </p>
      ))}
      {current.message && <p role="status">{current.message}</p>}
      <div className="resident-editor-action-bar">
        <div
          className="resident-editor-actions"
          role="group"
          aria-label="Draft actions"
        >
          <button
            className="btn btn-primary"
            disabled={!write || busy || current.conflict || current.uncertain}
            onClick={() => operation(false)}
          >
            Save complete draft
          </button>
          <button
            className="btn btn-outline-primary"
            aria-describedby="resident-preview-help"
            disabled={busy || !summary.draft}
            onClick={() => operation(true)}
          >
            Preview saved draft
          </button>
          <button
            className="btn btn-outline-secondary"
            disabled={busy}
            onClick={() => {
              setState(null);
              setAttempt((n) => n + 1);
            }}
          >
            Reload saved draft (discard edits)
          </button>
        </div>
        <p id="resident-preview-help" className="resident-editor-help">
          {!summary.draft
            ? "Save a draft before preview is available."
            : busy
              ? "Please wait for the current operation to finish."
              : current.dirty
                ? "Preview shows the saved draft. Save changes to include your edits."
                : "Preview shows the saved draft. Reload discards unsaved edits."}
        </p>
      </div>
      <div
        className="resident-editor-tabs"
        role="tablist"
        aria-label="Resident Experience sections"
      >
        {sections.map(([id, label], index) => {
          const dirty =
            JSON.stringify(sectionValue(draft, id)) !==
            JSON.stringify(sectionValue(savedDraft, id));
          const errors = (current.errors || []).filter(
            (message) => errorSection(message) === id,
          ).length;
          return (
            <button
              key={id}
              type="button"
              role="tab"
              aria-label={label}
              id={`resident-tab-${id}`}
              aria-controls={`resident-editor-${id}`}
              aria-selected={activeTab === id}
              aria-describedby={
                dirty || errors ? `resident-tab-status-${id}` : undefined
              }
              tabIndex={activeTab === id ? 0 : -1}
              ref={(node) => {
                tabRefs.current[id] = node;
              }}
              onClick={() => setActiveTab(id)}
              onKeyDown={(event) => tabKeyDown(event, index)}
            >
              {label}
              {dirty && (
                <span className="resident-tab-dirty" aria-hidden="true">
                  •
                </span>
              )}
              {errors > 0 && (
                <span className="resident-tab-errors" aria-hidden="true">
                  {errors}
                </span>
              )}
              {(dirty || errors > 0) && (
                <span
                  id={`resident-tab-status-${id}`}
                  className="visually-hidden"
                >
                  {[
                    dirty && "Unsaved changes",
                    errors > 0 &&
                      `${errors} validation ${errors === 1 ? "error" : "errors"}`,
                  ]
                    .filter(Boolean)
                    .join("; ")}
                </span>
              )}
            </button>
          );
        })}
      </div>
      <fieldset {...panelProps("branding")}>
        <legend>Branding</legend>
        <div className="resident-editor-fields">
          {textFields(["presentation", "branding"], p.branding, [
            ["applicationName", "Public application name"],
            ["organizationDisplayName", "Organization display name"],
          ])}
          {field("Logo", ["presentation", "branding", "logoKey"], {
            choices: assets("logo"),
          })}
          {field("Wordmark", ["presentation", "branding", "wordmarkKey"], {
            choices: assets("wordmark"),
          })}
          {field("Favicon", ["presentation", "branding", "faviconKey"], {
            choices: assets("favicon"),
          })}
          {field("Theme", ["presentation", "branding", "themeKey"], {
            choices: registry.themes,
          })}
          {textFields(["presentation", "metadata"], p.metadata, [
            ["title", "Page title"],
            ["description", "Page description"],
          ])}
        </div>
      </fieldset>
      <fieldset {...panelProps("hero")}>
        <legend>Hero</legend>
        <div className="resident-editor-fields">
          {p.hero.taglineWords.map((_, i) =>
            field(`Tagline word ${i + 1}`, [
              "presentation",
              "hero",
              "taglineWords",
              i,
            ]),
          )}
          {p.hero.headline.map((_, i) => (
            <div key={i}>
              {field(`Headline segment ${i + 1}`, [
                "presentation",
                "hero",
                "headline",
                i,
                "text",
              ])}
              {field(`Highlight segment ${i + 1}`, [
                "presentation",
                "hero",
                "headline",
                i,
                "highlighted",
              ])}
            </div>
          ))}
          {field("Hero asset", ["presentation", "hero", "assetKey"], {
            choices: assets("hero"),
          })}
          {field("Decorative hero", ["presentation", "hero", "decorative"])}
          {field("Hero alt text (empty when decorative)", [
            "presentation",
            "hero",
            "alt",
          ])}
        </div>
      </fieldset>
      <fieldset {...panelProps("actions")}>
        <legend>Resident Actions</legend>
        {field("Actions heading", ["presentation", "actionsTitle"])}
        {draft.actions.map((a, i) => (
          <fieldset key={a.id} className="resident-editor-card">
            <legend>Action {i + 1}</legend>
            <div className="resident-editor-fields">
              {textFields(
                ["actions", i],
                a,
                [
                  ["enabled", "Enabled"],
                  ["order", "Order"],
                  ["title", "Title"],
                  ["description", "Description"],
                  ["ctaLabel", "CTA label (use {phone} for number only)"],
                ],
                { contact: true },
              )}
              {field("Icon", ["actions", i, "iconKey"], {
                contact: true,
                choices: registry.actionIcons,
              })}
              <label>
                Action type
                <select
                  className="form-select"
                  disabled={!contact || busy}
                  value={a.actionType}
                  onChange={(e) =>
                    change(["actions", i], {
                      ...a,
                      actionType: e.target.value,
                      target:
                        e.target.value === "phone"
                          ? null
                          : e.target.value === "internal"
                            ? "/report"
                            : "",
                      contactId: null,
                    })
                  }
                >
                  {["internal", "external", "phone"].map((key) => (
                    <option key={key}>{key}</option>
                  ))}
                </select>
              </label>
              {a.actionType === "phone"
                ? field("Contact", ["actions", i, "contactId"], {
                    contact: true,
                    choices: ["", ...draft.contacts.map((c) => c.id)],
                  })
                : field("Destination", ["actions", i, "target"], {
                    contact: true,
                    ...(a.actionType === "internal"
                      ? { choices: registry.routes }
                      : {}),
                  })}
              {field("Tone", ["actions", i, "tone"], {
                contact: true,
                choices: registry.tones,
              })}
            </div>
            <button
              disabled={!contact || busy}
              className="btn btn-outline-secondary btn-sm resident-editor-remove"
              onClick={() =>
                change(
                  ["actions"],
                  draft.actions.filter((_, n) => n !== i),
                )
              }
            >
              Remove action {i + 1}
            </button>
          </fieldset>
        ))}
        <button
          className="btn btn-outline-primary"
          disabled={!contact || busy || draft.actions.length >= 6}
          onClick={() =>
            add(
              "actions",
              {
                id: nextId("actions"),
                enabled: true,
                order: Math.max(0, ...draft.actions.map((a) => a.order)) + 10,
                iconKey: "report",
                title: "New action",
                description: "Describe this action",
                ctaLabel: "Report Issue",
                actionType: "internal",
                target: "/report",
                contactId: null,
                tone: "primary",
              },
              6,
            )
          }
        >
          Add action
        </button>
      </fieldset>
      <fieldset {...panelProps("contacts")}>
        <legend>Contacts</legend>
        <p className="resident-editor-help">
          Contacts provide structured phone numbers and dialing values used by
          configured phone actions.
        </p>
        {draft.contacts.length === 0 && (
          <p className="resident-editor-empty">
            No contacts configured yet. Add a contact to use structured phone
            details in Resident Actions.
          </p>
        )}
        {draft.contacts.map((c, i) => (
          <fieldset key={c.id}>
            <legend>Contact {c.id}</legend>
            <div className="resident-editor-fields">
              <label>
                Display phone
                <input
                  className="form-control"
                  disabled={!contact || busy}
                  value={c.displayValue}
                  maxLength={32}
                  onChange={(e) =>
                    change(["contacts", i], {
                      ...c,
                      displayValue: e.target.value,
                      phoneTarget: normalizedPhone(e.target.value),
                    })
                  }
                />
              </label>
              <label>
                Dialing target
                <input
                  className="form-control"
                  value={c.phoneTarget}
                  readOnly
                />
              </label>
              {field("Classification", ["contacts", i, "classification"], {
                contact: true,
                choices: ["emergency", "non_emergency"],
              })}
              {field("Guidance", ["contacts", i, "guidance"], {
                contact: true,
              })}
            </div>
            <button
              className="btn btn-outline-danger mt-2"
              disabled={
                !contact ||
                busy ||
                draft.actions.some((a) => a.contactId === c.id)
              }
              onClick={() =>
                change(
                  ["contacts"],
                  draft.contacts.filter((_, n) => n !== i),
                )
              }
            >
              Remove contact {c.id}
            </button>
          </fieldset>
        ))}
        <button
          className="btn btn-outline-primary"
          disabled={!contact || busy || draft.contacts.length >= 12}
          onClick={() =>
            add(
              "contacts",
              {
                id: nextId("contacts"),
                kind: "phone",
                classification: "non_emergency",
                displayValue: "",
                phoneTarget: "",
                guidance: "",
              },
              12,
            )
          }
        >
          Add contact
        </button>
      </fieldset>
      <fieldset {...panelProps("benefits")}>
        <legend>Benefits</legend>
        <div className="resident-benefits-label">
          {field("Section label", ["presentation", "benefitsLabel"])}
          <p className="resident-editor-help">
            This label identifies the benefits section on the resident homepage.
          </p>
        </div>
        {draft.benefits.map((b, i) => (
          <fieldset key={b.id} className="resident-benefit-card">
            <legend>Benefit {i + 1}</legend>
            <div className="resident-benefit-settings">
              {field("Enabled", ["benefits", i, "enabled"])}
              {field("Order", ["benefits", i, "order"])}
              {field("Icon", ["benefits", i, "iconKey"], {
                choices: registry.benefitIcons,
              })}
            </div>
            <div className="resident-benefit-copy">
              {field("Title", ["benefits", i, "title"])}
              {field("Description", ["benefits", i, "description"])}
            </div>
            <div className="resident-benefit-actions">
              <button
                className="btn btn-outline-secondary btn-sm resident-editor-remove"
                disabled={!write || busy}
                onClick={() =>
                  change(
                    ["benefits"],
                    draft.benefits.filter((_, n) => n !== i),
                  )
                }
              >
                Remove benefit {i + 1}
              </button>
            </div>
          </fieldset>
        ))}
        <button
          className="btn btn-outline-primary"
          disabled={!write || busy || draft.benefits.length >= 4}
          onClick={() =>
            add(
              "benefits",
              {
                id: nextId("benefits"),
                enabled: true,
                order: Math.max(0, ...draft.benefits.map((b) => b.order)) + 10,
                iconKey: "community",
                title: "New benefit",
                description: "Describe this benefit",
              },
              4,
            )
          }
        >
          Add benefit
        </button>
      </fieldset>
      <fieldset {...panelProps("footer")}>
        <legend>Footer</legend>
        <div className="resident-editor-fields">
          {field("Footer message", ["presentation", "footer", "tagline"])}
          {field("Footer wordmark", ["presentation", "footer", "wordmarkKey"], {
            choices: assets("wordmark"),
          })}
          {field("Show theme toggle", [
            "presentation",
            "footer",
            "showThemeToggle",
          ])}
        </div>
      </fieldset>
      {current.preview && (
        <ResidentExperiencePreview
          presentation={current.preview}
          onClose={() => setState((s) => ({ ...s, preview: null }))}
        />
      )}
    </div>
  );
}
