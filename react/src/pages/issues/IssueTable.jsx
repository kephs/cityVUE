import IssueRow from "./IssueRow.jsx";

export default function IssueTable({ issues, onDelete, apiMode = false }) {
    return (
        <div className="issues-table-wrap">
            <table className="table align-middle mb-0 issues-table">
                <caption className="visually-hidden">Reported CityVUE issues</caption>
                <thead className="table-light">
                    <tr>
                        {apiMode && <th scope="col">Reference</th>}
                        <th scope="col">Issue</th>
                        {apiMode && <th scope="col">Department</th>}
                        <th scope="col">Category</th>
                        <th scope="col">Priority</th>
                        <th scope="col">Status</th>
                        {!apiMode && <th scope="col">Reported By</th>}
                        <th scope="col">Date</th>
                        {!apiMode && <th scope="col">Actions</th>}
                    </tr>
                </thead>
                <tbody>{issues.map((issue, index) => <IssueRow issue={issue} apiMode={apiMode} onDelete={onDelete} key={issue.id || `issue-${index}`} />)}</tbody>
            </table>
        </div>
    );
}
