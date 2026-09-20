import { useMemo } from "react";
import { useAuth } from "../../auth/AuthContext.jsx";
import StaffRouteGuard from "../../auth/StaffRouteGuard.jsx";
import { createStaffRequestRepository } from "./requestRepository.js";
import InternalRequestWorkspace from "./InternalRequestWorkspace.jsx";
export default function StaffRequestsPage() {
  const auth = useAuth();
  const repository = useMemo(
    () => createStaffRequestRepository({ getAccessToken: auth.getAccessToken }),
    [auth.getAccessToken],
  );
  return (
    <StaffRouteGuard
      requireEntra
      title="Service Requests"
      disabledMessage="Staff request access is not configured."
      signInMessage="Sign in with your authorized organization account to continue."
    >
      {auth.enabled && auth.isAuthenticated && (
        <InternalRequestWorkspace
          key={auth.account?.homeAccountId || "staff"}
          repository={repository}
          onSignIn={auth.signIn}
        />
      )}
    </StaffRouteGuard>
  );
}
