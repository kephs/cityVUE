import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ThemeToggle from '../components/theme/ThemeToggle.jsx';
import AdminPreviewDashboard from './AdminPreviewDashboard.jsx';
import { navigationGroups } from './adminPreviewData.js';
import './adminPreview.css';

export default function AdminPreviewPage() {
    const [active, setActive] = useState('Dashboard');
    const [navigationOpen, setNavigationOpen] = useState(() => !window.matchMedia?.('(max-width: 991.98px)').matches);
    const [panel, setPanel] = useState(null);
    const panelHeading = useRef(null);
    const trigger = useRef(null);
    useEffect(() => { if (panel) panelHeading.current?.focus(); }, [panel]);
    const showInformation = (title, source) => { trigger.current = source; setPanel({ title }); };
    const closeInformation = () => { setPanel(null); trigger.current?.focus(); };
    const navigate = (label, source) => { setActive(label); if (label === 'Dashboard') { setPanel(null); } else showInformation(label, source); };
    return <div className="admin-preview bg-body-tertiary text-body">
        <a className="skip-link" href="#admin-main">Skip to main content</a>
        <header className="admin-header"><div className="admin-header-brand"><Link to="/" aria-label="CityVUE home"><i className="bi bi-buildings-fill" aria-hidden="true" /> CityVUE</Link><div><p className="admin-header-title">Admin Portal</p><p className="admin-header-subtitle">Manage settings, content, and system configuration</p></div></div><div className="admin-header-tools"><span className="admin-header-badge">Preview Mode</span><button type="button" className="btn btn-outline-light" aria-label="Demo notifications" onClick={event => showInformation('Notifications', event.currentTarget)}><i className="bi bi-bell" aria-hidden="true" /></button><ThemeToggle /><span className="admin-demo-identity"><i className="bi bi-person-circle" aria-hidden="true" /> Administrator (Demo)</span></div></header>
        <div className="admin-shell"><aside className="admin-sidebar" aria-label="Admin preview navigation"><button className="admin-nav-toggle" type="button" aria-expanded={navigationOpen} aria-controls="admin-section-navigation" onClick={() => setNavigationOpen(!navigationOpen)}><i className="bi bi-list" aria-hidden="true" /> Portal navigation <i className={`bi bi-chevron-${navigationOpen ? 'up' : 'down'}`} aria-hidden="true" /></button><nav id="admin-section-navigation" aria-label="Demo administration sections" hidden={!navigationOpen}>{navigationGroups.map(([group, items]) => <section className="admin-nav-group" key={group}><h2>{group}</h2>{items.map(label => <button type="button" key={label} aria-current={active === label ? 'page' : undefined} onClick={event => navigate(label, event.currentTarget)}><i className={`bi bi-${label === 'Dashboard' ? 'grid' : 'chevron-right'}`} aria-hidden="true" />{label}</button>)}</section>)}</nav><div className="admin-city-brand"><img src="/branding/city-of-rockville-logo-circle.jpg" width="182" height="196" alt="City of Rockville — Rise Together" /><p>City of Rockville</p><span>Rise Together</span></div></aside>
            <main id="admin-main" className="admin-main" tabIndex="-1"><div className="admin-demo-banner" role="status"><strong>Demonstration Mode</strong><p>This is a preview of the CityVUE Admin Portal for stakeholder review only. No changes are saved and no live systems are connected.</p><p className="mb-0">Actual administrative access requires City authentication and appropriate permissions.</p></div>
                {panel && <section className="admin-info-panel" aria-labelledby="admin-info-title"><div><h2 id="admin-info-title" ref={panelHeading} tabIndex="-1">{panel.title}</h2><p className="mb-0">This action is disabled in Demonstration Mode. This panel illustrates a proposed administrative area; no changes are saved and no live systems are connected.</p></div><button type="button" className="btn btn-outline-primary" onClick={closeInformation}>Close panel</button></section>}
                <AdminPreviewDashboard onAction={showInformation} />
            </main></div>
        <footer className="admin-footer"><span>© 2026 CityVUE. Resident Engagement Platform.</span><span>Admin Portal v0.1 (Preview)</span><span>City of Rockville, Maryland | Rise Together</span></footer>
    </div>;
}
