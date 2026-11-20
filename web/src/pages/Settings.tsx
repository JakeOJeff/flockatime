import { useEffect, useState } from 'react';
import {
  SignedOutError,
  ago,
  clock,
  listKeys,
  listProjects,
  newestVersion,
  num,
  revokeKey,
  type Hackatime,
  type MachineRow,
  type ProjectRow,
} from '../api';
import { href, type User } from '../App';
import { ALL_TIME, PageHead } from '../ui';
import { HT_ERRORS } from './Home';

const SOURCES: Record<string, string> = {
  api_key: 'Private stats included, via the server’s API key',
  username: 'Public stats only, via the server’s HACKATIME_USER',
  hack_club: 'Public stats only, via your Hack Club sign-in',
};

export function Settings({ user, ht }: { user: User | null; ht: Hackatime | null }) {
  const [projects, setProjects] = useState<ProjectRow[] | null>(null);
  const [machines, setMachines] = useState<MachineRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    listKeys()
      .then((r) => setMachines(r.keys.filter((k) => !k.revoked_at)))
      .catch((e) => !(e instanceof SignedOutError) && setError(String(e)));

  useEffect(() => {
    listProjects(ALL_TIME)
      .then((r) => setProjects(r.projects))
      .catch(() => setProjects([]));
    refresh();
  }, []);

  const revoke = async (m: MachineRow) => {
    if (!confirm(`Revoke "${m.label ?? 'key'}"? That machine's agent stops sending.`)) return;
    try {
      await revokeKey(m.id);
      refresh();
    } catch (e) {
      if (!(e instanceof SignedOutError)) setError(String(e));
    }
  };

  const latest = projects?.reduce<ProjectRow | null>(
    (m, p) => ((p.received_at ?? 0) > (m?.received_at ?? 0) ? p : m),
    null,
  );
  const snapshots = (projects ?? []).reduce((a, p) => a + p.window.snapshots, 0);

  return (
    <>
      <PageHead title="Settings" />

      <div className="grid-3">
        <div className="card">
          <div className="kicker">Account</div>
          {user ? (
            <>
              <div className="big">{user.email}</div>
              <p className="fine">{user.name ? `${user.name} · Hack Club Auth` : 'Hack Club Auth'}</p>
              <div className="card-actions">
                <a className="btn-secondary inline" href="/auth/logout" style={{ marginTop: 0 }}>
                  Log out
                </a>
              </div>
            </>
          ) : (
            <p className="fine">Sign-in is turned off on this server (local development).</p>
          )}
        </div>

        <div className="card">
          <div className="kicker cli">Snapshot CLI</div>
          <div className="big">
            {projects === null
              ? '…'
              : `${num(projects.length)} project${projects.length === 1 ? '' : 's'} · ${num(snapshots)} snapshots`}
          </div>
          <p className="fine">
            {latest?.received_at
              ? `Last one ${clock(latest.received_at)} from ${latest.name}`
              : 'Nothing received yet'}
          </p>
          <div className="card-actions">
            <a className="btn-lime" href={href('extensions')}>
              Install on a machine
            </a>
          </div>
        </div>

        <div className="card">
          <div className="kicker ht">Hackatime</div>
          <div className="big">
            {ht === null
              ? 'Checking…'
              : !ht.configured
                ? 'Not connected'
                : ht.error
                  ? 'Can’t be read'
                  : `Connected${ht.username ? ` as ${ht.username}` : ''}`}
          </div>
          <p className="fine">
            {ht && ht.configured ? (ht.error ? HT_ERRORS[ht.error] : SOURCES[ht.source]) : ' '}
          </p>
          <div className="card-actions">
            <a href="https://hackatime.hackclub.com" target="_blank" rel="noreferrer">
              Open Hackatime ↗
            </a>
          </div>
        </div>
      </div>

      <Machines machines={machines} error={error} onRevoke={revoke} />
    </>
  );
}

const platform = (m: MachineRow) =>
  m.os ? `${m.os}/${m.arch}` : m.snapshots > 0 ? 'not reported' : '—';

/**
 * One row per live agent key, which is one per install. What each machine
 * runs and sends comes from the snapshots it signed; snapshots sent before
 * keys were recorded on them count for no machine.
 */
function Machines({
  machines,
  error,
  onRevoke,
}: {
  machines: MachineRow[] | null;
  error: string | null;
  onRevoke: (m: MachineRow) => void;
}) {
  const list = machines ?? [];
  const newest = newestVersion(list.map((m) => m.agent_version));
  const isOutdated = (m: MachineRow) =>
    !!(newest && m.agent_version && m.agent_version !== newest && /^\d/.test(m.agent_version));
  const outdated = list.filter(isOutdated);
  const unused = list.filter((m) => !m.last_used && m.snapshots === 0);
  const peak = Math.max(1, ...list.flatMap((m) => m.daily));

  return (
    <div className="card flush">
      <div className="machines-head">
        <h2>Your machines</h2>
        <p>Each install makes one key. Revoke a key and that machine stops sending.</p>
      </div>
      {error && <p className="signin-error" style={{ margin: '0 24px 12px' }}>{error}</p>}
      {machines !== null && list.length === 0 ? (
        <div className="empty">
          No machines yet. <a href={href('extensions')}>Install snapshot-agent</a> to add one.
        </div>
      ) : (
        <div className="scroll-x">
          <table className="machines">
            <thead>
              <tr>
                <th>Machine</th>
                <th className="left" style={{ textAlign: 'left' }}>
                  Platform
                </th>
                <th style={{ textAlign: 'left' }}>Agent</th>
                <th style={{ textAlign: 'left' }}>Last 30 days</th>
                <th>Repos</th>
                <th>Last heard</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {list.map((m) => {
                const quiet = !m.last_used && m.snapshots === 0;
                return (
                  <tr key={m.id} className={quiet ? 'unused' : undefined}>
                    <td>
                      <div className="m-name">{m.label ?? 'Unnamed key'}</div>
                      <div className="m-sub">
                        created {clock(m.created_at)} · {num(m.snapshots)} snapshot{m.snapshots === 1 ? '' : 's'}
                      </div>
                    </td>
                    <td style={{ textAlign: 'left' }}>{platform(m)}</td>
                    <td style={{ textAlign: 'left' }}>
                      {m.agent_version ?? '—'}
                      {isOutdated(m) && <span className="pill warn">update</span>}
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      <div
                        className="spark"
                        role="img"
                        aria-label={`${num(m.daily.reduce((a, b) => a + b, 0))} snapshots in the last 30 days`}
                      >
                        {m.daily.map((n, i) => (
                          <span
                            key={i}
                            className={n ? undefined : 'zero'}
                            style={{ height: `${Math.max(12, (n / peak) * 100)}%` }}
                            title={n ? `${n} snapshot${n === 1 ? '' : 's'}` : undefined}
                          />
                        ))}
                      </div>
                    </td>
                    <td>{num(m.repos)}</td>
                    <td className="when">{m.last_used ? ago(m.last_used) : 'never'}</td>
                    <td>
                      <button className="revoke" onClick={() => onRevoke(m)}>
                        Revoke
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {(outdated.length > 0 || unused.length > 0) && (
        <div className="card-foot warn">
          <span>
            {outdated.length > 0 && (
              <>
                {outdated.map((m) => `“${m.label ?? 'key'}”`).join(', ')} {outdated.length === 1 ? 'runs' : 'run'}{' '}
                {[...new Set(outdated.map((m) => m.agent_version))].join(', ')}. On {outdated.length === 1 ? 'that machine' : 'those machines'} run{' '}
                <span className="kbd-cmd">snapshot-agent update</span>
              </>
            )}
          </span>
          {unused.length > 0 && (
            <span className="muted">
              {unused.length === 1 ? `${unused[0].label ?? 'One'} key never used` : `${unused.length} keys never used`}
              {unused.length === 1 && (
                <>
                  {' · '}
                  <button className="link-btn plain" style={{ fontWeight: 700 }} onClick={() => onRevoke(unused[0])}>
                    revoke it
                  </button>
                </>
              )}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
