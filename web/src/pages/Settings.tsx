import type { Hackatime } from '../api';
import type { User } from '../App';
import { KeysCard } from '../ConnectCli';
import { PageHead } from '../ui';
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

      <div className="card">
        <h2>Hackatime</h2>
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
