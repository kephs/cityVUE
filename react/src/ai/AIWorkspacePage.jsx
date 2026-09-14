import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext.jsx';
import { loadAIWorkspace } from './aiRepository.js';
import AIWorkspaceView from './AIWorkspaceView.jsx';

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
    const heading = <h1>AI Workspace</h1>;
    if (!auth.enabled || !auth.isAuthenticated) return <section>{heading}<p>Authorized City staff sign-in is required.</p></section>;
    if (!current) return <section>{heading}<p role="status">Checking AI workspace access…</p></section>;
    if (!current.data) return <section>{heading}<p role="alert">{current.error === 403
        ? 'You do not have permission to access the AI workspace.'
        : current.error === 401 ? 'Your staff session has expired. Please sign in again.'
            : 'The AI workspace is unavailable. Please try again later.'}</p></section>;

    return <AIWorkspaceView key={identity} status={current.data.status} models={current.data.models} />;
}
