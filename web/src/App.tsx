import { useEffect, useState } from 'react';
import { getHackatime, getMe, getViewAs, setSignedOutHandler, setViewAs, type Hackatime, type ViewAs } from './api';
import { LoggedOut } from './LoggedOut';
import { Home } from './pages/Home';
import { Projects } from './pages/Projects';
import { Docs } from './pages/Docs';
import { Extensions } from './pages/Extensions';
import { Settings } from './pages/Settings';
import { Admin } from './pages/Admin';
import type { Source } from './ui';

export interface User {
  name: string | null;
  email: string;
}

type Auth = { state: 'loading' } | { state: 'out' } | { state: 'in'; user: User | null; admin: boolean };

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
      .then((r) => {
        // A view-as left over in this tab means nothing to a non-admin.
        if (!r.admin) setViewAs(null);
        setAuth(r.auth && !r.user ? { state: 'out' } : { state: 'in', user: r.user, admin: !!r.admin });
      })
      .catch(() => setAuth({ state: 'out' }));
  }, [reason]);

  if (auth.state === 'loading') return null;
  if (auth.state === 'out') return <LoggedOut reason={reason} />;
  return <Shell user={auth.user} admin={auth.admin} />;
}

const NAV = [
  { page: 'home', label: 'Home' },
  { page: 'projects', label: 'Projects' },
  { page: 'docs', label: 'Docs' },
  { page: 'extensions', label: 'Extensions' },
  { page: 'settings', label: 'Settings' },
  { page: 'admin', label: 'Admin Panel', admin: true },
] as const;

export type Page = (typeof NAV)[number]['page'];

/**
 * `#/projects/<name>` → { page: 'projects', project: name }. Unknown pages land on home.
 * Docs reuse the second segment for `<slug>#<anchor>`, and Admin for an account id.
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

/** Switches the dashboard to another account's data (admins only), or back with null. */
export type ViewAsFn = (v: ViewAs | null, page?: Page, project?: string) => void;

function Shell({ user, admin }: { user: User | null; admin: boolean }) {
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
  const [viewAs, setViewAsState] = useState<ViewAs | null>(() => (admin ? getViewAs() : null));

  // Leaving view-as goes back to that account's admin page.
  const viewAsAccount: ViewAsFn = (v, page = v ? 'home' : 'admin', project) => {
    const back = viewAs?.id;
    setViewAs(v);
    setViewAsState(v);
    location.hash = href(page, project ?? (v ? undefined : back));
  };

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
  }, [days, viewAs?.id]);

  const display = user ? user.name ?? user.email.split('@')[0] : 'Local dev';
  // The pages talk about whoever's data they show.
  const shown: User | null = viewAs ? { name: viewAs.name, email: viewAs.email ?? viewAs.id } : user;
  const page = route.page === 'admin' && !admin ? 'home' : route.page;

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
          {NAV.filter((n) => admin || !('admin' in n)).map((n) => (
            <a
              key={n.page}
              href={href(n.page)}
              aria-current={page === n.page ? 'page' : undefined}
              className={'admin' in n ? 'nav-admin' : undefined}
            >
              {'admin' in n ? <span>{n.label}</span> : n.label}
            </a>
          ))}
        </nav>

        <div className="brand">flockatime</div>
      </aside>

      <main className={page === 'docs' || page === 'admin' ? 'main wide' : 'main'} key={viewAs?.id ?? 'self'}>
        {viewAs && page !== 'admin' && (
          <div className="view-as" role="status">
            <span>
              Viewing as <strong>{viewAs.name ?? viewAs.email ?? viewAs.id}</strong>
              {viewAs.name && viewAs.email ? ` · ${viewAs.email}` : ''}. Anything you change here changes
              their account.
            </span>
            <button className="chip" onClick={() => viewAsAccount(null)}>
              Back to admin
            </button>
          </div>
        )}
        {page === 'home' && (
          <Home user={shown} days={days} setDays={setDays} ht={ht} source={source} setSource={setSource} />
        )}
        {page === 'projects' && (
          <Projects
            project={route.project}
            days={days}
            setDays={setDays}
            ht={ht}
            source={source}
            setSource={setSource}
          />
        )}
        {page === 'docs' && <Docs route={route.project} />}
        {page === 'extensions' && <Extensions focus={route.project} />}
        {page === 'settings' && <Settings user={shown} ht={ht} />}
        {page === 'admin' && <Admin account={route.project} viewAs={viewAs} onViewAs={viewAsAccount} />}
      </main>
    </div>
  );
}
