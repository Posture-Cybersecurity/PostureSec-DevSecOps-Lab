import { useState, useEffect } from 'react';
import { getIncident } from '../api';

/**
 * The incident brief the squad opens from the alarm.
 *
 * It states the SYMPTOM and the questions to answer. It deliberately does not
 * name a cause, an endpoint, or any account — discovering those from the
 * application's own evidence is the exercise.
 */
function IncidentPage() {
  const [incident, setIncident] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getIncident()
      .then((res) => setIncident(res.data))
      .catch(() => setIncident(null))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="loading"><div className="loading-spinner" /></div>;

  if (!incident || !incident.active) {
    return (
      <div style={styles.wrap}>
        <h1 style={styles.h1}>No active incident</h1>
        <p style={styles.muted}>The platform is operating normally.</p>
      </div>
    );
  }

  return (
    <div style={styles.wrap} data-testid="incident-page">
      <div style={styles.badge}>🔴 {incident.id} · ACTIVE</div>
      <h1 style={styles.h1}>Security incident</h1>
      <p style={styles.lead}>{incident.headline}</p>
      {incident.triggered_at && (
        <p style={styles.muted}>Detected at {new Date(incident.triggered_at).toLocaleString()}</p>
      )}

      <div style={styles.card}>
        <h2 style={styles.h2}>Brief</h2>
        <p style={styles.body}>{incident.brief}</p>
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>Answer these, with evidence</h2>
        <ol style={styles.list}>
          {(incident.investigate || []).map((q) => <li key={q} style={styles.li}>{q}</li>)}
        </ol>
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>Where to look</h2>
        <ul style={styles.list}>
          {(incident.evidence_sources || []).map((s) => <li key={s} style={styles.li}>{s}</li>)}
        </ul>
        <p style={styles.note}>
          AI can help you form hypotheses. It is not evidence — confirm every claim against the
          application, its logs, its database, and its source before you write it down.
        </p>
      </div>
    </div>
  );
}

const styles = {
  wrap: { maxWidth: 820, margin: '0 auto', padding: '8px 0 48px' },
  badge: {
    display: 'inline-block', background: 'rgba(185,28,28,0.15)', color: '#fca5a5',
    border: '1px solid rgba(185,28,28,0.5)', borderRadius: 999, padding: '4px 12px',
    fontSize: 12, letterSpacing: '0.08em', fontWeight: 700, marginBottom: 12,
  },
  h1: { fontSize: 32, margin: '4px 0 8px' },
  lead: { fontSize: 18, color: '#fca5a5', margin: '0 0 4px' },
  muted: { fontSize: 13, opacity: 0.7 },
  card: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16, padding: '18px 20px', margin: '16px 0',
  },
  h2: { fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.85, margin: '0 0 10px' },
  body: { fontSize: 15, lineHeight: 1.6, margin: 0 },
  list: { margin: 0, paddingLeft: 22 },
  li: { fontSize: 15, lineHeight: 1.9 },
  note: { fontSize: 13, opacity: 0.7, marginTop: 12, marginBottom: 0 },
};

export default IncidentPage;
