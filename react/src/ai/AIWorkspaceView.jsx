import { useEffect, useRef, useState } from 'react';
import './aiWorkspace.css';

const guidance = {
    'User Guidelines': 'Use AI appropriately and follow City policies and acceptable-use guidance. Review any future AI output before using or sharing it.',
    'Data & Privacy': 'Conversation history is not stored. For privacy and security, chats are not currently persisted and each session is temporary. This workspace cannot send prompts. Future AI use may record operational usage and audit metadata, but not conversation content.',
    'AI Governance': 'AI access and model availability are controlled by CityVUE on the server. No provider or model is currently approved and configured for use in this workspace. A visible menu item does not grant access.',
    Help: 'AI is not available yet. Model selection and chat will remain unavailable until an approved provider is configured and enabled for City staff. For access questions, contact your CityVUE administrator.'
};
const tasks = [
    { title: 'Get Drafts', icon: 'pencil-square', description: 'Start with a clear first draft.', prompts: ['Draft a professional email response'] },
    { title: 'Find Information', icon: 'search', description: 'Make complex information easier to understand.', prompts: ['Summarize this document', 'Explain a policy in simpler terms'] },
    { title: 'Explore Ideas', icon: 'lightbulb', description: 'Turn a starting point into a plan.', prompts: ['Help me outline a project plan'] }
];
const Icon = ({ name }) => <i className={`bi bi-${name}`} aria-hidden="true" />;

export default function AIWorkspaceView({ status, models }) {
    const [draft, setDraft] = useState('');
    const [notice, setNotice] = useState('');
    const [information, setInformation] = useState(null);
    const infoHeading = useRef(null);
    useEffect(() => { if (information) infoHeading.current?.focus(); }, [information]);
    // F021 exposes metadata only. Metadata changes must never enable execution in this UI.
    const approvedModels = Array.isArray(models) ? models : [];
    const availableModels = approvedModels.filter(model => model.enabled === true && model.availability === 'available');
    const newConversation = () => { setDraft(''); setNotice('Example preview cleared. No conversation has been created or stored.'); };
    const example = (prompt) => { setDraft(prompt); setNotice('Example preview selected. Nothing is sent or stored.'); };

    return (
        <section className="ai-workspace" aria-labelledby="ai-workspace-heading">
            <header className="ai-page-heading">
                <div><p className="ai-eyebrow">CITYVUE · STAFF SERVICES</p><h1 id="ai-workspace-heading">AI Workspace</h1><p className="text-body-secondary mb-0">Secure. Responsible. City-Managed AI for Staff.</p></div>
                <span className="ai-staff-label"><Icon name="shield-lock" /> Staff workspace</span>
            </header>
            <div className="ai-workspace-grid">
                <aside className="ai-sidebar ai-panel" aria-label="Workspace navigation">
                    <div className="ai-sidebar-title"><Icon name="chat-square-text" /><span>CityVUE AI</span></div>
                    <button className="btn btn-primary w-100" onClick={newConversation}><Icon name="plus-lg" /> New Conversation</button>
                    <nav className="ai-section-nav" aria-label="AI workspace sections">
                        <a href="#ai-examples"><Icon name="grid" /> Example Prompts</a>
                        {Object.keys(guidance).map(label => <button key={label} type="button" aria-expanded={information === label} aria-controls="ai-information" onClick={() => setInformation(label)}><Icon name={label === 'Help' ? 'question-circle' : label === 'Data & Privacy' ? 'lock' : label === 'AI Governance' ? 'shield-check' : 'journal-text'} />{label}</button>)}
                    </nav>
                    <div className="ai-sidebar-bottom">
                        <p className="small text-body-secondary"><Icon name="clock-history" /> Conversation history is not stored.</p>
                        <div className="ai-city-logo"><img src="/branding/city-of-rockville-logo-circle.jpg" alt="City of Rockville — Rise Together" width="182" height="196" /></div>
                    </div>
                </aside>
                <div className="ai-main-column">
                    <section className="ai-panel ai-assistant" aria-labelledby="ai-assistant-heading">
                        <header className="ai-assistant-header"><span className="ai-icon-tile"><Icon name="stars" /></span><div><h2 id="ai-assistant-heading">City AI Assistant (Staff)</h2><p className="text-body-secondary mb-0">Your secure AI workspace for City of Rockville operations.</p></div></header>
                        <div className="ai-disabled-notice" role="status" id="ai-availability"><Icon name="info-circle" /><div><strong>AI is currently disabled</strong><p className="mb-0">Model selection and chat are unavailable until AI is enabled for City of Rockville staff.</p>{status.enabled === true && <p className="small mb-0 mt-2">Workspace metadata is enabled. Chat is still unavailable.</p>}</div></div>
                        <section id="ai-examples" className="ai-examples" aria-labelledby="ai-examples-heading"><h3 id="ai-examples-heading">How could AI help you?</h3><p className="text-body-secondary small">Explore a task below. Examples are local previews only.</p><div className="ai-task-grid">{tasks.map(task => <article className="ai-task-card" key={task.title}><Icon name={task.icon} /><h4>{task.title}</h4><p>{task.description}</p>{task.prompts.map(prompt => <button className="ai-prompt-example" type="button" key={prompt} onClick={() => example(prompt)}>{prompt}<Icon name="arrow-up-right" /></button>)}</article>)}</div></section>
                        <div className="ai-composer">
                            <label className="form-label" htmlFor="ai-model">Model</label>
                            <select className="form-select" id="ai-model" disabled aria-describedby="ai-availability"><option>{availableModels.length ? 'Model execution unavailable' : 'City General AI (Unavailable)'}</option>{approvedModels.map(model => <option key={model.id}>{model.displayName} ({model.enabled && model.availability === 'available' ? 'execution unavailable' : 'unavailable'})</option>)}</select>
                            <label className="form-label mt-3" htmlFor="ai-prompt">Your prompt</label>
                            <textarea className="form-control" id="ai-prompt" rows="4" value={draft} disabled placeholder="AI is unavailable. Choose an example to preview it here." aria-describedby="ai-availability ai-preview-note" />
                            <div className="ai-composer-actions"><p className="small text-body-secondary mb-0" id="ai-preview-note"><Icon name="lock" /> Temporary session · No conversation history</p><button className="btn btn-primary" type="button" disabled><Icon name="send" /> Send</button></div>
                            <p className="ai-action-notice small" aria-live="polite">{notice}</p>
                        </div>
                        <p className="ai-disclaimer"><Icon name="info-circle" /> AI can make mistakes. Always verify important information and follow City of Rockville policies and procedures.</p>
                    </section>
                    <section id="ai-information" className="ai-panel ai-information" hidden={!information} aria-labelledby="ai-information-heading"><h2 id="ai-information-heading" ref={infoHeading} tabIndex="-1">{information}</h2><p className="mb-0">{guidance[information]}</p></section>
                </div>
                <aside className="ai-support-column" aria-label="Workspace status and responsible use">
                    <section className="ai-panel ai-status" aria-labelledby="ai-status-heading"><h2 id="ai-status-heading"><Icon name="activity" /> AI Status</h2><dl><div><dt>AI Status</dt><dd><span className="ai-status-label">Disabled</span></dd></div><div><dt>Provider</dt><dd>{approvedModels.length ? 'Execution unavailable' : 'Not configured'}</dd></div><div><dt>Available Models</dt><dd>{availableModels.length}</dd></div><div><dt>Your Access</dt><dd>Authorized (Staff)</dd></div></dl></section>
                    <section className="ai-panel ai-responsible" aria-labelledby="ai-responsible-heading"><h2 id="ai-responsible-heading"><Icon name="shield-check" /> Responsible Use</h2><h3>Keep City data secure</h3><p>Do not enter sensitive, confidential, personal, or restricted information unless future City policy explicitly permits it.</p><h3>Use appropriately</h3><p>Follow City policies and acceptable-use guidance.</p><h3>Verify results</h3><p>AI can be incorrect. Review and verify important information.</p></section>
                    <section className="ai-privacy-note"><Icon name="lock" /><h2>Conversation history is not stored.</h2><p>For privacy and security, chats are not currently persisted. Each session is temporary.</p></section>
                </aside>
            </div>
        </section>
    );
}
