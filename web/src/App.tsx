import { useEffect, useState } from 'react';
import { getHackatime, getMe, setSignedOutHandler, type Hackatime } from './api';
import { LoggedOut } from './LoggedOut';
import { Home } from './pages/Home';
import { Projects } from './pages/Projects';
import { Docs } from './pages/Docs';
import { Extensions } from './pages/Extensions';
import { Settings } from './pages/Settings';
import type { Source } from './ui';

export interface User {
  name: string | null;
  email: string;
}

type Auth = { state: 'loading' } | { state: 'out' } | { state: 'in'; user: User | null };

/**
 * The sign-in gate. Nothing but the logged-out screen renders without a
 * session, and any 401 later (expiry, allowlist change) drops back to it.
 */
export default function App() {
  const [auth, setAuth] = useState<Auth>({ state: 'loading' });
  const [reason] = useState(() => new URLSearchParams(location.search).get('auth_error'));

  useEffect(() => {
    // The reason code is read once; keep it out of the address bar after that.
    if (reason) history.replaceState(null, '', location.pathname + location.hash);
    setSignedOutHandler(() => setAuth({ state: 'out' }));
    getMe()
      .then((r) => setAuth(r.auth && !r.user ? { state: 'out' } : { state: 'in', user: r.user }))
      .catch(() => setAuth({ state: 'out' }));
  }, [reason]);

  if (auth.state === 'loading') return null;
  if (auth.state === 'out') return <LoggedOut reason={reason} />;
  return <Shell user={auth.user} />;
}

const NAV = [
  { page: 'home', label: 'Home' },
  { page: 'projects', label: 'Projects' },
  { page: 'docs', label: 'Docs' },
  { page: 'extensions', label: 'Extensions' },
  { page: 'settings', label: 'Settings' },
] as const;

export type Page = (typeof NAV)[number]['page'];

/**
 * `#/projects/<name>` → { page: 'projects', project: name }. Unknown pages land on home.
 * Docs reuse the second segment for `<slug>#<anchor>`.
 */
function parseHash(hash: string): { page: Page; project: string | null } {
  const [page, project] = hash.replace(/^#\/?/, '').split('/');
  const known = NAV.some((n) => n.page === page) ? (page as Page) : 'home';
  return { page: known, project: project ? decodeURIComponent(project) : null };
}

export const href = (page: Page, project?: string) =>
  `#/${page === 'home' ? '' : page}${project ? `/${encodeURIComponent(project)}` : ''}`;

/** The data source filter is remembered per browser, so a debugging view survives a reload. */
const SOURCE_KEY = 'fk_source';
function readSource(): Source {
  try {
    const v = localStorage.getItem(SOURCE_KEY);
    return v === 'cli' || v === 'hackatime' ? v : 'all';
  } catch {
    return 'all';
  }
}

function Shell({ user }: { user: User | null }) {
  const [route, setRoute] = useState(() => parseHash(location.hash));
  const [days, setDays] = useState(7);
  const [source, setSourceState] = useState<Source>(readSource);
  const setSource = (s: Source) => {
    setSourceState(s);
    try {
      localStorage.setItem(SOURCE_KEY, s);
    } catch {
      // Only a convenience; the filter still works for this visit.
    }
  };
  const [ht, setHt] = useState<Hackatime | null>(null);

  useEffect(() => {
    const onHash = () => {
      setRoute(parseHash(location.hash));
      window.scrollTo(0, 0);
    };
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  // Hackatime is account-wide and slow-moving: fetched once per window and
  // shared by every page, never polled. A failure only empties its own panels.
  useEffect(() => {
    let live = true;
    setHt(null);
    getHackatime(days)
      .then((r) => live && setHt(r))
      .catch(() => live && setHt({ configured: true, source: 'hack_club', error: 'unavailable' }));
    return () => {
      live = false;
    };
  }, [days]);

  const display = user ? user.name ?? user.email.split('@')[0] : 'Local dev';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="me">
          <div className="avatar" aria-hidden>
            {display.trim().charAt(0).toUpperCase()}
          </div>
          <div className="me-text">
            <div className="me-name" title={display}>
              {display}
            </div>
            {user && (
              <div className="me-email" title={user.email}>
                {user.email}
              </div>
            )}
          </div>
        </div>
        {user && (
          <a className="logout" href="/auth/logout">
            Log out
          </a>
        )}

        <nav className="nav" aria-label="Main">
          {NAV.map((n) => (
            <a key={n.page} href={href(n.page)} aria-current={route.page === n.page ? 'page' : undefined}>
              {n.label}
            </a>
          ))}
        </nav>

        <div className="brand">flockatime</div>
      </aside>

      <main className={route.page === 'docs' ? 'main wide' : 'main'}>
        {route.page === 'home' && <Home user={user} days={days} setDays={setDays} ht={ht} source={source} setSource={setSource} />}
        {route.page === 'projects' && (
          <Projects
            project={route.project}
            days={days}
            setDays={setDays}
            ht={ht}
            source={source}
            setSource={setSource}
          />
        )}
        {route.page === 'docs' && <Docs route={route.project} />}
        {route.page === 'extensions' && <Extensions />}
        {route.page === 'settings' && <Settings user={user} ht={ht} />}
      </main>
    </div>
  );
}
