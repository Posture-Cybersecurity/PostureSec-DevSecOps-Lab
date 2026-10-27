import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { getIncidentWorkspace, performIncidentAction, submitIncidentReport } from '../api';

/**
 * INC-004 squad workspace (Terraform War Room): run investigation commands, act,
 * and file the report.
 *
 * Every command is answered by the War Room server (a deterministic simulation;
 * outputs marked "captured" were recorded from the real War Room lab). Nothing
 * here reaches AWS. The server decides everything — this only renders.
 */
const GROUPS = [
  ['investigate', 'Investigate'],
  ['runtime', 'Act directly on the instance or the AWS console'],
  ['remediate', 'Change through Terraform'],
  ['verify', 'Verify'],
];

function TfWorkspace() {
  const [ws, setWs] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [last, setLast] = useState(null);
  const [hypothesis, setHypothesis] = useState('');
  const [summary, setSummary] = useState('');

  const load = useCallback(async () => {
    try {
      const res = await getIncidentWorkspace();
      setWs(res.data);
      setError(null);
    } catch (err) {
      setError(err.response?.status === 401 ? 'signin' : (err.response?.data?.error || 'Workspace unavailable'));
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const act = async (action) => {
    setBusy(true);
    try {
      const res = await performIncidentAction(action);
      setLast(res.data.message);
      setWs((prev) => ({ ...prev, ...res.data.view }));
    } catch (err) {
      setLast(err.response?.data?.error || 'Action failed');
    } finally {
      setBusy(false);
    }
  };

  const report = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await submitIncidentReport({ hypothesis, summary });
      setLast(res.data.message);
      setWs((prev) => ({ ...prev, ...res.data.view }));
    } catch (err) {
      setLast(err.response?.data?.error || 'Report failed');
    } finally {
      setBusy(false);
    }
  };

  if (error === 'signin') {
    return (
      <div style={styles.card}>
        <p style={styles.body}><Link to="/login">Sign in</Link> to open the War Room workspace. Every action is recorded against your account.</p>
      </div>
    );
  }
  if (error) return <div style={styles.card}><p style={styles.body}>{error}</p></div>;
  if (!ws) return null;

  return (
    <div data-testid="tf-workspace">
      <div style={styles.card}>
        <h2 style={styles.h2}>Service</h2>
        <p style={styles.status} data-testid="service-status">
          {ws.service_name}: <strong style={{ color: ws.service.startsWith('up') ? '#86efac' : '#fca5a5' }}>{ws.service}</strong>
        </p>
        {ws.proposed_change && (
          <p style={styles.muted}>
            Proposed change {ws.proposed_change} — plan {ws.plan_reviewed ? 'reviewed' : 'not reviewed yet'}.
          </p>
        )}
        {last && <p style={styles.result} role="status">{last}</p>}
      </div>

      {GROUPS.map(([kind, title]) => (
        <div key={kind} style={styles.card}>
          <h2 style={styles.h2}>{title}</h2>
          <div style={styles.buttons}>
            {ws.actions.filter((a) => a.kind === kind).map((a) => (
              <button key={a.id} type="button" style={styles.button} disabled={busy || ws.completed && kind !== 'investigate'}
                onClick={() => act(a.id)} data-action={a.id}>
                {a.label}
              </button>
            ))}
          </div>
        </div>
      ))}

      <div style={styles.card}>
        <h2 style={styles.h2}>Evidence ({ws.evidence.length})</h2>
        {ws.evidence.length === 0 && <p style={styles.muted}>Nothing examined yet.</p>}
        {ws.evidence.map((e) => (
          <div key={e.id} style={styles.evidence}>
            <div style={styles.evHead}>
              <span>{e.title}</span>
              <span style={styles.tag} title={e.captured_at ? `captured ${e.captured_at}` : undefined}>{e.layer} · {e.source}</span>
            </div>
            <pre style={styles.pre}>$ {e.command}{'\n'}{e.output.join('\n')}</pre>
          </div>
        ))}
      </div>

      <div style={styles.card}>
        <h2 style={styles.h2}>Incident report</h2>
        {ws.report_submitted ? <p style={styles.muted}>Report submitted.</p> : (
          <form onSubmit={report}>
            <label htmlFor="inc004-hypothesis" style={styles.label}>Root cause</label>
            <select id="inc004-hypothesis" value={hypothesis} onChange={(e) => setHypothesis(e.target.value)} style={styles.input} required>
              <option value="" disabled>Choose the root cause your evidence supports</option>
              {ws.hypotheses.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
            </select>
            <label htmlFor="inc004-summary" style={styles.label}>Summary: impact, cause, fix, verification, prevention</label>
            <textarea id="inc004-summary" value={summary} onChange={(e) => setSummary(e.target.value)} maxLength={2000} rows={5} style={styles.input} />
            <button type="submit" style={styles.button} disabled={busy || !hypothesis}>Submit report</button>
          </form>
        )}
      </div>

      {ws.score && (
        <div style={styles.card} data-testid="inc004-score">
          <h2 style={styles.h2}>Score: {ws.score.total} / 100</h2>
          <ul style={styles.list}>
            {Object.entries(ws.score.breakdown).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
            {ws.score.penalties.map((p) => <li key={p.reason}>penalty — {p.reason}: −{p.points}</li>)}
          </ul>
        </div>
      )}

      <div style={styles.card}>
        <h2 style={styles.h2}>Timeline</h2>
        <ol style={styles.list}>
          {ws.timeline.map((t, i) => <li key={i} style={styles.li}>T+{t.t}s · {t.action} — {t.outcome}</li>)}
        </ol>
      </div>
    </div>
  );
}

const styles = {
  card: {
    background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 16, padding: '18px 20px', margin: '16px 0',
  },
  h2: { fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.85, margin: '0 0 10px' },
  body: { fontSize: 15, lineHeight: 1.6, margin: 0 },
  status: { fontSize: 16, margin: 0 },
  muted: { fontSize: 13, opacity: 0.7, margin: '8px 0 0' },
  result: { fontSize: 14, margin: '10px 0 0', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 },
  buttons: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  button: {
    background: 'rgba(255,255,255,0.06)', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)',
    borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer',
  },
  evidence: { margin: '12px 0' },
  evHead: { display: 'flex', justifyContent: 'space-between', gap: 12, fontSize: 14, fontWeight: 600 },
  tag: { fontSize: 11, opacity: 0.7, textTransform: 'uppercase', letterSpacing: '0.05em' },
  pre: {
    background: 'rgba(0,0,0,0.35)', borderRadius: 8, padding: 12, fontSize: 12, lineHeight: 1.5,
    overflowX: 'auto', whiteSpace: 'pre', margin: '6px 0 0',
  },
  label: { display: 'block', fontSize: 13, opacity: 0.8, margin: '10px 0 4px' },
  input: {
    width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.3)', color: 'inherit',
    border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 8, fontSize: 14, marginBottom: 10,
  },
  list: { margin: 0, paddingLeft: 22 },
  li: { fontSize: 13, lineHeight: 1.7 },
};

export default TfWorkspace;
