import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { getIncidentStatus } from '../api';

/**
 * The alarm. Hidden until the backend reports an active incident, so the app
 * looks completely normal before the incident fires. It says only that
 * suspicious activity was detected — never why, never how. Polls quietly.
 */
function IncidentBanner() {
  const [incident, setIncident] = useState(null);

  useEffect(() => {
    let alive = true;
    const check = async () => {
      try {
        const res = await getIncidentStatus();
        if (alive) setIncident(res.data?.active ? res.data : null);
      } catch {
        if (alive) setIncident(null); // no incident api => plain lab => nothing
      }
    };
    check();
    const t = setInterval(check, 15000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  if (!incident) return null;

  return (
    <div role="alert" data-testid="incident-banner" style={styles.bar}>
      <div style={styles.inner}>
        <span style={styles.dot} aria-hidden="true">🔴</span>
        <div style={styles.text}>
          <strong style={styles.title}>SECURITY INCIDENT DETECTED</strong>
          <span style={styles.body}>
            Suspicious activity has been detected on your blogging platform.
            {' '}Incident: <strong>{incident.id}</strong>. Investigate immediately.
          </span>
        </div>
        <Link to="/incident" style={styles.button} data-testid="incident-open">
          Open incident →
        </Link>
      </div>
    </div>
  );
}

const styles = {
  bar: {
    position: 'sticky', top: 0, zIndex: 1000,
    background: 'linear-gradient(90deg, #7f1d1d, #b91c1c)',
    borderBottom: '1px solid rgba(255,255,255,0.25)',
    boxShadow: '0 2px 16px rgba(185,28,28,0.5)',
  },
  inner: {
    maxWidth: 1100, margin: '0 auto', padding: '12px 16px',
    display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap',
  },
  dot: { fontSize: 16, lineHeight: 1 },
  text: { display: 'flex', flexDirection: 'column', flex: 1, minWidth: 220, color: '#fff' },
  title: { fontSize: 13, letterSpacing: '0.08em', fontWeight: 700 },
  body: { fontSize: 13, opacity: 0.95 },
  button: {
    background: '#fff', color: '#7f1d1d', fontWeight: 700, fontSize: 13,
    padding: '8px 14px', borderRadius: 10, textDecoration: 'none', whiteSpace: 'nowrap',
  },
};

export default IncidentBanner;
