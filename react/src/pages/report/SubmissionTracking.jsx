import { useState } from "react";
import "../../tracking/tracking.css";

/**
 * F065: the one-time tracking handoff shown after a successful PUBLIC
 * submission.
 *
 * The raw credential lives in this component's state and nowhere else. It is
 * never written to localStorage, sessionStorage, the router location, the
 * document title, an analytics call or a query string, and it reaches the
 * server only in the X-Requester-Tracking header once the tracking page
 * loads. Navigation is a full document load so the existing session scrubber
 * consumes the fragment and strips it from history before the router is
 * constructed -- the same path a pasted link takes.
 *
 * `browser` is injectable so tests can observe navigation and clipboard
 * behavior without a real one.
 */
export default function SubmissionTracking({ tracking, browser = window }) {
  const [feedback, setFeedback] = useState("");
  // No credential means no link. Never synthesize one from the reference.
  if (!tracking || typeof tracking.credential !== "string")
    return (
      <p className="tracking-description">
        A tracking link is not available for this submission. Save your
        reference above, and contact the service team if you would like tracking
        access.
      </p>
    );
  const link = `${browser.location.origin}/track#${tracking.credential}`;
  const expires = Number.isFinite(Date.parse(tracking.expiresAt))
    ? new Date(tracking.expiresAt).toLocaleDateString(undefined, {
        year: "numeric",
        month: "long",
        day: "numeric",
      })
    : null;
  const copy = async () => {
    try {
      await browser.navigator.clipboard.writeText(link);
      setFeedback("Tracking link copied.");
    } catch {
      setFeedback("Copy is unavailable. Select and copy the link manually.");
    }
  };
  return (
    <section aria-labelledby="submission-tracking-heading">
      <h2 id="submission-tracking-heading">Track this request</h2>
      <p>
        Save this link now. It is shown only once and cannot be recovered
        later.
      </p>
      <p>
        Anyone with this link can view this request, so keep it to yourself.
      </p>
      {expires && <p>This link stops working on {expires}.</p>}
      <label htmlFor="submission-tracking-link">Your tracking link</label>
      <textarea
        id="submission-tracking-link"
        className="form-control tracking-link"
        readOnly
        value={link}
      />
      <p role="status">{feedback}</p>
      <div className="d-flex flex-wrap gap-2 justify-content-center">
        <button
          type="button"
          className="btn btn-primary"
          onClick={() =>
            browser.location.assign(`/track#${tracking.credential}`)
          }
        >
          Track Request
        </button>
        <button type="button" className="btn btn-secondary" onClick={copy}>
          Copy Tracking Link
        </button>
      </div>
    </section>
  );
}
