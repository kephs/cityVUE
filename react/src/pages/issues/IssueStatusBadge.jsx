import { StatusBadge } from "../../components/ui/RequestPresentation.jsx";
export default function IssueStatusBadge({status}) { return <StatusBadge value={status || "Open"} />; }
