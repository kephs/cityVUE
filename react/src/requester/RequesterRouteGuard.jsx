import { useAuth } from "../auth/AuthContext.jsx";

/**
 * F064.1: gate the requester portal on sign-in only.
 *
 * This is a convenience boundary, not a security one: it decides what to
 * render, never what the caller may read. The API authorizes every request
 * independently by tenant and ownership, so a bypass here discloses nothing.
 * It grants no staff permission and makes no claim about one.
 */
export default function RequesterRouteGuard({ children }) {
  const auth = useAuth();
  if (!auth.enabled)
    return (
      <main className="container py-5">
        <h1>My Internal Requests</h1>
        <p role="status">
          Employee sign-in is not configured for this deployment.
        </p>
      </main>
    );
  if (!auth.isAuthenticated)
    return (
      <main className="container py-5">
        <h1>Sign in to see your requests</h1>
        <p>Sign in with your organization account to view requests you submitted.</p>
        <button type="button" className="btn btn-primary" onClick={auth.signIn}>
          Sign in
        </button>
        {auth.error && (
          <p role="alert" className="mt-3">
            {auth.error}
          </p>
        )}
      </main>
    );
  return children;
}
