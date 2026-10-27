import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  getIncidentWorkspace, liveStart, liveEvidence, liveConfig, livePlan, liveReview, liveApply, liveReport, liveCleanup, liveInspect,
} from '../api';

/**
 * INC-004 LIVE: the squad's shared workspace for its REAL EC2 lab. Every member sees the same
 * lab, timeline and score; every action is recorded against the member who took it. The
 * platform (not this page) arms the incident, fires it, verifies the recovery and scores it —
 * this page only asks the server and shows what it says.
 *
 * INC-005 (console hotfix drift) uses the same page: no configuration edit, no review gate and no
 * report — the squad plans the UNCHANGED configuration, inspects the saved plan and applies it.
 */
const PHASE = {
  new: 'Not deployed yet',
  booting: 'Deploying — waiting for the application to become healthy',
  armed: 'Healthy. The incident is armed: it can happen at any time',
  ready: 'Healthy and ready. Something can happen at any time',
  incident: 'INCIDENT IN PROGRESS',
  recovering: 'A fix was applied — the platform is verifying it',
  completed: 'Recovered and verified',
  cleaned: 'Lab destroyed',
  deploy_failed: 'Deployment did not become healthy',
  fault_refused: 'The incident could not be started (refused by the guard)',
  fault_failed: 'The incident could not be started; the platform is cleaning the lab up',
  cleanup_incomplete: 'Cleanup left resources behind — tell your instructor',
};

function LiveWorkspace() {
  const [ws, setWs] = useState(null);
  const [error, setError] = useState(null);
  const [msg, setMsg] = useState(null);
  const [out, setOut] = useState(null);
  const [cidrs, setCidrs] = useState('');
  const [hypothesis, setHypothesis] = useState('');
  const [summary, setSummary] = useState('');

  const load = useCallback(async () => {
    try { setWs((await getIncidentWorkspace()).data); setError(null); } catch (err) {
      setError(err.response?.status === 401 ? 'signin' : (err.response?.data?.error || 'Workspace unavailable'));
    }
  }, []);
  useEffect(() => { load(); const t = setInterval(load, 4000); return () => clearInterval(t); }, [load]);

  const call = async (fn, show) => {
    setMsg(null);
    try {
      const r = (await fn()).data;
      setMsg(r.message || (r.accepted ? `${r.operation} started` : 'done'));
      if (show && r.message) setOut(r.message);
    } catch (err) { setMsg(err.response?.data?.error || err.response?.data?.message || 'Request failed'); }
    load();
  };

  if (error === 'signin') {
    return <div style={s.card}><p style={s.body}><Link to="/login">Sign in</Link> to join your squad's War Room. Every action is recorded against your account.</p></div>;
  }
  if (error) return <div style={s.card}><p style={s.body}>{error}</p></div>;
  if (!ws) return null;

  const active = ['incident', 'recovering'].includes(ws.phase);
  const drift = ws.incident === 'INC-005';
  const label = (k) => ((ws.check_labels || []).find((c) => c.id === k) || {}).label || k.replace(/_/g, ' ');
  const busy = Boolean(ws.busy);

  return (
    <div data-testid="live-workspace">
      <div style={s.card}>
        <h2 style={s.h2}>Squad {ws.squad} · real EC2 lab</h2>
        <p style={s.status} data-testid="live-phase">{PHASE[ws.phase] || ws.phase}</p>
        {busy && <p style={s.muted}>⏳ {ws.busy.by} is running “{ws.busy.kind}”…</p>}
        {ws.paused && <p style={s.muted}>Paused by your instructor.</p>}
        {msg && <p style={s.result} role="status">{msg}</p>}
        {ws.phase === 'new' && <button type="button" style={s.button} disabled={busy} onClick={() => call(liveStart)}>Deploy the squad lab</button>}
      </div>

      {['armed', 'ready', 'incident', 'recovering', 'completed'].includes(ws.phase) && (
        <div style={s.card}>
          <h2 style={s.h2}>Investigate</h2>
          <div style={s.buttons}>
            {ws.evidence_views.map((e) => (
              <button key={e.id} type="button" style={s.button} disabled={busy} title={e.label} onClick={() => call(() => liveEvidence(e.id), true)}>{e.label}</button>
            ))}
          </div>
          {out && <pre style={s.pre} data-testid="live-evidence">{out}</pre>}
        </div>
      )}

      {drift && (active || ws.phase === 'completed') && (
        <div style={s.card}>
          <h2 style={s.h2}>Restore through Terraform</h2>
          <p style={s.muted}>The desired configuration has not changed. Plan it, inspect the saved plan, then apply exactly that plan.</p>
          {active && (
            <div style={s.buttons}>
              <button type="button" style={s.button} disabled={busy} onClick={() => call(livePlan)}>terraform plan (saved)</button>
            </div>
          )}
          {active && ws.pending_plan && (
            <div style={{ marginTop: 12 }}>
              <p style={s.body}>Saved plan <code>{ws.pending_plan.name}</code> by {ws.pending_plan.by}: {ws.pending_plan.summary}</p>
              <div style={s.buttons}>
                <button type="button" style={s.button} onClick={() => call(() => liveInspect(ws.pending_plan.name), true)}>Inspect the saved plan</button>
                <button type="button" style={s.button} disabled={busy} onClick={() => call(() => liveApply(ws.pending_plan.name))}>terraform apply (this plan)</button>
              </div>
            </div>
          )}
          {ws.checks && (
            <div data-testid="live-checks">
              <p style={s.muted}>Platform checks at {ws.checks.at.slice(11, 19)} UTC</p>
              <ul style={s.list}>{Object.entries(ws.checks.results).map(([k, ok]) => <li key={k}>{ok ? '✅' : '❌'} {label(k)}</li>)}</ul>
            </div>
          )}
        </div>
      )}

      {!drift && active && (
        <div style={s.card}>
          <h2 style={s.h2}>Change the Terraform configuration</h2>
          <label htmlFor="inc004-cidrs" style={s.label}>http_ingress_cidrs (one CIDR per line)</label>
          <textarea id="inc004-cidrs" rows={4} style={s.input} value={cidrs} onChange={(e) => setCidrs(e.target.value)} />
          <div style={s.buttons}>
            <button type="button" style={s.button} disabled={busy || !cidrs.trim()} onClick={() => call(() => liveConfig(cidrs.split(/\s+/).filter(Boolean)))}>Save configuration</button>
            <button type="button" style={s.button} disabled={busy} onClick={() => call(livePlan)}>terraform plan</button>
          </div>
          {ws.pending_plan && (
            <div style={{ marginTop: 12 }}>
              <p style={s.body}>Current plan <code>{ws.pending_plan.name}</code> by {ws.pending_plan.by}</p>
              <div style={s.buttons}>
                <button type="button" style={s.button} disabled={busy} onClick={() => call(() => liveReview(ws.pending_plan.name), true)}>Review the plan</button>
                <button type="button" style={s.button} disabled={busy} onClick={() => call(() => liveApply(ws.pending_plan.name))}>terraform apply</button>
              </div>
            </div>
          )}
          {ws.checks && (
            <ul style={s.list}>{Object.entries(ws.checks).map(([k, ok]) => <li key={k}>{ok ? '✅' : '❌'} {k.replace(/_/g, ' ')}</li>)}</ul>
          )}
        </div>
      )}

      {!drift && ['incident', 'recovering', 'completed'].includes(ws.phase) && !ws.report_filed && (
        <div style={s.card}>
          <h2 style={s.h2}>Squad incident report</h2>
          <label htmlFor="inc004-live-h" style={s.label}>Root cause</label>
          <select id="inc004-live-h" style={s.input} value={hypothesis} onChange={(e) => setHypothesis(e.target.value)}>
            <option value="" disabled>Choose the root cause your evidence supports</option>
            {ws.hypotheses.map((h) => <option key={h.id} value={h.id}>{h.label}</option>)}
          </select>
          <label htmlFor="inc004-live-s" style={s.label}>Summary: impact, cause, fix, verification, prevention</label>
          <textarea id="inc004-live-s" rows={4} maxLength={2000} style={s.input} value={summary} onChange={(e) => setSummary(e.target.value)} />
          <button type="button" style={s.button} disabled={!hypothesis} onClick={() => call(() => liveReport({ hypothesis, summary }))}>File the report</button>
        </div>
      )}

      {ws.score && (
        <div style={s.card} data-testid="live-score">
          <h2 style={s.h2}>Squad score: {ws.score.total} / 100</h2>
          <ul style={s.list}>
            {Object.entries(ws.score.breakdown).map(([k, v]) => <li key={k}>{k}: {v}</li>)}
            {ws.score.penalties.map((p) => <li key={p.reason}>penalty — {p.reason}: −{p.points}</li>)}
          </ul>
        </div>
      )}

      {!['new', 'cleaned'].includes(ws.phase) && (
        <div style={s.card}>
          <button type="button" style={s.button} disabled={busy} onClick={() => call(liveCleanup)}>Destroy the squad lab</button>
          <p style={s.muted}>The platform also destroys it automatically after completion, and at the lab's maximum lifetime.</p>
        </div>
      )}

      <div style={s.card}>
        <h2 style={s.h2}>Squad timeline</h2>
        <ol style={s.list}>{ws.timeline.map((e, i) => <li key={i} style={s.li}>{e.t.slice(11, 19)} · <strong>{e.by}</strong> · {e.event}{e.detail ? ` — ${e.detail}` : ''}</li>)}</ol>
      </div>
    </div>
  );
}

const s = {
  card: { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 16, padding: '18px 20px', margin: '16px 0' },
  h2: { fontSize: 15, textTransform: 'uppercase', letterSpacing: '0.06em', opacity: 0.85, margin: '0 0 10px' },
  body: { fontSize: 15, lineHeight: 1.6, margin: 0 },
  status: { fontSize: 17, margin: '0 0 6px' },
  muted: { fontSize: 13, opacity: 0.7, margin: '6px 0 0' },
  result: { fontSize: 14, margin: '10px 0', padding: '8px 10px', background: 'rgba(255,255,255,0.05)', borderRadius: 8 },
  buttons: { display: 'flex', flexWrap: 'wrap', gap: 8 },
  button: { background: 'rgba(255,255,255,0.06)', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: '8px 12px', fontSize: 13, cursor: 'pointer' },
  pre: { background: 'rgba(0,0,0,0.35)', borderRadius: 8, padding: 12, fontSize: 12, lineHeight: 1.5, overflowX: 'auto', whiteSpace: 'pre', marginTop: 10 },
  label: { display: 'block', fontSize: 13, opacity: 0.8, margin: '10px 0 4px' },
  input: { width: '100%', boxSizing: 'border-box', background: 'rgba(0,0,0,0.3)', color: 'inherit', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 8, padding: 8, fontSize: 14, marginBottom: 10 },
  list: { margin: '10px 0 0', paddingLeft: 22 },
  li: { fontSize: 13, lineHeight: 1.7 },
};

export default LiveWorkspace;
