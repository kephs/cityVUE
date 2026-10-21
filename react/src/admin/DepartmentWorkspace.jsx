import DepartmentsConfiguration from "./DepartmentsConfiguration.jsx";
import DepartmentReadOnly from "./DepartmentReadOnly.jsx";
export function departmentReadEnabled(environment = import.meta.env) {
  return (
    environment.DEV === true &&
    environment.VITE_DEPARTMENT_READ_ENABLED === "true"
  );
}
export default function DepartmentWorkspace({
  client,
  authorizationContext,
  authorizationReady = true,
}) {
  if (!departmentReadEnabled()) return <DepartmentsConfiguration />;
  if (!authorizationReady)
    return (
      <p role="status">
        Department access requires renewed staff authentication.
      </p>
    );
  return (
    <DepartmentReadOnly
      client={client}
      authorizationContext={authorizationContext}
    />
  );
}
