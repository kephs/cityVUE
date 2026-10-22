import { Link } from "react-router-dom";

// Deliberately outside AuthRoot and App: no automatic authentication or data
// loading. MSAL owns logout and cache cleanup before returning here.
export default function SignedOutPage() {
  return (
    <main className="container py-5">
      <h1>Staff session ended</h1>
      <p>
        You can return to the staff workspace when you are ready to sign in.
      </p>
      <Link to="/staff/requests">Return to staff workspace</Link>
    </main>
  );
}
