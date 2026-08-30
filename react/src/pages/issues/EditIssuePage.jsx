import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";

import IssueService from "../../../../assets/services/IssueService.js";
import { matchLegacyIssueToService } from "../../catalog/legacyIssueMatching.js";
import "./issues.css";

const fields = ["title", "description", "category", "priority", "reportedBy", "location"];
const categoryOptions = ["Road", "Lighting", "Water", "Garbage", "Parks", "Other"];
const priorityOptions = ["Low", "Medium", "High"];

function formatReportedDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "Unknown" : date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function initialValues(issue) {
    return Object.fromEntries(fields.map((field) => [field, String(issue?.[field] ?? "")]));
}

export default function EditIssuePage({ getIssue = (id) => IssueService.getIssueById(id), updateIssue = (issue) => IssueService.updateIssue(issue) }) {
    const { issueId } = useParams();
    const navigate = useNavigate();
    const [lookup] = useState(() => {
        try { return { issue: getIssue(issueId), failed: false }; }
        catch { return { issue: null, failed: true }; }
    });
    const [values, setValues] = useState(() => initialValues(lookup.issue));
    const [errors, setErrors] = useState({});
    const [submitError, setSubmitError] = useState("");
    const match = matchLegacyIssueToService(lookup.issue);

    if (!lookup.issue) {
        return <section className="edit-issue-page" aria-labelledby="edit-issue-heading"><h1 id="edit-issue-heading">Issue Not Found</h1><div className="alert alert-danger" role="alert">{lookup.failed ? "The issue could not be loaded. Please try again." : "The requested issue does not exist."}</div><Link className="btn btn-outline-primary" to="/issues">Back to Issue List</Link></section>;
    }

    const change = (name, value) => {
        setValues((current) => ({ ...current, [name]: value }));
        setErrors((current) => ({ ...current, [name]: "" }));
    };
    const submit = (event) => {
        event.preventDefault();
        const nextErrors = Object.fromEntries(fields.filter((field) => !values[field].trim()).map((field) => [field, "This field is required."]));
        setErrors(nextErrors);
        if (Object.keys(nextErrors).length) return;
        const updated = { ...lookup.issue, ...Object.fromEntries(fields.map((field) => [field, values[field].trim()])), id: lookup.issue.id, dateReported: lookup.issue.dateReported, status: lookup.issue.status };
        try {
            if (!updateIssue(updated)) throw new Error("not updated");
            navigate("/issues", { state: { notice: "Issue updated successfully." } });
        } catch {
            setSubmitError("The issue could not be updated. Please try again.");
        }
    };
    const input = (name, label) => <div className="edit-field"><label className="form-label" htmlFor={`edit-${name}`}>{label} <span aria-hidden="true">*</span></label><input className={`form-control${errors[name] ? " is-invalid" : ""}`} id={`edit-${name}`} value={values[name]} onChange={(event) => change(name, event.target.value)} aria-invalid={Boolean(errors[name])} aria-describedby={errors[name] ? `edit-${name}-error` : undefined} required />{errors[name] && <div className="invalid-feedback" id={`edit-${name}-error`}>{errors[name]}</div>}</div>;
    const contextTitle = match ? `${match.category.name} › ${match.service.name}` : values.title;
    const contextDescription = match ? "Some original submitted details are preserved in the request description." : "This earlier request remains editable without changing its original catalog identity.";

    return (
        <section className="edit-issue-page" aria-labelledby="edit-issue-heading">
            <header className="edit-page-header"><Link className="edit-back-link" to="/issues"><i className="bi bi-arrow-left" aria-hidden="true" />Back to Issue List</Link><p className="text-primary fw-semibold mb-1">Issue management</p><h1 id="edit-issue-heading">Edit Issue</h1><p className="text-body-secondary mb-0">Update the request details below.</p></header>
            <section className={`edit-context-card${match ? " catalog-matched" : " legacy-request"}`} aria-labelledby="edit-context-heading"><div className="edit-context-icon" aria-hidden="true"><i className={`bi ${match ? match.category.icon : "bi-file-earmark-text"}`} /></div><div className="edit-context-copy"><div className="edit-context-kicker"><span className="edit-context-badge">{match ? "Catalog matched" : "Legacy request"}</span></div><h2 className="h4 mb-1" id="edit-context-heading">{contextTitle}</h2><p className="mb-0">{contextDescription}</p></div></section>
            <section className="request-summary" aria-labelledby="request-summary-heading"><div className="request-summary-heading"><h2 className="h5 mb-0" id="request-summary-heading">Request Information</h2><span className={`badge ${lookup.issue.status === "Open" ? "text-bg-success" : lookup.issue.status === "In Progress" ? "text-bg-warning" : "text-bg-secondary"}`}>{lookup.issue.status}</span></div><dl className="request-metadata"><div><dt>Date Reported</dt><dd>{formatReportedDate(lookup.issue.dateReported)}</dd></div><div><dt>{match ? "Category / Service" : "Category"}</dt><dd>{match ? contextTitle : values.category}</dd></div><div><dt>Priority</dt><dd>{values.priority}</dd></div><div><dt>Reporter</dt><dd>{values.reportedBy === "Anonymous" ? "Anonymous submission" : values.reportedBy}</dd></div>{match && <div><dt>Request Title</dt><dd>{values.title}</dd></div>}</dl></section>
            <form className="card edit-form-card border-0 shadow-sm" noValidate onSubmit={submit}><div className="card-body p-3 p-md-4 p-lg-5">
                {submitError && <div className="alert alert-danger" role="alert">{submitError}</div>}
                {!match && <section className="edit-form-section" aria-labelledby="identity-heading"><h2 className="edit-section-heading" id="identity-heading"><i className="bi bi-card-heading" aria-hidden="true" />Request Identity</h2><div className="edit-field-grid">{input("title", "Title")}<div className="edit-field"><label className="form-label" htmlFor="edit-category">Category <span aria-hidden="true">*</span></label><select className={`form-select${errors.category ? " is-invalid" : ""}`} id="edit-category" value={values.category} onChange={(event) => change("category", event.target.value)} aria-invalid={Boolean(errors.category)} aria-describedby={errors.category ? "edit-category-error" : undefined} required><option value="">Choose a category</option>{categoryOptions.map((option) => <option key={option}>{option}</option>)}</select>{errors.category && <div className="invalid-feedback" id="edit-category-error">{errors.category}</div>}</div></div></section>}
                <section className="edit-form-section" aria-labelledby="details-heading"><h2 className="edit-section-heading" id="details-heading"><i className="bi bi-text-paragraph" aria-hidden="true" />Request Details</h2><div className="edit-field"><label className="form-label" htmlFor="edit-description">Request Details <span aria-hidden="true">*</span></label><p className="form-text" id="edit-description-help">This contains the information originally submitted with the request.</p><textarea className={`form-control edit-description${errors.description ? " is-invalid" : ""}`} id="edit-description" value={values.description} onChange={(event) => change("description", event.target.value)} aria-invalid={Boolean(errors.description)} aria-describedby={`edit-description-help${errors.description ? " edit-description-error" : ""}`} required />{errors.description && <div className="invalid-feedback" id="edit-description-error">{errors.description}</div>}</div></section>
                <section className="edit-form-section" aria-labelledby="settings-heading"><h2 className="edit-section-heading" id="settings-heading"><i className="bi bi-sliders" aria-hidden="true" />Request Settings</h2><div className="edit-field-grid"><div className={`edit-field priority-field priority-${values.priority.toLowerCase()}`}><label className="form-label" htmlFor="edit-priority">Priority <span aria-hidden="true">*</span></label><select className={`form-select${errors.priority ? " is-invalid" : ""}`} id="edit-priority" value={values.priority} onChange={(event) => change("priority", event.target.value)} required>{priorityOptions.map((option) => <option key={option}>{option}</option>)}</select>{errors.priority && <div className="invalid-feedback">{errors.priority}</div>}</div>{input("reportedBy", values.reportedBy === "Anonymous" ? "Reporter — Anonymous submission" : "Reporter")}</div></section>
                <section className="edit-form-section location-section" aria-labelledby="location-heading"><h2 className="edit-section-heading" id="location-heading"><i className="bi bi-geo-alt" aria-hidden="true" />Location</h2>{input("location", "Issue Location")}</section>
            </div><div className="card-footer edit-action-footer"><Link className="btn btn-outline-secondary" to="/issues">Cancel</Link><button className="btn btn-primary" type="submit"><i className="bi bi-save me-2" aria-hidden="true" />Save Changes</button></div></form>
        </section>
    );
}
