import { useEffect, useState } from 'react';
import {
  ago,
  clock,
  humanDuration,
  listAgents,
  listProjects,
  newestVersion,
  num,
  type AgentRow,
  type Hackatime,
  type ProjectRow,
} from '../api';
import { href, type User } from '../App';
import { KeysCard } from '../ConnectCli';
import { PageHead, SourceTag } from '../ui';
import { HT_ERRORS } from './Home';

const SOURCES: Record<string, string> = {
  api_key: 'the server’s HACKATIME_API_KEY (private stats included)',
  username: 'the server’s HACKATIME_USER (public stats only)',
  hack_club: 'your Hack Club sign-in (public stats only)',
};

export function Settings({ user, ht }: { user: User | null; ht: Hackatime | null }) {
  return (
    <>
      <PageHead eyebrow="Account" title="Settings" />

      <div className="card">
        <h2>Account</h2>
        {user ? (
          <dl className="facts">
            <dt>Name</dt>
            <dd>{user.name ?? '—'}</dd>
            <dt>Email</dt>
            <dd>{user.email}</dd>
            <dt>Signed in with</dt>
            <dd>Hack Club Auth</dd>
          </dl>
        ) : (
          <p className="sub">Sign-in is turned off on this server (local development).</p>
        )}
        {user && (
          <a className="btn-secondary inline" href="/auth/logout">
            Log out
          </a>
        )}
      </div>

      <CliStatus />

      <Agents />

      <div className="card">
        <h2>
          Hackatime
          <SourceTag source="hackatime" />
        </h2>
        <p className="sub">Editor time from the Hackatime plugins, read from hackatime.hackclub.com.</p>
        {ht === null && <p className="sub">Checking…</p>}
        {ht && !ht.configured && <p className="sub">Not connected.</p>}
        {ht && ht.configured && (
          <dl className="facts">
            <dt>Read through</dt>
            <dd>{SOURCES[ht.source]}</dd>
            <dt>Status</dt>
            <dd>{ht.error ? HT_ERRORS[ht.error] : `Connected${ht.username ? ` as ${ht.username}` : ''}`}</dd>
          </dl>
        )}
      </div>

      <KeysCard />
    </>
  );
}

/**
 * Every agent build that reported in the last 30 days, by platform and
 * version. Agents update themselves from GitHub releases, so one stuck on an
 * older version usually has auto_update off or cannot reach GitHub.
 */
function Agents() {
  const [agents, setAgents] = useState<AgentRow[] | null>(null);
  useEffect(() => {
    listAgents(30)
      .then((r) => setAgents(r.agents))
      .catch(() => setAgents([]));
  }, []);
  if (!agents || agents.length === 0) return null;
  const newest = newestVersion(agents.map((a) => a.agent_version));

  return (
    <div className="card">
      <h2>
        Agents reporting
        <SourceTag source="cli" />
      </h2>
      <p className="sub">
        Each platform and agent version that sent snapshots in the last 30 days. Agents from 0.3 update themselves;
        one left behind has <code>auto_update = false</code> or cannot reach GitHub — run{' '}
        <code>snapshot-agent update</code> on it.
      </p>
      <div className="scroll-x">
        <table>
          <thead>
            <tr>
              <th>Platform</th>
              <th>Version</th>
              <th>Projects</th>
              <th>Snapshots</th>
              <th>Capture time</th>
              <th>Last heard</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((a) => (
              <tr key={`${a.os}:${a.arch}:${a.agent_version}`}>
                <td>{a.os ? `${a.os}/${a.arch}` : <span className="muted">not reported (before 0.2.2)</span>}</td>
                <td>
                  {a.agent_version ?? '—'}
                  {newest && a.agent_version && a.agent_version !== newest && /^\d/.test(a.agent_version) && (
                    <span className="pill warn">outdated</span>
                  )}
                </td>
                <td>{num(a.projects)}</td>
                <td>{num(a.snapshots)}</td>
                <td>{a.avg_capture_ms !== null ? `${Math.round(a.avg_capture_ms)} ms` : '—'}</td>
                <td>{ago(a.last_seen)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/**
 * What this server has from the snapshot CLI, for debugging it apart from
 * Hackatime: whether anything has arrived, when, and from which agent build.
 */
function CliStatus() {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    listProjects()
      .then((r) => setProjects(r.projects))
      .catch(() => setError(true));
  }, []);

  const latest = projects?.reduce<ProjectRow | null>(
    (m, p) => ((p.received_at ?? 0) > (m?.received_at ?? 0) ? p : m),
    null,
  );
  const versions = [...new Set((projects ?? []).map((p) => p.agent_version).filter(Boolean))];
  const lag = latest?.received_at && latest.captured_at ? latest.received_at - latest.captured_at : null;

  return (
    <div className="card">
      <h2>
        Snapshot CLI
        <SourceTag source="cli" />
      </h2>
      <p className="sub">File-tree snapshots sent by snapshot-agent on your machines, stored on this server.</p>
      {error && <p className="sub">Could not load snapshot status.</p>}
      {!error && projects === null && <p className="sub">Checking…</p>}
      {projects && (
        <dl className="facts">
          <dt>Projects</dt>
          <dd>{projects.length}</dd>
          <dt>Last snapshot received</dt>
          <dd>
            {latest?.received_at
              ? `${clock(latest.received_at)} (${latest.name})${
                  lag !== null && lag > 120 ? `, ${humanDuration(lag)} after capture` : ''
                }`
              : 'Nothing received yet. Install it on a machine to start.'}
          </dd>
          <dt>Agent version</dt>
          <dd>{versions.length ? versions.join(', ') : '—'}</dd>
        </dl>
      )}
      <div className="btn-row">
        <a className="btn-secondary inline" href={href('extensions', 'install')}>
          Install on a machine
        </a>
        <a className="btn-secondary inline ghost" href={href('extensions', 'uninstall')}>
          Uninstall
        </a>
      </div>
    </div>
  );
}
