import { useEffect, useState } from 'react';
import { SignedOutError, createKey, listProjects, type Hackatime, type ProjectRow } from './api';
import { htOk } from './pages/Home';
import { Pills } from './ui';

export type Platform = 'windows' | 'unix';

export const guessPlatform = (): Platform => (/Win/i.test(navigator.userAgent) ? 'windows' : 'unix');

export function PlatformPills({ platform, setPlatform }: { platform: Platform; setPlatform: (p: Platform) => void }) {
  return (
    <Pills
      label="Platform"
      value={platform}
      options={[
        { value: 'windows', label: 'Windows' },
        { value: 'unix', label: 'macOS / Linux' },
      ]}
      onChange={setPlatform}
    />
  );
}

function installCommand(platform: Platform, token: string): string {
  const origin = location.origin;
  return platform === 'windows'
    ? `$env:FLOCKATIME_KEY='${token}'; irm ${origin}/install.ps1 | iex`
    : `curl -fsSL ${origin}/install.sh | FLOCKATIME_KEY=${token} sh`;
}

const message = (e: unknown) => (e instanceof SignedOutError ? null : String(e));

const POLL_MS = 5000;

type StepState = 'done' | 'active' | 'todo';

function Step({
  n,
  state,
  title,
  children,
}: {
  n: number;
  state: StepState;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className={`step ${state}`} aria-current={state === 'active' ? 'step' : undefined}>
      <div className="step-num" aria-hidden>
        {state === 'done' ? '✓' : String(n).padStart(2, '0')}
      </div>
      <div>
        <h2>
          <span className="sr-only">{state === 'done' ? 'Done: ' : `Step ${n}: `}</span>
          {title}
        </h2>
        {children}
      </div>
    </section>
  );
}

/**
 * The three install steps. Step 2 mints an agent key and bakes it into a
 * one-line installer; the token lives only in this component's state, never
 * stored, so leaving the page loses it. Step 3 then watches for a snapshot
 * that arrived after the key was made.
 */
export function SetupSteps({ ht, platform }: { ht: Hackatime | null; platform: Platform }) {
  const [token, setToken] = useState<string | null>(null);
  const [mintedAt, setMintedAt] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [arrived, setArrived] = useState<ProjectRow | null>(null);

  const ok = htOk(ht);
  const htReady = !!ok;

  // After a key is minted, poll until something reaches the server.
  useEffect(() => {
    if (mintedAt === null || arrived) return;
    let live = true;
    const check = () => {
      if (document.hidden) return;
      listProjects(1)
        .then((r) => {
          const first = r.projects.find((p) => (p.received_at ?? 0) >= mintedAt);
          if (live && first) setArrived(first);
        })
        .catch(() => undefined);
    };
    const id = setInterval(check, POLL_MS);
    return () => {
      live = false;
      clearInterval(id);
    };
  }, [mintedAt, arrived]);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const label = `${platform === 'windows' ? 'Windows' : 'macOS/Linux'} · ${new Date().toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
      })}`;
      const at = Math.floor(Date.now() / 1000) - 5;
      setToken((await createKey(label)).token);
      setMintedAt(at);
    } catch (e) {
      setError(message(e));
    } finally {
      setBusy(false);
    }
  };

  const win = platform === 'windows';
  const shell = win ? 'PowerShell' : 'a terminal';
  const command = token ? installCommand(platform, token) : null;

  const s1: StepState = htReady ? 'done' : 'active';
  const s2: StepState = token ? 'done' : htReady ? 'active' : 'todo';
  const s3: StepState = arrived ? 'done' : token ? 'active' : 'todo';

  return (
    <>
      <Step n={1} state={s1} title={htReady ? 'Hackatime is connected' : 'Set up Hackatime'}>
        {htReady ? (
          <p>
            {ok.username ? (
              <>
                Signed in as <strong>{ok.username}</strong>.{' '}
              </>
            ) : null}
            The agent reads Hackatime’s log to know which repo you’re in.
          </p>
        ) : (
          <p>
            Follow the editor setup on{' '}
            <a href="https://hackatime.hackclub.com" target="_blank" rel="noreferrer">
              hackatime.hackclub.com
            </a>{' '}
            and check your time shows up there. The agent reads Hackatime’s log to know which repo you’re in, so
            without it nothing gets recorded.
            {ht && ht.configured && ht.error ? ' Hackatime could not be read from here right now.' : ''}
          </p>
        )}
      </Step>

      <Step n={2} state={s2} title="Copy your install command">
        <p>
          {win ? (
            <>
              Open PowerShell (press <strong>Win</strong>, type <strong>PowerShell</strong>). No admin needed.
            </>
          ) : (
            <>
              Open a terminal (<strong>⌘ Space</strong>, “Terminal” on macOS). No <code>sudo</code> needed.
            </>
          )}{' '}
          Paste, press Enter, wait for <code>done.</code>
        </p>
        <div className="well">
          {command ? (
            <>
              <CopyCommand command={command} />
              <span>
                Shown once. Lost it? Generate another and revoke the old key in <a href="#/settings">Settings</a>.
              </span>
            </>
          ) : (
            <>
              <button className="btn-lime" onClick={generate} disabled={busy}>
                {busy ? 'Generating…' : 'Generate command'}
              </button>
              <span>Includes a new key, shown once.</span>
            </>
          )}
          {error && <p className="signin-error">{error}</p>}
        </div>
        <details>
          <summary>What does it do?</summary>
          <ul>
            <li>Downloads the latest snapshot-agent and checks it against the release’s checksums.</li>
            <li>
              Installs it to <code>{win ? '%USERPROFILE%\\.flockatime\\bin' : '~/.flockatime/bin'}</code>
              {win ? ' and adds that folder to your PATH' : ''}.
            </li>
            <li>
              Checks your key with this server and saves it to <code>~/.snapshot-agent.toml</code>.
            </li>
            <li>
              Turns on <code>debug = true</code> in <code>~/.wakatime.cfg</code> so the agent can see which file
              you are in.
            </li>
            <li>Starts the agent now and every time you log in.</li>
          </ul>
        </details>
      </Step>

      <Step n={3} state={s3} title="Check it works">
        <p>
          In a new {win ? 'PowerShell window' : 'terminal'} run <code>snapshot-agent doctor</code>. You should see{' '}
          <code className="ok">reach: ok</code>. Then edit a file in any git repo.
          {!win && (
            <>
              {' '}
              Command not found? Add <code>~/.flockatime/bin</code> to your PATH.
            </>
          )}
        </p>
        {arrived ? (
          <div className="waiting ok">
            First snapshot received from&nbsp;<a href={`#/projects/${encodeURIComponent(arrived.name)}`}>{arrived.name}</a>.
          </div>
        ) : (
          <div className="waiting" role="status">
            {token ? 'Waiting for the first snapshot. This page updates by itself.' : `Run the command in ${shell} first.`}
          </div>
        )}
      </Step>
    </>
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
export function UninstallCard({ id, platform }: { id?: string; platform: Platform }) {
  const win = platform === 'windows';

  return (
    <div className="card" id={id}>
      <h2>Uninstall snapshot-agent</h2>
      <p className="sub">
        Stops the agent and removes it completely. No key needed. Run it in {win ? 'PowerShell' : 'a terminal'} on
        the machine you want to remove it from.
      </p>

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
        Then revoke that machine’s key under <a href="#/settings">Settings → Your machines</a> so it can’t send
        again. Only want to stop it starting at login? Run <code>snapshot-agent uninstall</code> instead; your config
        stays for a later reinstall.
      </p>
    </div>
  );
}
