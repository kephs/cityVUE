import { useAuth } from "../../auth/AuthContext.jsx";
import DynamicQuestion, { displayAnswer } from "./DynamicQuestion.jsx";
import {
  AttachmentSelector,
  useAttachmentDraft,
} from "../../attachments/Attachments.jsx";
import { normalizeIssueAction } from "../../catalog/issueAction.js";
import { useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  getVisibleQuestions,
  searchCategories,
  searchServices,
} from "../../catalog/catalogService.js";
import { createResidentIntakeRepositories } from "../../residentIntake/residentIntakeRepositories.js";
import { resolveIssueIcon } from "../issues/issueIconPresentation.js";
import IssueForm from "./IssueForm.jsx";
import ParticipationInput from "../../residentIntake/ParticipationInput.jsx";
import "./report.css";

const initialValues = {
  description: "",
  location: "",
  locationPoint: null,
  reportingMode: "",
  reporterName: "",
};
const labels = {
  service: "Issue",
  details: "Details",
  questions: "Additional information",
  review: "Review",
};

function Progress({ step, hasQuestions }) {
  const steps = hasQuestions
    ? ["service", "details", "questions", "review"]
    : ["service", "details", "review"];
  const current = steps.indexOf(step);
  return (
    <nav className="intake-progress" aria-label="Request progress">
      <p className="visually-hidden" aria-live="polite">
        Step {current + 1} of {steps.length}
      </p>
      <ol>
        {steps.map((name, index) => (
          <li
            key={name}
            className={
              index < current
                ? "completed"
                : index === current
                  ? "current"
                  : "upcoming"
            }
            aria-current={index === current ? "step" : undefined}
          >
            <span className="step-marker" aria-hidden="true">
              {index < current ? <i className="bi bi-check-lg" /> : index + 1}
            </span>
            <span>{labels[name]}</span>
            <small>
              {index < current
                ? "Completed"
                : index === current
                  ? "Current"
                  : "Upcoming"}
            </small>
          </li>
        ))}
      </ol>
    </nav>
  );
}

export default function ReportIssuePage({
  saveIssue,
  createTimestamp,
  onSuccess,
  repositories,
}) {
  const navigate = useNavigate();
  const data = useMemo(
    () =>
      repositories ||
      createResidentIntakeRepositories({ saveIssue, createTimestamp }),
    [repositories, saveIssue, createTimestamp],
  );
  const [step, setStep] = useState("service");
  const [categoryItems, setCategoryItems] = useState(
    () => data.catalog.initialCategories || [],
  );
  const [serviceItems, setServiceItems] = useState([]);
  const [categoryId, setCategoryId] = useState("");
  const [serviceId, setServiceId] = useState("");
  const [service, setService] = useState(null);
  const [categoryQuery, setCategoryQuery] = useState("");
  const [serviceQuery, setServiceQuery] = useState("");
  const evidence = useAttachmentDraft(data.attachments, {
    issueId: service?.id,
    versionId: service?.serviceDefinitionVersionId,
  });
  const [answers, setAnswers] = useState({});
  const auth = useAuth();
  useEffect(() => {
    setAnswers({});
  }, [auth.account?.homeAccountId, auth.isAuthenticated]);
  const [values, setValues] = useState(initialValues);
  const [participationAvailable, setParticipationAvailable] = useState(false);
  const [errors, setErrors] = useState({});
  const [catalog, setCatalog] = useState({
    loading: data.mode === "api",
    phase: "categories",
    error: "",
  });
  const [saveError, setSaveError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState(null);
  const [handoffBusy, setHandoffBusy] = useState(false);
  const [handoffStatus, setHandoffStatus] = useState("");
  const handoffPending = useRef(false);
  const sequence = useRef(0);
  const submittingRef = useRef(false);
  const categories = useMemo(
    () => searchCategories(categoryQuery, categoryItems),
    [categoryQuery, categoryItems],
  );
  const services = useMemo(
    () => searchServices(categoryId, serviceQuery, serviceItems),
    [categoryId, serviceQuery, serviceItems],
  );
  const category = categoryItems.find((item) => item.id === categoryId);
  const visible = getVisibleQuestions(service, answers);

  const loadCategories = async (signal) => {
    setCatalog({ loading: true, phase: "categories", error: "" });
    try {
      setCategoryItems(await data.catalog.loadCategories({ signal }));
      setCatalog({ loading: false, phase: "categories", error: "" });
    } catch (error) {
      if (error.code !== "cancelled")
        setCatalog({
          loading: false,
          phase: "categories",
          error: error.message,
        });
    }
  };
  useEffect(() => {
    if (data.mode === "legacy") return undefined;
    const controller = new AbortController();
    loadCategories(controller.signal);
    return () => {
      controller.abort();
      sequence.current++;
    };
  }, [data]);
  useEffect(() => {
    if (!categoryId || window.innerWidth > 768 || serviceItems.length === 0)
      return;
    const heading = document.getElementById("service-heading");
    const reduce = window.matchMedia?.(
      "(prefers-reduced-motion: reduce)",
    )?.matches;
    requestAnimationFrame(() => {
      heading?.focus({ preventScroll: true });
      heading?.scrollIntoView?.({
        behavior: reduce ? "auto" : "smooth",
        block: "start",
      });
    });
  }, [categoryId, serviceItems]);
  const selectCategory = async (id) => {
    const request = ++sequence.current;
    setCategoryId(id);
    setServiceId("");
    setValues((old) => ({ ...old, location: "", locationPoint: null }));
    setService(null);
    setServiceItems([]);
    setAnswers({});
    setCatalog({ loading: true, phase: "issues", error: "" });
    try {
      const items = await data.catalog.loadIssues(id);
      if (request === sequence.current) {
        setServiceItems(items);
        setCatalog({ loading: false, phase: "issues", error: "" });
      }
    } catch (error) {
      if (request === sequence.current)
        setCatalog({ loading: false, phase: "issues", error: error.message });
    }
  };
  const selectService = async (id) => {
    setHandoffStatus("");
    const request = ++sequence.current;
    setServiceId(id);
    setValues((old) => ({ ...old, location: "", locationPoint: null }));
    setService(null);
    setAnswers({});
    setCatalog({ loading: true, phase: "definition", error: "" });
    try {
      const item = await data.catalog.loadDefinition(id, categoryId);
      if (request === sequence.current) {
        setService({ ...item, ...normalizeIssueAction(item) });
        if (item.actionType === "external_redirect") move("handoff");
        setValues((old) => ({
          ...old,
          reportingMode:
            item.anonymousPolicy === "not-allowed"
              ? "identified"
              : old.reportingMode,
        }));
        setCatalog({ loading: false, phase: "definition", error: "" });
      }
    } catch (error) {
      if (request === sequence.current)
        setCatalog({
          loading: false,
          phase: "definition",
          error: error.message,
        });
    }
  };
  async function continueHandoff() {
    if (handoffPending.current) return;
    handoffPending.current = true;
    setHandoffBusy(true);
    setHandoffStatus("");
    const request = ++sequence.current;
    try {
      const item = await data.catalog.loadDefinition(service.id, categoryId);
      if (request !== sequence.current) return;
      const current = { ...item, ...normalizeIssueAction(item) };
      setAnswers({});
      if (current.actionType !== "external_redirect") {
        setService(current);
        setValues({
          ...initialValues,
          reportingMode:
            current.anonymousPolicy === "not-allowed" ? "identified" : "",
        });
        move("details");
        return;
      }
      if (
        current.actionRevision !== service.actionRevision ||
        JSON.stringify(current.redirect) !== JSON.stringify(service.redirect)
      ) {
        setService(current);
        setHandoffStatus(
          "This service link changed. Review the updated destination before continuing.",
        );
        document.querySelector("[data-step-heading]")?.focus();
        return;
      }
      // A fresh server response is the only navigation source. The link never carries identity or tokens.
      const link = document.createElement("a");
      link.href = current.redirect.destination;
      link.referrerPolicy = "no-referrer";
      link.rel = "noreferrer";
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      if (request === sequence.current)
        setHandoffStatus(
          "This service link is currently unavailable. Return to the service list and try again.",
        );
    } finally {
      handoffPending.current = false;
      setHandoffBusy(false);
    }
  }
  const retry = () =>
    catalog.phase === "categories"
      ? loadCategories()
      : catalog.phase === "issues"
        ? selectCategory(categoryId)
        : selectService(serviceId);
  const move = (next) => {
    setStep(next);
    setErrors({});
    setSaveError("");
    requestAnimationFrame(() =>
      document.querySelector("[data-step-heading]")?.focus(),
    );
  };
  const changeValue = (name, value) => {
    setValues((old) => ({
      ...old,
      [name]: value,
      ...(name === "reportingMode" && value === "anonymous"
        ? { reporterName: "" }
        : {}),
    }));
    setErrors((old) => ({ ...old, [name]: undefined }));
    setSaveError("");
  };
  const changeAnswer = (id, value) => {
    setAnswers((old) => {
      const next = { ...old, [id]: value };
      const shown = new Set(
        getVisibleQuestions(service, next).map((q) => q.id),
      );
      for (const q of service.questions || [])
        if (!shown.has(q.id)) delete next[q.id];
      return next;
    });
    setErrors((old) => ({ ...old, [`question:${id}`]: undefined }));
  };
  const continueService = () => {
    const next = {};
    if (!category) next.category = "Choose a Category.";
    if (!service)
      next.service = catalog.loading
        ? "Wait for the issue form to finish loading."
        : "Choose an Issue.";
    if (Object.keys(next).length) setErrors(next);
    else
      move(service.actionType === "external_redirect" ? "handoff" : "details");
  };
  const continueDetails = () => {
    const next = {};
    if (!evidence.ready) {
      setSaveError(
        "Prepare all files, or remove invalid files, before continuing.",
      );
      return;
    }
    if (!values.description.trim()) next.description = "Describe your concern.";
    if (service.locationRequirement === "required" && !values.location.trim())
      next.location = "Enter the issue location.";
    if (!["identified", "anonymous"].includes(values.reportingMode))
      next.reportingMode = "Choose how you would like to submit this request.";
    if (
      service.anonymousPolicy === "not-allowed" &&
      values.reportingMode !== "identified"
    )
      next.reportingMode = "This Issue requires contact information.";
    if (values.reportingMode === "identified" && !values.reporterName.trim())
      next.reporterName = "Enter your name.";
    if (Object.keys(next).length) setErrors(next);
    else move(service.questions?.length ? "questions" : "review");
  };
  const continueQuestions = () => {
    const next = {};
    for (const q of visible) {
      const value = answers[q.id];
      const empty = String(value ?? "").trim() === "";
      if (q.required && empty)
        next[`question:${q.id}`] = "This question is required.";
      if (
        !empty &&
        ["short-text", "long-text"].includes(q.type) &&
        [...String(value).trim()].length >
          (q.type === "short-text" ? 300 : 2000)
      )
        next[`question:${q.id}`] = "This answer is too long.";
      if (
        !empty &&
        q.type === "number" &&
        (!Number.isFinite(Number(value)) ||
          Math.abs(Number(value)) > 1000000000 ||
          !/^-?\d+(?:\.\d{1,6})?$/.test(String(value)))
      )
        next[`question:${q.id}`] =
          "Enter a number with at most six decimal places within the allowed range.";
    }
    setErrors(next);
    if (!Object.keys(next).length) move("review");
  };
  const submit = async () => {
    if (
      !evidence.ready ||
      submittingRef.current ||
      service?.actionType === "external_redirect"
    )
      return;
    submittingRef.current = true;
    setSubmitting(true);
    setSaveError("");
    try {
      const response = await data.requests.createServiceRequest({
        category,
        service,
        answers,
        ...values,
        ...(evidence.claim() ? { attachments: evidence.claim() } : {}),
      });
      evidence.clear();
      setAnswers({});
      if (onSuccess) onSuccess(response);
      else if (data.mode === "legacy")
        navigate("/issues", {
          state: { notice: "Issue submitted successfully." },
        });
      else setResult(response);
    } catch (error) {
      if (data.mode === "api" && error.code === "catalog-version") {
        setAnswers({});
        evidence.clear();
        move("service");
        await selectService(service.id);
      }
      setSaveError(
        data.mode === "legacy"
          ? "The issue could not be saved. Please try again."
          : error.message ||
              "The issue could not be submitted. Please try again.",
      );
      submittingRef.current = false;
      setSubmitting(false);
    }
  };

  if (result)
    return (
      <section className="report-issue-page">
        <div className="card report-form-card">
          <div className="card-body p-5 text-center">
            <h1>Request submitted successfully.</h1>
            <p>
              {values.reportingMode === "anonymous"
                ? "Submitted anonymously. No requester contact information was collected."
                : "Submitted with contact information."}
            </p>
            <p>Reference</p>
            <p className="display-6 request-reference" role="status">
              {result.referenceNumber}
            </p>
            <p>Save this reference for future communication.</p>
            <p>{service?.name}</p>
            {values.location && (
              <dl>
                <dt>Service Location</dt>
                <dd>{values.location.trim()}</dd>
              </dl>
            )}
            {data.mode === "api" && data.detailsEnabled && result.id && (
              <button
                className="btn btn-primary"
                type="button"
                onClick={() =>
                  navigate(`/issues/${encodeURIComponent(result.id)}`)
                }
              >
                View request details
              </button>
            )}
          </div>
        </div>
      </section>
    );
  return (
    <section className="report-issue-page" aria-labelledby="report-heading">
      <div className="intake-header">
        <header className="report-intro">
          <span className="report-intro-icon" aria-hidden="true">
            <i className="bi bi-megaphone" />
          </span>
          <div>
            <h1 id="report-heading">Report an Issue</h1>
            <p>Find the issue that best matches your concern.</p>
          </div>
        </header>
        {step !== "handoff" && (
          <Progress
            step={step}
            hasQuestions={Boolean(service?.questions?.length)}
          />
        )}
      </div>
      {saveError && (
        <div className="alert alert-danger" role="alert">
          {saveError}
        </div>
      )}
      <div className="card border-0 report-form-card">
        <div className="card-body p-3 p-md-4 p-lg-5">
          {step === "service" && (
            <div className="step-panel">
              <div className="section-heading">
                <span className="section-symbol" aria-hidden="true">
                  <i className="bi bi-grid" />
                </span>
                <div>
                  <h2 className="h4" data-step-heading tabIndex="-1">
                    Choose a Category
                  </h2>
                  <p>Select the kind of concern you want to report.</p>
                </div>
              </div>
              <div className="prototype-notice">
                <i className="bi bi-info-circle" />
                <span>{data.catalog.notice}</span>
              </div>
              {catalog.loading && (
                <div className="catalog-message" role="status">
                  Loading{" "}
                  {catalog.phase === "definition"
                    ? "issue questions"
                    : catalog.phase}
                  …
                </div>
              )}
              {catalog.error && (
                <div className="alert alert-warning" role="alert">
                  {catalog.error}{" "}
                  <button
                    className="btn btn-sm btn-outline-primary"
                    type="button"
                    onClick={retry}
                  >
                    Try again
                  </button>
                </div>
              )}
              <div className="category-search-surface">
                <label
                  className="form-label fw-semibold"
                  htmlFor="category-search"
                >
                  Search categories
                </label>
                <div className="category-search">
                  <input
                    className="form-control"
                    id="category-search"
                    type="search"
                    placeholder="Search categories..."
                    value={categoryQuery}
                    onChange={(e) => setCategoryQuery(e.target.value)}
                  />
                  {categoryQuery && (
                    <button
                      className="btn btn-outline-secondary"
                      type="button"
                      aria-label="Clear category search"
                      onClick={(event) => {
                        setCategoryQuery("");
                        event.currentTarget.parentElement
                          ?.querySelector("input")
                          ?.focus();
                      }}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="result-count" aria-live="polite">
                  {categories.length}{" "}
                  {categories.length === 1 ? "category" : "categories"} found
                </p>
              </div>
              {categories.length ? (
                <div
                  className="category-grid"
                  role="radiogroup"
                  aria-label="Category"
                >
                  {categories.map((item) => (
                    <label
                      key={item.id}
                      className={`catalog-choice accent-${item.accent}${categoryId === item.id ? " selected" : ""}`}
                    >
                      <input
                        type="radio"
                        name="category"
                        checked={categoryId === item.id}
                        onChange={() => selectCategory(item.id)}
                      />
                      <span className="choice-icon">
                        <i className={`bi ${item.icon}`} />
                      </span>
                      <span className="choice-copy">
                        <strong>{item.name}</strong>
                        <small>{item.description}</small>
                      </span>
                    </label>
                  ))}
                </div>
              ) : (
                !catalog.loading && (
                  <div className="empty-categories">
                    <h3>No matching categories found.</h3>
                    <p>Try a different word or clear your search.</p>
                    <button
                      className="btn btn-outline-primary"
                      onClick={() => {
                        setCategoryQuery("");
                        document.getElementById("category-search")?.focus();
                      }}
                    >
                      Clear search
                    </button>
                  </div>
                )
              )}
              {errors.category && (
                <div role="alert" className="text-danger">
                  {errors.category}
                </div>
              )}
              {category && (
                <section className="service-section">
                  <h2 id="service-heading" tabIndex="-1">
                    Choose an Issue
                  </h2>
                  <p>
                    Choose the issue that best matches your concern in{" "}
                    <strong>{category.name}</strong>.
                  </p>
                  <div className="issue-search-surface">
                    <label
                      htmlFor="service-search"
                      className="form-label fw-semibold"
                    >
                      Search issues
                    </label>
                    <div className="service-search">
                      <input
                        id="service-search"
                        className="form-control"
                        type="search"
                        placeholder={`Search issues in ${category.name}`}
                        value={serviceQuery}
                        onChange={(e) => setServiceQuery(e.target.value)}
                      />
                      {serviceQuery && (
                        <button
                          className="btn btn-outline-secondary"
                          type="button"
                          onClick={() => setServiceQuery("")}
                        >
                          Clear
                          <span className="visually-hidden"> issue search</span>
                        </button>
                      )}
                    </div>
                    <p className="result-count" aria-live="polite">
                      {services.length}{" "}
                      {services.length === 1 ? "issue" : "issues"} found
                    </p>
                  </div>
                  {services.length ? (
                    <div
                      className="service-list"
                      role="radiogroup"
                      aria-label="Issue"
                    >
                      {services.map((item) => (
                        <label
                          key={item.id}
                          className={`catalog-choice service-choice${serviceId === item.id ? " selected" : ""}`}
                        >
                          <input
                            type="radio"
                            name="service"
                            checked={serviceId === item.id}
                            onChange={() => selectService(item.id)}
                          />
                          <span className="choice-icon issue-choice-icon">
                            <i
                              className={`bi ${resolveIssueIcon({ service: item, category })}`}
                            />
                          </span>
                          <span className="choice-copy">
                            <strong>{item.name}</strong>
                            <small>{item.citizenDescription}</small>
                          </span>
                        </label>
                      ))}
                    </div>
                  ) : (
                    !catalog.loading && (
                      <div className="empty-services">
                        <h3>No matching issues found.</h3>
                        <p>Try a different word or choose another category.</p>
                      </div>
                    )
                  )}
                  {errors.service && (
                    <div role="alert" className="text-danger">
                      {errors.service}
                    </div>
                  )}
                </section>
              )}
              <div className="intake-actions action-footer justify-content-end">
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={continueService}
                >
                  Continue <i className="bi bi-arrow-right ms-2" />
                </button>
              </div>
            </div>
          )}
          {step === "handoff" && service?.redirect && (
            <div className="step-panel">
              <h2 className="h4" data-step-heading tabIndex="-1">
                Continue to External Service
              </h2>
              <p>{service.redirect.message}</p>
              <p>
                You’ll leave this site to continue. No request has been
                submitted here.
              </p>
              <p>
                You will continue at:{" "}
                <strong style={{ overflowWrap: "anywhere" }}>
                  {service.redirect.hostname}
                </strong>
              </p>
              {handoffStatus && <p role="status">{handoffStatus}</p>}
              <div className="intake-actions action-footer">
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => {
                    sequence.current++;
                    setService(null);
                    setServiceId("");
                    setAnswers({});
                    move("service");
                  }}
                >
                  Go Back
                </button>
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={continueHandoff}
                  disabled={handoffBusy}
                >
                  {handoffBusy ? "Checking service…" : service.redirect.label}
                  <span className="visually-hidden"> (external site)</span>
                </button>
              </div>
            </div>
          )}
          {step === "details" && service && (
            <div className="step-panel">
              <div className="selected-service-banner">
                <div>
                  <span>Selected issue</span>
                  <h2 className="h4" data-step-heading tabIndex="-1">
                    {service.name}
                  </h2>
                  <p>{service.citizenDescription}</p>
                </div>
              </div>
              <IssueForm
                participationControls={
                  data.participation && (
                    <ParticipationInput
                      repository={data.participation}
                      onAvailabilityChange={setParticipationAvailable}
                      value={values.participation}
                      onChange={(participation) =>
                        setValues((old) => ({ ...old, participation }))
                      }
                    />
                  )
                }
                attachmentControls={
                  <AttachmentSelector
                    draft={evidence}
                    label="Photos & Files"
                    camera
                  />
                }
                attachmentsReady={evidence.ready}
                service={service}
                visibleQuestions={[]}
                continueLabel={
                  service.questions?.length
                    ? "Continue to additional information"
                    : "Review request"
                }
                values={values}
                answers={answers}
                errors={errors}
                onValueChange={changeValue}
                onAnswerChange={changeAnswer}
                onContinue={continueDetails}
                onBack={() => move("service")}
                locationRepository={data.location}
                onLocationChange={
                  data.mode === "api"
                    ? (location, locationPoint) => {
                        setValues((old) => ({
                          ...old,
                          location,
                          locationPoint,
                        }));
                        setErrors((old) => ({ ...old, location: undefined }));
                      }
                    : undefined
                }
              />
            </div>
          )}
          {step === "questions" && service && (
            <div className="step-panel">
              <h2 data-step-heading tabIndex="-1">
                Additional information
              </h2>
              <form
                noValidate
                onSubmit={(e) => {
                  e.preventDefault();
                  continueQuestions();
                }}
              >
                {visible.map((q) => (
                  <DynamicQuestion
                    key={q.id}
                    question={q}
                    value={answers[q.id]}
                    error={errors[`question:${q.id}`]}
                    onChange={changeAnswer}
                  />
                ))}
                <div className="intake-actions action-footer">
                  <button
                    type="button"
                    className="btn btn-outline-secondary"
                    onClick={() => move("details")}
                  >
                    Back to Details
                  </button>
                  <button type="submit" className="btn btn-primary">
                    Review request
                  </button>
                </div>
              </form>
            </div>
          )}
          {step === "review" && (
            <div className="step-panel">
              <div className="review-heading">
                <div>
                  <h2 className="h4" data-step-heading tabIndex="-1">
                    Review Your Request
                  </h2>
                  <p>Please review your request before submitting.</p>
                </div>
              </div>
              <dl className="review-list">
                {participationAvailable && (
                  <div className="review-pair">
                    <dt>Optional service participation</dt>
                    <dd>
                      {values.participation?.state === "PROVIDED"
                        ? values.participation.label
                        : values.participation?.state === "DECLINED"
                          ? "Prefer not to say"
                          : "Not provided"}
                    </dd>
                  </div>
                )}
                <div className="review-pair">
                  <dt>Selected Issue</dt>
                  <dd>
                    <strong>{service.name}</strong>
                    <span>{category.name}</span>
                  </dd>
                </div>
                <div className="review-pair">
                  <dt>Service Location</dt>
                  <dd>
                    {values.location}
                    {values.locationPoint && (
                      <span>
                        Latitude {values.locationPoint.latitude}, longitude{" "}
                        {values.locationPoint.longitude}
                      </span>
                    )}
                  </dd>
                </div>
                <div className="review-pair">
                  <dt>Reporting Information</dt>
                  <dd>
                    {values.reportingMode === "anonymous"
                      ? "Reporting anonymously"
                      : values.reporterName}
                  </dd>
                </div>
                <div className="review-pair">
                  <dt>Details</dt>
                  <dd>{values.description}</dd>
                </div>
                {visible
                  .filter(
                    (q) => answers[q.id] !== "" && answers[q.id] !== undefined,
                  )
                  .map((q) => (
                    <div className="review-pair" key={q.id}>
                      <dt>{q.label}</dt>
                      <dd
                        style={{
                          whiteSpace: "pre-wrap",
                          overflowWrap: "anywhere",
                        }}
                      >
                        {displayAnswer(q, answers[q.id])}
                      </dd>
                    </div>
                  ))}
              </dl>
              {evidence.files.length > 0 && (
                <section>
                  <h3 className="h5">Photos & Files</h3>
                  <ul>
                    {evidence.files.map((file) => (
                      <li key={file.id}>{file.filename} · Ready</li>
                    ))}
                  </ul>
                </section>
              )}
              <div className="intake-actions action-footer">
                <button
                  className="btn btn-outline-secondary"
                  onClick={() =>
                    move(service?.questions?.length ? "questions" : "details")
                  }
                >
                  Back / Edit
                </button>
                <button
                  className="btn btn-primary"
                  disabled={submitting || !evidence.ready}
                  onClick={submit}
                >
                  {submitting ? "Submitting..." : "Submit Request"}
                  <i className="bi bi-send ms-2" />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
