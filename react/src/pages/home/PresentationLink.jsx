import { Link } from "react-router-dom";
import { actionHref } from "./presentationPolicy.js";

export default function PresentationLink({ action, children, ...props }) {
  const href = actionHref(action);
  if (!href) return null;
  return action.actionType === "internal"
    ? <Link {...props} to={href}>{children}</Link>
    : <a {...props} href={href}>{children}</a>;
}
