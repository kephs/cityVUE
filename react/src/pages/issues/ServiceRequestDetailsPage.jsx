import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { createServiceRequestDetailsData } from "../../serviceRequests/serviceRequestDetailsData.js";
import "./serviceRequestDetails.css";

const dateTime = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" });
const words = (value) => String(value || "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
const formatDate = (value) => { const date = new Date(value); return Number.isNaN(date.valueOf()) ? "" : dateTime.format(date); };

function Panel({ title, icon, children }) {
    return <section className="request-details-panel" aria-labelledby={`details-${title.toLowerCase().replaceAll(" ", "-")}`}><h2 id={`details-${title.toLowerCase().replaceAll(" ", "-")}`}><i className={`bi ${icon}`} aria-hidden="true" />{title}</h2>{children}</section>;
}

export default function ServiceRequestDetailsPage({ data: suppliedData }) {
    const { issueId } = useParams();
    const data = useMemo(() => suppliedData || createServiceRequestDetailsData(), [suppliedData]);
    const [state, setState] = useState({ loading: data.mode === "api", details: null, error: "" });
    const load = useCallback(async (signal) => {
        if (data.mode !== "api") return;
        setState({ loading: true, details: null, error: "" });
        try { setState({ loading: false, details: await data.repository.getServiceRequestDetails(issueId, { signal }), error: "" }); }
        catch (error) { if (error.code !== "cancelled") setState({ loading: false, details: null, error: error.code === "not-found" ? "not-found" : "generic" }); }
    }, [data, issueId]);
    useEffect(() => { const controller = new AbortController(); load(controller.signal); return () => controller.abort(); }, [load]);

    if (data.mode !== "api") return <section className="service-request-details details-state" aria-labelledby="details-unavailable"><h1 id="details-unavailable">Request details unavailable</h1><p>Canonical request details are available only in an explicitly enabled local API development environment.</p><Link className="btn btn-primary" to="/issues">Back to Issue List</Link></section>;
    if (state.loading) return <section className="service-request-details details-state" aria-live="polite"><div className="spinner-border text-primary" aria-hidden="true" /><h1>Loading request details…</h1></section>;
    if (state.error === "not-found") return <section className="service-request-details details-state"><h1>Request not found</h1><p>The requested service request is unavailable.</p><Link className="btn btn-primary" to="/report">Report an Issue</Link></section>;
    if (state.error) return <section className="service-request-details details-state" role="alert"><h1>Request details could not be loaded</h1><p>Please try again. No request information was changed.</p><button className="btn btn-primary" type="button" onClick={() => load()}>Try again</button></section>;
    const details = state.details; const request = details.serviceRequest; const classification = details.classification;
    return <article className="service-request-details">
        <Link className="details-back-link" to="/report"><i className="bi bi-arrow-left" />Back to Report an Issue</Link>
        <header className="request-details-header"><div><p className="details-eyebrow">Service Request Details</p><h1>{classification.issueName}</h1><p className="details-reference">{request.referenceNumber}</p></div><div className="details-badges"><span className="badge text-bg-success">Status: {words(request.status)}</span><span className="badge text-bg-primary">Priority: {words(request.priority)}</span></div></header>
        <div className="request-details-grid">
            <Panel title="Classification" icon="bi-diagram-3"><dl><div><dt>Department</dt><dd>{classification.department.name}</dd></div>{classification.division && <div><dt>Division</dt><dd>{classification.division.name}</dd></div>}<div><dt>Category</dt><dd>{classification.category.name}</dd></div></dl></Panel>
            <Panel title="Reported" icon="bi-calendar-event"><dl><div><dt>Created</dt><dd>{formatDate(request.createdAt)}</dd></div>{request.updatedAt !== request.createdAt && <div><dt>Updated</dt><dd>{formatDate(request.updatedAt)}</dd></div>}</dl></Panel>
            {details.location && <Panel title="Location" icon="bi-geo-alt"><p className="details-prose">{details.location.enteredAddress}</p><p className="details-meta">{words(details.location.locationType)}</p></Panel>}
            <Panel title="Requester" icon="bi-person"><p className="details-prose">{details.requester.anonymous ? "Anonymous" : details.requester.name}</p>{details.requester.email && <p><a href={`mailto:${details.requester.email}`}>{details.requester.email}</a></p>}</Panel>
            <Panel title="Resident Description" icon="bi-chat-left-text"><p className="details-prose">{details.request.description}</p></Panel>
            {details.answers.length > 0 && <Panel title="Additional Information" icon="bi-list-check"><dl className="details-answer-list">{details.answers.map((answer) => <div key={answer.questionId}><dt>{answer.label}</dt><dd>{answer.displayValue}</dd></div>)}</dl></Panel>}
            <Panel title="Activity" icon="bi-clock-history"><ol className="details-activity">{details.activity.map((entry, index) => <li key={`${entry.occurredAt}-${index}`}><strong>{words(entry.type)}</strong><span>{words(entry.actorType)} · {formatDate(entry.occurredAt)}</span></li>)}</ol></Panel>
        </div>
    </article>;
}
