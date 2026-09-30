import { useEffect, useState } from 'react';
import { SignedOutError, clock, createKey, listKeys, revokeKey, type ApiKeyRow } from './api';

type Platform = 'windows' | 'unix';

const guessPlatform = (): Platform => (/Win/i.test(navigator.userAgent) ? 'windows' : 'unix');

function installCommand(platform: Platform, token: string): string {
  const origin = location.origin;
  return platform === 'windows'
    ? `$env:FLOCKATIME_KEY='${token}'; irm ${origin}/install.ps1 | iex`
    : `curl -fsSL ${origin}/install.sh | FLOCKATIME_KEY=${token} sh`;
}

const message = (e: unknown) => (e instanceof SignedOutError ? null : String(e));

/**
 * Mints an agent key and hands back the one-line installer with it baked in.
 * The token exists only in this component's state: it is never stored, so
 * leaving the page loses it — the key list in Settings is how old ones get revoked.
 */
export function InstallCard({ intro }: { intro?: boolean }) {
  const [platform, setPlatform] = useState<Platform>(guessPlatform);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    setCopied(false);
    try {
      const label = `${platform === 'windows' ? 'Windows' : 'macOS/Linux'} · ${new Date().toLocaleDateString()}`;
      setToken((await createKey(label)).token);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const command = token ? installCommand(platform, token) : null;

  return (
    <div className="card">
      <h2>snapshot-agent</h2>
      <p className="sub">
        {intro ? 'Nothing has arrived yet. ' : ''}
        One command installs the agent, links it to this dashboard, and starts it at login. It
        follows Hackatime: whatever git repo you are editing gets snapshotted, no project list to
        keep. File contents and names never leave your machine.
      </p>

      <div className="controls" role="tablist" aria-label="Platform">
        {(['windows', 'unix'] as const).map((p) => (
          <button
            key={p}
            className="chip"
            role="tab"
            aria-pressed={platform === p}
            aria-selected={platform === p}
            onClick={() => {
              setPlatform(p);
              setCopied(false);
            }}
          >
            {p === 'windows' ? 'Windows (PowerShell)' : 'macOS / Linux'}
          </button>
        ))}
      </div>

      {command ? (
        <>
          <div className="cmd">
            <code>{command}</code>
            <button
              className="chip"
              onClick={() => {
                navigator.clipboard.writeText(command).then(() => setCopied(true), () => undefined);
              }}
            >
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>
          <p className="sub cmd-note">
            This contains a new key and is shown once. Run it in{' '}
            {platform === 'windows' ? 'PowerShell' : 'a terminal'} on the machine you code on.
            Hackatime needs to be set up there first.
          </p>
        </>
      ) : (
        <button className="btn-secondary" onClick={generate} disabled={busy}>
          {busy ? 'Generating…' : 'Generate install command'}
        </button>
      )}

      {error && <p className="signin-error">{error}</p>}
    </div>
  );
}

/** Every live agent key, with a way to cut one off. */
export function KeysCard() {
  const [keys, setKeys] = useState<ApiKeyRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = () =>
    listKeys()
      .then((r) => setKeys(r.keys))
      .catch((e) => setError(message(e)));

  useEffect(() => {
    refresh();
  }, []);

  const revoke = async (k: ApiKeyRow) => {
    if (!confirm(`Revoke "${k.label ?? 'key'}"? Any agent using it stops sending.`)) return;
    try {
      await revokeKey(k.id);
      refresh();
    } catch (e) {
      setError(message(e));
    }
  };

  const active = (keys ?? []).filter((k) => !k.revoked_at);

  return (
    <div className="card">
      <h2>Agent keys</h2>
      <p className="sub">
        Each install command mints one. Revoking a key stops that machine's agent from sending.
      </p>
      {error && <p className="signin-error">{error}</p>}
      {keys !== null && active.length === 0 && <div className="empty">No active keys.</div>}
      {active.length > 0 && (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Created</th>
                <th>Last used</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {active.map((k) => (
                <tr key={k.id}>
                  <td>{k.label ?? '—'}</td>
                  <td>{clock(k.created_at)}</td>
                  <td>{k.last_used ? clock(k.last_used) : 'never'}</td>
                  <td>
                    <button className="link-btn" onClick={() => revoke(k)}>
                      Revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
