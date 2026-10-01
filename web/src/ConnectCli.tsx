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
export function InstallCard({ intro, id }: { intro?: boolean; id?: string }) {
  const [platform, setPlatform] = useState<Platform>(guessPlatform);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
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
  const win = platform === 'windows';
  const shell = win ? 'PowerShell' : 'Terminal';

  return (
    <div className="card" id={id}>
      <h2>snapshot-agent</h2>
      <p className="sub">
        {intro ? 'Nothing has arrived yet. ' : ''}
        One command installs the agent, links it to this dashboard, and starts it at login. It
        follows Hackatime: whatever git repo you are editing gets snapshotted, no project list to
        keep. File contents and names never leave your machine.
      </p>

      <PlatformTabs platform={platform} setPlatform={setPlatform} />

      <ol className="steps">
        <li>
          <strong>Set up Hackatime on the machine you code on.</strong>
          <p>
            Follow the editor setup on{' '}
            <a href="https://hackatime.hackclub.com" target="_blank" rel="noreferrer">
              hackatime.hackclub.com
            </a>{' '}
            and check that your time shows up there. The agent reads Hackatime's log to know which
            repo you are in, so without it nothing gets recorded.
          </p>
        </li>

        <li>
          <strong>Generate your install command.</strong>
          <p>
            It holds a brand-new key and is shown <em>once</em>, so copy it before leaving this page.
            Lost it? Generate another and revoke the old key in <a href="#/settings">Settings</a>.
          </p>
          {command ? (
            <CopyCommand command={command} />
          ) : (
            <button className="btn-secondary" onClick={generate} disabled={busy}>
              {busy ? 'Generating…' : 'Generate install command'}
            </button>
          )}
          {error && <p className="signin-error">{error}</p>}
        </li>

        <li>
          <strong>Open {shell}.</strong>
          {win ? (
            <p>
              Press <kbd>Win</kbd>, type <code>PowerShell</code> and open <b>Windows PowerShell</b>.
              Use PowerShell, not Command Prompt. Don't pick <i>Run as administrator</i>; it isn't
              needed.
            </p>
          ) : (
            <p>
              <b>macOS:</b> press <kbd>⌘</kbd> <kbd>Space</kbd>, type <code>Terminal</code> and press{' '}
              <kbd>Return</kbd>. <b>Linux:</b> open your terminal app (<kbd>Ctrl</kbd> <kbd>Alt</kbd>{' '}
              <kbd>T</kbd> on most desktops). No <code>sudo</code> needed.
            </p>
          )}
        </li>

        <li>
          <strong>Paste the command and press Enter.</strong>
          <p>In about a minute it:</p>
          <ul>
            <li>downloads the latest snapshot-agent and checks it against the release's checksums,</li>
            <li>
              installs it to <code>{win ? '%USERPROFILE%\\.flockatime\\bin' : '~/.flockatime/bin'}</code>
              {win ? ' and adds that folder to your PATH' : ''},
            </li>
            <li>
              checks your key with this server and saves it to <code>~/.snapshot-agent.toml</code>,
            </li>
            <li>
              turns on <code>debug = true</code> in <code>~/.wakatime.cfg</code> so the agent can see
              which file you are in,
            </li>
            <li>starts the agent now and every time you log in.</li>
          </ul>
          <p>
            It ends with <code>done.</code> If it says Hackatime is not installed, finish step 1 and
            run the same command again.
          </p>
        </li>

        <li>
          <strong>Check it and start coding.</strong>
          <p>
            {win ? 'Open a new PowerShell window (so it picks up the new PATH)' : 'In a new terminal window'},
            run <code>snapshot-agent doctor</code>. It should print <code>reach: ok</code>.{' '}
            {!win && (
              <>
                If the command is not found, add <code>~/.flockatime/bin</code> to your PATH.{' '}
              </>
            )}
            Then edit a file in any git repo. The project appears under{' '}
            <a href="#/projects">Projects</a> within a couple of minutes.
          </p>
        </li>
      </ol>

      <p className="sub cmd-note">
        Upgrading: run a fresh install command; it replaces the binary and restarts the agent.
        Details per platform:{' '}
        <a href="#/docs/install-windows">Windows</a>, <a href="#/docs/install-macos">macOS</a>,{' '}
        <a href="#/docs/install-linux">Linux</a>. Stuck? See{' '}
        <a href="#/docs/troubleshooting">Troubleshooting</a>.
      </p>
    </div>
  );
}

function PlatformTabs({ platform, setPlatform }: { platform: Platform; setPlatform: (p: Platform) => void }) {
  return (
    <div className="controls" role="tablist" aria-label="Platform">
      {(['windows', 'unix'] as const).map((p) => (
        <button
          key={p}
          className="chip"
          role="tab"
          aria-pressed={platform === p}
          aria-selected={platform === p}
          onClick={() => setPlatform(p)}
        >
          {p === 'windows' ? 'Windows (PowerShell)' : 'macOS / Linux'}
        </button>
      ))}
    </div>
  );
}

/** A command in a box with a Copy button; "Copied" resets when the command changes. */
function CopyCommand({ command }: { command: string }) {
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [command]);
  return (
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
  );
}

function uninstallCommand(platform: Platform): string {
  const origin = location.origin;
  return platform === 'windows' ? `irm ${origin}/uninstall.ps1 | iex` : `curl -fsSL ${origin}/uninstall.sh | sh`;
}

/**
 * The way back out: one command, no key, that stops the agent and deletes
 * everything the installer and `setup` put on the machine.
 */
export function UninstallCard({ id }: { id?: string }) {
  const [platform, setPlatform] = useState<Platform>(guessPlatform);
  const win = platform === 'windows';

  return (
    <div className="card" id={id}>
      <h2>Uninstall snapshot-agent</h2>
      <p className="sub">
        Stops the agent and removes it completely. No key needed. Run it in{' '}
        {win ? 'PowerShell' : 'a terminal'} on the machine you want to remove it from.
      </p>

      <PlatformTabs platform={platform} setPlatform={setPlatform} />
      <CopyCommand command={uninstallCommand(platform)} />

      <ul className="steps">
        <li>
          Stops the running agent and removes its start-at-login entry (
          {win ? <code>snapshot-agent.vbs</code> : 'the LaunchAgent on macOS, the systemd user service on Linux'}).
        </li>
        <li>
          Deletes <code>{win ? '%USERPROFILE%\\.flockatime' : '~/.flockatime'}</code>
          {win ? ' and takes it off your PATH' : ''}, plus <code>~/.snapshot-agent.toml</code> (your key) and{' '}
          <code>~/.snapshot-agent-queue.db</code>. Snapshots still waiting to be sent are lost.
        </li>
        <li>
          Leaves Hackatime and <code>~/.wakatime.cfg</code> alone, and keeps everything already on this dashboard.
        </li>
      </ul>

      <p className="sub cmd-note">
        Then revoke that machine's key under <a href="#/settings">Settings → Agent keys</a> so it can't send again.
        Only want to stop it starting at login? Run <code>snapshot-agent uninstall</code> instead; your config stays
        for a later reinstall.
      </p>
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
