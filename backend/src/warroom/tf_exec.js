/**
 * INC-004 controlled Terraform execution engine.
 *
 * The backend runs terraform ONLY:
 *   * in one fixed root (config.tf.workdir) — never a client-supplied path,
 *   * through a whitelist of subcommands (init/validate/plan/show/apply/output),
 *   * with arguments this module builds — never arguments from a request body.
 *
 * It uses the normal terraform CLI (init, validate, plan, apply) through spawn;
 * it is NOT a bash wrapper around a whole deployment, and it adds no -auto-approve
 * except for `apply <savedplan>`, where the plan itself was already approved by
 * the guard and bound by digest.
 */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const config = require('./config');

const PLAN_FILE = 'tfplan'; // the single saved plan name we ever write/apply

function workdir() {
  const d = config.tf.workdir;
  return path.isAbsolute(d) ? d : path.resolve(process.cwd(), d);
}

// Only these terraform subcommands may ever run.
const ALLOWED = new Set(['init', 'validate', 'plan', 'show', 'apply', 'output']);

function run(subcommand, args = []) {
  if (!ALLOWED.has(subcommand)) {
    return Promise.reject(new Error(`terraform subcommand not allowed: ${subcommand}`));
  }
  const cwd = workdir();
  return new Promise((resolve) => {
    const child = spawn(config.tf.binary, [subcommand, ...args], {
      cwd,
      env: process.env, // default AWS credential chain (instance profile) flows through
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    const timer = setTimeout(() => child.kill('SIGKILL'), config.tf.timeoutMs);
    child.stdout.on('data', (d) => { stdout += d.toString(); });
    child.stderr.on('data', (d) => { stderr += d.toString(); });
    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ ok: false, code: -1, stdout, stderr: stderr + err.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ ok: code === 0, code, stdout, stderr });
    });
  });
}

const init = () => run('init', ['-input=false', '-no-color']);
const validate = () => run('validate', ['-no-color']);

/** Generate and save a plan. Returns the run result; the plan is at <workdir>/tfplan. */
const plan = () => run('plan', ['-input=false', '-no-color', `-out=${PLAN_FILE}`]);

/** The saved plan as structured JSON (for the guard). */
async function showPlanJson() {
  const res = await run('show', ['-json', PLAN_FILE]);
  if (!res.ok) return { ok: false, error: res.stderr || res.stdout, json: null };
  try {
    return { ok: true, json: JSON.parse(res.stdout) };
  } catch (err) {
    return { ok: false, error: `plan JSON parse failed: ${err.message}`, json: null };
  }
}

/** Raw bytes of the saved plan, for digest binding. */
function readPlanBytes() {
  return fs.readFileSync(path.join(workdir(), PLAN_FILE));
}

/** Apply the previously-saved, guard-approved plan. */
const applySavedPlan = () => run('apply', ['-input=false', '-no-color', PLAN_FILE]);

/** Terraform outputs as JSON. */
async function outputJson() {
  const res = await run('output', ['-json', '-no-color']);
  if (!res.ok) return { ok: false, error: res.stderr || res.stdout, json: null };
  try {
    return { ok: true, json: JSON.parse(res.stdout || '{}') };
  } catch (err) {
    return { ok: false, error: err.message, json: null };
  }
}

module.exports = {
  run, init, validate, plan, showPlanJson, readPlanBytes, applySavedPlan, outputJson,
  workdir, PLAN_FILE, ALLOWED,
};
