import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { loadAIWorkspace } from './aiRepository.js';

export default function AIWorkspacePage() {
    const auth = useAuth();
    const identity = auth.account?.homeAccountId;
    const [state, setState] = useState(null);
    useEffect(() => {
        if (!auth.enabled || !auth.isAuthenticated) return;
        const controller = new AbortController();
        loadAIWorkspace({ signal: controller.signal, getAccessToken: auth.getAccessToken }).then(
            (data) => { if (!controller.signal.aborted) setState({ identity, data }); },
            (error) => { if (!controller.signal.aborted) setState({ identity, error: error.status }); }
        );
        return () => controller.abort();
    }, [auth.enabled, auth.isAuthenticated, auth.getAccessToken, identity]);

    const current = state?.identity === identity ? state : null;
    const heading = <h1>CityVUE AI Workspace</h1>;
    if (!auth.enabled || !auth.isAuthenticated) return <section>{heading}<p>Authorized City staff sign-in is required.</p></section>;
    if (!current) return <section>{heading}<p role="status">Checking AI workspace access…</p></section>;
    if (!current.data) return <section>{heading}<p role="alert">{current.error === 403
        ? 'You do not have permission to access the AI workspace.'
        : current.error === 401 ? 'Your staff session has expired. Please sign in again.'
            : 'The AI workspace is unavailable. Please try again later.'}</p></section>;

    return (
        <section aria-labelledby="ai-workspace-heading">
            <h1 id="ai-workspace-heading">CityVUE AI Workspace</h1>
            <p>Secure access to City-approved AI services.</p>
            <div className="alert alert-info" role="status" id="ai-availability">
                {current.data.status.enabled === true
                    ? 'AI services are not connected. No models are currently enabled.'
                    : 'The AI workspace is not enabled.'} Prompts cannot be sent.
            </div>
            <div className="card bg-body text-body"><div className="card-body">
                <label className="form-label" htmlFor="ai-model">Model</label>
                <select id="ai-model" className="form-select mb-3" disabled aria-describedby="ai-availability">
                    <option>No models currently enabled</option>
                </select>
                <label className="form-label" htmlFor="ai-prompt">Your prompt</label>
                <textarea id="ai-prompt" className="form-control mb-3" rows={5} disabled
                    placeholder="AI services are not connected" aria-describedby="ai-availability" />
                <button className="btn btn-primary" type="button" disabled aria-describedby="ai-availability">Send</button>
            </div></div>
        </section>
    );
}
