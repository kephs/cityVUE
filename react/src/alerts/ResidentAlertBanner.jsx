import { useEffect, useState } from 'react';
import { loadActiveAlerts } from './alertsRepository.js';
import './residentAlerts.css';

const severityLabels = { info: 'Information', advisory: 'Advisory', warning: 'Warning', critical: 'Critical' };
const types = ['notice', 'service_disruption', 'utility', 'closure', 'emergency'];
function safeLink(value) {
    try { const url = new URL(value); return url.protocol === 'https:' && !url.username && !url.password ? url.href : null; }
    catch { return null; }
}
export function visibleAlerts(alerts, now = Date.now()) {
    return Array.isArray(alerts) ? alerts.filter(alert => alert && typeof alert.id === 'string' &&
        Object.hasOwn(severityLabels, alert.severity) && types.includes(alert.type) &&
        typeof alert.title === 'string' && typeof alert.message === 'string' &&
        alert.isActive !== false && !alert.deactivatedAt && Date.parse(alert.publishedAt) <= now &&
        Date.parse(alert.startsAt) <= now && (alert.expiresAt === null || Date.parse(alert.expiresAt) > now)) : [];
}

export default function ResidentAlertBanner({ loadAlerts = loadActiveAlerts }) {
    const [alerts, setAlerts] = useState([]);
    const [now, setNow] = useState(Date.now);
    useEffect(() => {
        let disposed = false;
        let controller;
        const refresh = async () => {
            controller?.abort();
            controller = new AbortController();
            const requestController = controller;
            try {
                const result = await loadAlerts({ signal: requestController.signal });
                if (!disposed && !requestController.signal.aborted) { setNow(Date.now()); setAlerts(visibleAlerts(result)); }
            }
            catch { if (!disposed && !requestController.signal.aborted) setAlerts([]); }
        };
        void refresh();
        const poll = setInterval(refresh, 60000);
        const onVisible = () => { setNow(Date.now()); if (document.visibilityState === 'visible') void refresh(); };
        document.addEventListener('visibilitychange', onVisible);
        return () => { disposed = true; controller?.abort(); clearInterval(poll); document.removeEventListener('visibilitychange', onVisible); };
    }, [loadAlerts]);
    useEffect(() => {
        const expiry = Math.min(...alerts.map(alert => Date.parse(alert.expiresAt)).filter(value => value > now));
        if (!Number.isFinite(expiry)) return;
        const timer = setTimeout(() => setNow(Date.now()), Math.min(2147483647, Math.max(1, expiry - Date.now())));
        return () => clearTimeout(timer);
    }, [alerts, now]);
    const active = visibleAlerts(alerts, now);
    if (!active.length) return null;
    return <section className="resident-alerts home-container" aria-label="Resident alerts and notices">
        {active.map(alert => {
            const urgent = alert.severity === 'critical' || alert.type === 'emergency';
            const link = safeLink(alert.linkUrl);
            return <article key={alert.id} className={`resident-alert resident-alert--${alert.severity}`} role={urgent ? 'alert' : undefined} aria-labelledby={`resident-alert-${alert.id}`}>
                <i className={`bi ${urgent ? 'bi-exclamation-triangle' : 'bi-info-circle'}`} aria-hidden="true" />
                <div><span className="resident-alert-severity">{severityLabels[alert.severity]}</span>
                    <h2 id={`resident-alert-${alert.id}`}>{alert.title}</h2><p>{alert.message}</p>
                    {Number.isFinite(Date.parse(alert.updatedAt)) && <p className="resident-alert-time">Updated <time dateTime={alert.updatedAt}>{new Date(alert.updatedAt).toLocaleString()}</time></p>}
                    {link && <a href={link} target="_blank" rel="noopener noreferrer">{alert.linkLabel || 'View details'}<span className="visually-hidden"> (opens in a new tab)</span></a>}
                </div>
            </article>;
        })}
    </section>;
}
