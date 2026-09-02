import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import IssueService from "../../../../assets/services/IssueService.js";
import { getCategoryById, getServiceById, getVisibleQuestions, searchCategories, searchServices } from "../../catalog/catalogService.js";
import { mapIntakeToLegacyIssue } from "../../catalog/intakeCompatibility.js";
import { resolveIssueIcon } from "../issues/issueIconPresentation.js";
import IssueForm from "./IssueForm.jsx";
import "./report.css";

const initialValues = { description: "", location: "", reportingMode: "anonymous", reporterName: "" };
const stepLabels = { service: "Choose an issue", details: "Request details", review: "Review your request" };
const stepOrder = ["service", "details", "review"];

function StepProgress({ currentStep }) {
    const currentIndex = stepOrder.indexOf(currentStep);
    return (
        <nav className="intake-progress" aria-label="Request progress">
            <p className="visually-hidden" aria-live="polite">Step {currentIndex + 1} of 3: {stepLabels[currentStep]}</p>
            <ol>
                {stepOrder.map((stepName, index) => {
                    const state = index < currentIndex ? "completed" : index === currentIndex ? "current" : "upcoming";
                    return <li key={stepName} className={state} aria-current={state === "current" ? "step" : undefined}><span className="step-marker" aria-hidden="true">{state === "completed" ? <i className="bi bi-check-lg" /> : index + 1}</span><span>{stepName === "service" ? "Issue" : stepName === "details" ? "Details" : "Review"}</span><small>{state === "completed" ? "Completed" : state === "current" ? "Current" : "Upcoming"}</small></li>;
                })}
            </ol>
        </nav>
    );
}

function issueCountText(count) {
    return `${count} ${count === 1 ? "issue" : "issues"} found`;
}

function categoryCountText(count) {
    return `${count} ${count === 1 ? "category" : "categories"} found`;
}

export default function ReportIssuePage({ saveIssue = (issue) => IssueService.saveIssue(issue), createTimestamp = () => new Date().toISOString(), onSuccess }) {
    const navigate = useNavigate();
    const [step, setStep] = useState("service");
    const [categoryId, setCategoryId] = useState("");
    const [serviceId, setServiceId] = useState("");
    const [categorySearchQuery, setCategorySearchQuery] = useState("");
    const [searchQuery, setSearchQuery] = useState("");
    const [answers, setAnswers] = useState({});
    const [values, setValues] = useState(initialValues);
    const [errors, setErrors] = useState({});
    const [saveError, setSaveError] = useState("");
    const [isSubmitting, setIsSubmitting] = useState(false);
    const submissionInProgress = useRef(false);
    const issueSectionHeading = useRef(null);
    const categorySearchInput = useRef(null);
    const categories = useMemo(() => searchCategories(categorySearchQuery), [categorySearchQuery]);
    const services = useMemo(() => searchServices(categoryId, searchQuery), [categoryId, searchQuery]);
    const category = getCategoryById(categoryId);
    const service = getServiceById(serviceId);
    const visibleQuestions = getVisibleQuestions(service, answers);

    useEffect(() => {
        if (!categoryId || window.innerWidth > 768) return;
        const heading = issueSectionHeading.current;
        if (!heading) return;
        const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
        requestAnimationFrame(() => {
            heading.focus({ preventScroll: true });
            heading.scrollIntoView?.({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
        });
    }, [categoryId]);

    const moveToStep = (nextStep) => { setStep(nextStep); setErrors({}); setSaveError(""); requestAnimationFrame(() => document.querySelector("[data-step-heading]")?.focus()); };
    const clearCategorySearch = () => { setCategorySearchQuery(""); categorySearchInput.current?.focus(); };
    const selectCategory = (id) => { setCategoryId(id); setServiceId(""); setSearchQuery(""); setAnswers({}); setErrors({}); };
    const selectService = (id) => {
        const nextService = getServiceById(id);
        setServiceId(id);
        setAnswers({});
        setValues((current) => ({ ...current, reportingMode: nextService?.anonymousPolicy === "not-allowed" ? "identified" : current.reportingMode }));
        setErrors({});
    };
    const changeValue = (name, value) => { setValues((current) => ({ ...current, [name]: value })); setErrors((current) => ({ ...current, [name]: undefined })); setSaveError(""); };
    const changeAnswer = (questionId, value) => {
        setAnswers((current) => {
            const next = { ...current, [questionId]: value };
            const visibleIds = new Set(getVisibleQuestions(service, next).map((question) => question.id));
            for (const question of service.questions || []) if (!visibleIds.has(question.id)) delete next[question.id];
            return next;
        });
        setErrors((current) => ({ ...current, [`question:${questionId}`]: undefined }));
    };
    const continueFromService = () => {
        const nextErrors = {};
        if (!category) nextErrors.category = "Choose a Category.";
        if (!service) nextErrors.service = "Choose an Issue.";
        if (Object.keys(nextErrors).length) return setErrors(nextErrors);
        moveToStep("details");
    };
    const continueFromDetails = () => {
        const nextErrors = {};
        for (const question of visibleQuestions) if (question.required && String(answers[question.id] ?? "").trim() === "") nextErrors[`question:${question.id}`] = "This question is required.";
        if (!values.description) nextErrors.description = "Describe your concern.";
        if (service.locationRequirement === "required" && !values.location) nextErrors.location = "Enter the issue location.";
        if (values.reportingMode === "identified" && !values.reporterName) nextErrors.reporterName = "Enter your name.";
        if (Object.keys(nextErrors).length) { setErrors(nextErrors); requestAnimationFrame(() => document.querySelector("[aria-invalid='true']")?.focus()); return; }
        moveToStep("review");
    };
    const submitRequest = () => {
        if (submissionInProgress.current) return;
        submissionInProgress.current = true;
        setIsSubmitting(true);
        setSaveError("");
        try {
            saveIssue(mapIntakeToLegacyIssue({ category, service, answers, ...values, dateReported: createTimestamp() }));
            if (onSuccess) onSuccess();
            else navigate("/issues", { state: { notice: "Issue submitted successfully." } });
        } catch (error) {
            console.error("Unable to save the issue:", error);
            setSaveError("The issue could not be saved. Please try again.");
            submissionInProgress.current = false;
            setIsSubmitting(false);
        }
    };

    return (
        <section className="report-issue-page" aria-labelledby="report-heading">
            <div className="intake-header">
                <header className="report-intro"><span className="report-intro-icon" aria-hidden="true"><i className="bi bi-megaphone" /></span><div><h1 id="report-heading">Report an Issue</h1><p>Find the issue that best matches your concern.</p></div></header>
                <StepProgress currentStep={step} />
            </div>
            {saveError && <div className="alert alert-danger" role="alert">{saveError}</div>}
            <div className="card border-0 report-form-card"><div className="card-body p-3 p-md-4 p-lg-5">
                {step === "service" && <div className="step-panel">
                    <div className="section-heading"><span className="section-symbol" aria-hidden="true"><i className="bi bi-grid" /></span><div><h2 className="h4" tabIndex="-1" data-step-heading>Choose a Category</h2><p>Select the kind of concern you want to report.</p></div></div>
                    <div className="prototype-notice"><i className="bi bi-info-circle" aria-hidden="true" /><span>Prototype data — sample issue catalog for development.</span></div>
                    <div className="category-search-surface"><label className="form-label fw-semibold" htmlFor="category-search">Search categories</label><div className="category-search"><i className="bi bi-search" aria-hidden="true" /><input className="form-control" id="category-search" ref={categorySearchInput} type="search" autoComplete="off" placeholder="Search categories..." value={categorySearchQuery} onChange={(event) => setCategorySearchQuery(event.target.value)} />{categorySearchQuery && <button className="btn btn-outline-secondary" type="button" aria-label="Clear category search" onClick={clearCategorySearch}>Clear</button>}</div><p className="result-count" aria-live="polite" aria-atomic="true">{categoryCountText(categories.length)}</p></div>
                    {categories.length ? <div className="category-grid" role="radiogroup" aria-label="Category">{categories.map((item) => <label key={item.id} className={`catalog-choice category-choice accent-${item.accent}${categoryId === item.id ? " selected" : ""}`}><input type="radio" name="category" value={item.id} checked={categoryId === item.id} onChange={() => selectCategory(item.id)} /><span className="choice-icon" aria-hidden="true"><i className={`bi ${item.icon}`} /></span><span className="choice-copy"><strong>{item.name}</strong><small>{item.description}</small></span><i className={`bi ${categoryId === item.id ? "bi-check-circle-fill" : "bi-circle"} choice-state`} aria-hidden="true" /></label>)}</div> : <div className="empty-categories"><i className="bi bi-search" aria-hidden="true" /><h3>No matching categories found.</h3><p>Try a different word or clear your search.</p><button className="btn btn-outline-primary" type="button" onClick={clearCategorySearch}>Clear search</button></div>}
                    {errors.category && <div className="text-danger mt-2" role="alert">{errors.category}</div>}
                    {category && <section className="service-section" aria-labelledby="service-heading"><div className="section-heading compact"><span className="section-symbol" aria-hidden="true"><i className="bi bi-list-check" /></span><div><p className="issue-section-kicker">Next: {category.name}</p><h2 className="h3" id="service-heading" tabIndex="-1" ref={issueSectionHeading}>Choose an Issue</h2><p>Choose the issue that best matches your concern in <strong>{category.name}</strong>.</p></div></div><div className="issue-search-surface"><label className="form-label fw-semibold" htmlFor="service-search">Search issues</label><div className="service-search"><i className="bi bi-search" aria-hidden="true" /><input className="form-control" id="service-search" type="search" placeholder={`Search issues in ${category.name}`} value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} />{searchQuery && <button className="btn btn-outline-secondary" type="button" onClick={() => setSearchQuery("")}>Clear<span className="visually-hidden"> issue search</span></button>}</div><p className="result-count" aria-live="polite">{issueCountText(services.length)}</p></div>{services.length ? <div className="service-list" role="radiogroup" aria-label="Issue">{services.map((item) => <label key={item.id} className={`catalog-choice service-choice accent-${category.accent}${serviceId === item.id ? " selected" : ""}`}><input type="radio" name="service" value={item.id} checked={serviceId === item.id} onChange={() => selectService(item.id)} /><span className="choice-icon issue-choice-icon" aria-hidden="true"><i className={`bi ${resolveIssueIcon({ service: item, category })}`} /></span><span className="choice-copy"><strong>{item.name}</strong><small>{item.citizenDescription}</small></span><i className={`bi ${serviceId === item.id ? "bi-check-circle-fill" : "bi-circle"} choice-state`} aria-hidden="true" /></label>)}</div> : <div className="empty-services" role="status"><i className="bi bi-search" aria-hidden="true" /><h3>No matching issues found.</h3><p>Try a different word or choose another category.</p><button className="btn btn-outline-primary" type="button" onClick={() => setSearchQuery("")}>Clear search</button></div>}<aside className="service-guidance"><strong>Can't find the issue you're looking for?</strong><span>Try another search or choose a different category.</span></aside>{errors.service && <div className="text-danger mt-2" role="alert">{errors.service}</div>}</section>}
                    <div className="intake-actions action-footer justify-content-end"><button className="btn btn-primary" type="button" onClick={continueFromService}>Continue <i className="bi bi-arrow-right ms-2" aria-hidden="true" /></button></div>
                </div>}
                {step === "details" && service && <div className="step-panel"><div className="selected-service-banner"><i className="bi bi-check-circle" aria-hidden="true" /><div><span>Selected issue</span><p className="service-path">{category?.name} <i className="bi bi-chevron-right" aria-hidden="true" /> Issue details</p><h2 className="h4" tabIndex="-1" data-step-heading>{service.name}</h2><p>{service.citizenDescription}</p></div></div><div className="details-surface"><IssueForm service={service} visibleQuestions={visibleQuestions} values={values} answers={answers} errors={errors} onValueChange={changeValue} onAnswerChange={changeAnswer} onContinue={continueFromDetails} onBack={() => moveToStep("service")} /></div></div>}
                {step === "review" && service && category && <div className="step-panel"><div className="review-heading"><span className="review-icon" aria-hidden="true"><i className="bi bi-clipboard-check" /></span><div><h2 className="h4" tabIndex="-1" data-step-heading>Review Your Request</h2><p>Please review your request before submitting.</p></div></div><dl className="review-list"><div className="review-pair"><dt>Selected Issue</dt><dd><strong>{service.name}</strong><span>{category.name}</span></dd></div><div className="review-pair"><dt>Location</dt><dd>{values.location}</dd></div><div className="review-pair"><dt>Reporting Information</dt><dd>{values.reportingMode === "anonymous" ? "Reporting anonymously" : values.reporterName}</dd></div><div className="review-pair"><dt>Details</dt><dd>{values.description}</dd></div>{visibleQuestions.filter((question) => answers[question.id]).map((question) => <div key={question.id} className="review-pair"><dt>{question.label}</dt><dd>{answers[question.id]}</dd></div>)}</dl><div className="intake-actions action-footer"><button className="btn btn-outline-secondary" type="button" onClick={() => moveToStep("details")}><i className="bi bi-arrow-left me-2" aria-hidden="true" />Back / Edit</button><button className="btn btn-primary" type="button" disabled={isSubmitting} onClick={submitRequest}>{isSubmitting ? "Submitting..." : "Submit Request"}<i className="bi bi-send ms-2" aria-hidden="true" /></button></div></div>}
            </div></div>
        </section>
    );
}
