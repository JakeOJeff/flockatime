import { useEffect, useMemo, useState } from 'react';
import {
  SignedOutError,
  access,
  admin,
  bytes,
  clock,
  num,
  shortSha,
  type AccessRow,
  type AdminOverview,
  type AdminSnapshotRow,
  type AdminUser,
  type AdminUserRow,
  type ApiKeyRow,
  type Role,
  type ViewAs,
} from '../api';
import { href, type ViewAsFn } from '../App';
import { PageHead, Tile } from '../ui';

const message = (e: unknown) => (e instanceof SignedOutError ? null : e instanceof Error ? e.message : String(e));

const when = (t: number | null | undefined) => (t ? clock(t) : '—');

/** What to call an account in a list: name, else email, else its raw id. */
const labelOf = (u: { id: string; name: string | null; email: string | null }) => u.name ?? u.email ?? u.id;

/**
 * Every account on the deployment (`#/admin`) or one of them in full
 * (`#/admin/<id>`). Reads and writes go through /api/admin; "View as" switches
 * the ordinary dashboard pages to that account instead.
 */
export function Admin({
  account,
  viewAs,
  onViewAs,
}: {
  account: string | null;
  viewAs: ViewAs | null;
  onViewAs: ViewAsFn;
}) {
  return account ? (
    <AdminAccount id={account} onViewAs={onViewAs} />
  ) : (
    <AdminHome viewAs={viewAs} onViewAs={onViewAs} />
  );
}

/* ---------- the account list ---------- */

function AdminHome({ viewAs, onViewAs }: { viewAs: ViewAs | null; onViewAs: ViewAsFn }) {
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [users, setUsers] = useState<AdminUserRow[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');

  const load = () => {
    admin.overview().then(setOverview).catch((e) => setError(message(e)));
    admin
      .users()
      .then((r) => setUsers(r.users))
      .catch((e) => setError(message(e)));
  };
  useEffect(load, []);

  const waiting = users?.filter((u) => u.email && !u.role && u.last_login && !u.disabled_at).length ?? 0;

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!users || !needle) return users;
    return users.filter((u) => [u.id, u.email, u.name].some((v) => v?.toLowerCase().includes(needle)));
  }, [users, q]);

  return (
    <>
      <PageHead eyebrow="Admin" title="Everyone on flockatime">
        <p className="lede">Every account, what it has sent, and the controls to change any of it.</p>
      </PageHead>

      {viewAs && (
        <div className="notice">
          You are still viewing the dashboard as <strong>{labelOf(viewAs)}</strong>.{' '}
          <button className="link-btn plain" onClick={() => onViewAs(null, 'admin')}>
            Stop
          </button>
        </div>
      )}
      {error && <p className="signin-error">{error}</p>}

      {waiting > 0 && (
        <div className="notice">
          {waiting} {waiting === 1 ? 'person has' : 'people have'} signed in without being on the list. They are
          marked <strong>Wants access</strong> below.
        </div>
      )}

      {overview && (
        <div className="tiles six">
          <Tile
            label="Accounts"
            value={num(overview.accounts)}
            sub={overview.disabled ? `${overview.disabled} disabled` : undefined}
            accent
          />
          <Tile label="Active today" value={num(overview.active_24h)} sub="sent a snapshot in 24h" />
          <Tile label="Projects" value={num(overview.projects)} />
          <Tile label="Snapshots" value={num(overview.snapshots)} sub={`${num(overview.snapshots_24h)} in 24h`} />
          <Tile label="Active keys" value={num(overview.active_keys)} />
          <Tile label="Stored file lists" value={bytes(overview.stored_bytes)} sub={`${num(overview.trees)} trees`} />
        </div>
      )}

      <div className="card">
        <h2>Accounts</h2>
        <p className="sub">Open one to inspect everything it has sent, or view the dashboard as them.</p>
        <div className="filters">
          <input
            className="input"
            type="search"
            placeholder="Search name, email or id"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {filtered === null ? (
          <div className="empty">Loading…</div>
        ) : filtered.length === 0 ? (
          <div className="empty">No accounts match.</div>
        ) : (
          <div className="scroll-x">
            <table>
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Projects</th>
                  <th>Snapshots</th>
                  <th>Keys</th>
                  <th>Last snapshot</th>
                  <th>Last sign-in</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id} className="row-link" onClick={() => (location.hash = href('admin', u.id))}>
                    <td>
                      <a href={href('admin', u.id)} onClick={(e) => e.stopPropagation()}>
                        {labelOf(u)}
                      </a>
                      {u.name && u.email && <div className="muted small">{u.email}</div>}
                      {!u.email && <div className="muted small">no account row · {u.id}</div>}
                    </td>
                    <td>{num(u.projects)}</td>
                    <td>{num(u.snapshots)}</td>
                    <td>{num(u.active_keys)}</td>
                    <td>{when(u.last_received)}</td>
                    <td>{u.last_login ? clock(u.last_login) : 'never'}</td>
                    <td>
                      {u.role === 'admin' && <span className="pill">Admin</span>}
                      {u.email && !u.role && (u.last_login ? (
                        <>
                          <span className="pill warn" title="Signed in but is not on the list">
                            Wants access
                          </span>
                          <button
                            className="link-btn plain let-in"
                            onClick={(e) => {
                              e.stopPropagation();
                              access.set(u.email!, 'user').then(load, (err) => setError(message(err)));
                            }}
                          >
                            Let in
                          </button>
                        </>
                      ) : (
                        <span className="pill muted-pill">No access</span>
                      ))}
                      {u.disabled_at ? <span className="pill bad">Disabled</span> : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <AccessCard onChange={load} />
      <NewAccount onCreated={load} />
    </>
  );
}

/**
 * Who may sign in and who is admin. The page's own entries can be changed; the
 * ones from wrangler.jsonc are listed so the whole picture is here, but only a
 * deploy changes them.
 */
function AccessCard({ onChange }: { onChange: () => void }) {
  const [data, setData] = useState<{ entries: AccessRow[]; config: { allowed: string[]; admins: string[] } } | null>(
    null,
  );
  const [entry, setEntry] = useState('');
  const [role, setRole] = useState<Role>('user');
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    access
      .list()
      .then(setData)
      .catch((e) => setError(message(e)));
  useEffect(() => {
    load();
  }, []);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      onChange();
      return true;
    } catch (e) {
      setError(message(e));
      return false;
    }
  };

  const add = async (e: React.FormEvent) => {
    e.preventDefault();
    if (await run(() => access.set(entry, role))) setEntry('');
  };

  const fixed = data
    ? [
        ...data.config.admins.map((e) => ({ entry: e, role: 'admin' as Role })),
        ...data.config.allowed
          .filter((e) => !data.config.admins.includes(e))
          .map((e) => ({ entry: e, role: 'user' as Role })),
      ]
    : [];

  return (
    <div className="card">
      <h2>Who can sign in</h2>
      <p className="sub">
        Add an email to let that person sign in, or an <code>@domain</code> to let everyone at that exact domain in.
        Admins get this page; only a single email can be admin. Removing someone locks them out on their next
        request, agents included.
      </p>

      <form className="form-row" onSubmit={add}>
        <input
          className="input"
          required
          placeholder="name@example.com or @example.com"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
        />
        <select value={role} onChange={(e) => setRole(e.target.value as Role)}>
          <option value="user">Can sign in</option>
          <option value="admin">Admin</option>
        </select>
        <button className="btn-secondary">Add</button>
      </form>
      {error && <p className="signin-error">{error}</p>}

      {data && (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Email or domain</th>
                <th>Role</th>
                <th>Added</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.entries.map((a) => (
                <tr key={a.entry}>
                  <td>{a.entry}</td>
                  <td>
                    {a.entry.startsWith('@') ? (
                      'Can sign in'
                    ) : (
                      <select value={a.role} onChange={(e) => run(() => access.set(a.entry, e.target.value as Role))}>
                        <option value="user">Can sign in</option>
                        <option value="admin">Admin</option>
                      </select>
                    )}
                  </td>
                  <td>
                    {clock(a.created_at)}
                    {a.added_by && <div className="muted small">by {a.added_by}</div>}
                  </td>
                  <td>
                    <button
                      className="link-btn"
                      onClick={() =>
                        confirm(`Remove ${a.entry}? Anyone it lets in is signed out and their agents stop.`) &&
                        run(() => access.remove(a.entry))
                      }
                    >
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {fixed.map((a) => (
                <tr key={`cfg:${a.entry}`} className="dim">
                  <td>{a.entry}</td>
                  <td>{a.role === 'admin' ? 'Admin' : 'Can sign in'}</td>
                  <td>wrangler.jsonc</td>
                  <td title="Set in wrangler.jsonc; change it there and redeploy">fixed</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/** One account's sign-in access, changed through its own access entry. */
function AccountAccess({ email, onChange }: { email: string; onChange: () => void }) {
  type Check = Awaited<ReturnType<typeof access.check>>;
  const [state, setState] = useState<Check | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    access
      .check(email)
      .then(setState)
      .catch((e) => setError(message(e)));
  useEffect(() => {
    load();
  }, [email]);

  const run = async (fn: () => Promise<unknown>) => {
    setError(null);
    try {
      await fn();
      await load();
      onChange();
    } catch (e) {
      setError(message(e));
    }
  };

  if (!state) return error ? <p className="signin-error">{error}</p> : null;

  const label = state.role === 'admin' ? 'Admin' : state.role === 'user' ? 'Can sign in' : 'Cannot sign in';
  const why = state.config_admin
    ? 'Admin through ADMIN_EMAILS in wrangler.jsonc, which only a deploy changes.'
    : state.entry && state.other
      ? 'Also let in by a domain entry or wrangler.jsonc, so removing this email alone keeps them signed in.'
      : !state.entry && state.other
        ? 'Let in by a domain entry or wrangler.jsonc.'
        : null;

  return (
    <>
      <dl className="facts">
        <dt>Access</dt>
        <dd>
          {label}
          {why && <div className="muted small">{why}</div>}
        </dd>
      </dl>
      <div className="btn-row">
        {!state.role && (
          <button className="btn-secondary inline ghost" onClick={() => run(() => access.set(email, 'user'))}>
            Let them sign in
          </button>
        )}
        {state.role !== 'admin' && (
          <button className="btn-secondary inline ghost" onClick={() => run(() => access.set(email, 'admin'))}>
            Make admin
          </button>
        )}
        {state.role === 'admin' && state.entry?.role === 'admin' && (
          <button className="btn-secondary inline ghost" onClick={() => run(() => access.set(email, 'user'))}>
            Remove admin
          </button>
        )}
        {state.entry && (
          <button
            className="btn-secondary inline ghost"
            onClick={() =>
              confirm(`Remove ${email} from the sign-in list?`) && run(() => access.remove(email))
            }
          >
            Remove from sign-in list
          </button>
        )}
      </div>
      {error && <p className="signin-error">{error}</p>}
    </>
  );
}

function NewAccount({ onCreated }: { onCreated: () => void }) {
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [id, setId] = useState('');
  const [allow, setAllow] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await admin.createUser({ email, name: name || undefined, id: id || undefined });
      if (allow) await access.set(email, 'user');
      setEmail('');
      setName('');
      setId('');
      onCreated();
      location.hash = href('admin', r.id);
    } catch (err) {
      setError(message(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card">
      <h2>Add an account</h2>
      <p className="sub">
        With their Hack Club Auth id, this is the account they land in when they sign in, so you can set up keys
        or move projects to them first. Without one, it gets a made-up id nobody can sign in as.
      </p>
      <form className="form-row" onSubmit={submit}>
        <input className="input" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="input" placeholder="Name (optional)" value={name} onChange={(e) => setName(e.target.value)} />
        <input className="input" placeholder="Hack Club Auth id (optional)" value={id} onChange={(e) => setId(e.target.value)} />
        <label className="check">
          <input type="checkbox" checked={allow} onChange={(e) => setAllow(e.target.checked)} /> Let them sign in
        </label>
        <button className="btn-secondary" disabled={busy}>
          {busy ? 'Adding…' : 'Add account'}
        </button>
      </form>
      {error && <p className="signin-error">{error}</p>}
    </div>
  );
}

/* ---------- one account ---------- */

function AdminAccount({ id, onViewAs }: { id: string; onViewAs: ViewAsFn }) {
  const [data, setData] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Bumped after any write so the snapshot log reloads with the rest.
  const [rev, setRev] = useState(0);

  const load = () =>
    admin
      .user(id)
      .then((r) => {
        setData(r);
        setError(null);
      })
      .catch((e) => setError(message(e)));
  useEffect(() => {
    setData(null);
    load();
  }, [id]);

  const reload = () => {
    load();
    setRev((r) => r + 1);
  };

  /** Runs a write, then reloads; a refusal is shown rather than thrown. */
  const act = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      reload();
    } catch (e) {
      setError(message(e));
    }
  };

  if (!data) {
    return (
      <>
        <a className="back" href={href('admin')}>
          ← All accounts
        </a>
        {error ? <div className="card">Could not load this account: {error}</div> : null}
      </>
    );
  }

  const a = data.account;
  const t = data.totals;
  const viewAs: ViewAs = { id, name: a?.name ?? null, email: a?.email ?? null };

  return (
    <>
      <a className="back" href={href('admin')}>
        ← All accounts
      </a>
      <PageHead eyebrow="Admin · account" title={a ? labelOf({ id, name: a.name, email: a.email }) : id}>
        <p className="lede">
          {a?.email ?? 'No account row: data recorded under this id with no sign-in attached.'}
          {a?.disabled_at ? <span className="pill bad">Disabled {clock(a.disabled_at)}</span> : null}
        </p>
        <div className="btn-row">
          <button className="btn-secondary inline" onClick={() => onViewAs(viewAs)}>
            View dashboard as them
          </button>
        </div>
      </PageHead>

      {error && <p className="signin-error">{error}</p>}

      <div className="tiles six">
        <Tile label="Projects" value={num(data.projects.length)} accent />
        <Tile label="Snapshots" value={num(t?.snapshots)} sub={`${num(t?.snapshots_7d)} in the last 7 days`} />
        <Tile label="Lines added" value={num(t?.lines_added)} sub={`${num(t?.lines_removed)} removed`} />
        <Tile label="Active keys" value={num(data.keys.filter((k) => !k.revoked_at).length)} />
        <Tile label="Last snapshot" value={t?.last_received ? clock(t.last_received) : '—'} />
        <Tile label="Stored" value={bytes(t?.stored_bytes)} sub={`${num(t?.trees)} trees`} />
      </div>

      <Profile id={id} data={data} act={act} />
      <ProjectsCard id={id} data={data} act={act} onViewAs={(p) => onViewAs(viewAs, 'projects', p)} />
      <KeysAdmin id={id} keys={data.keys} act={act} />
      <SnapshotLog id={id} projects={data.projects.map((p) => p.name)} rev={rev} act={act} />
      <DangerZone id={id} data={data} act={act} />
    </>
  );
}

type Act = (fn: () => Promise<unknown>) => Promise<void>;

function Profile({ id, data, act }: { id: string; data: AdminUser; act: Act }) {
  const a = data.account;
  const [editing, setEditing] = useState(false);
  const [email, setEmail] = useState(a?.email ?? '');
  const [name, setName] = useState(a?.name ?? '');

  useEffect(() => {
    setEmail(a?.email ?? '');
    setName(a?.name ?? '');
  }, [a?.email, a?.name]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await act(() => admin.updateUser(id, { email, name }));
    setEditing(false);
  };

  return (
    <div className="card">
      <h2>Profile</h2>
      {editing ? (
        <form className="form-row" onSubmit={save}>
          <input className="input" type="email" required placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className="input" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <button className="btn-secondary">Save</button>
          <button type="button" className="btn-secondary ghost" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </form>
      ) : (
        <>
          <dl className="facts">
            <dt>Account id</dt>
            <dd className="mono">{id}</dd>
            <dt>Name</dt>
            <dd>{a?.name ?? '—'}</dd>
            <dt>Email</dt>
            <dd>{a?.email ?? '—'}</dd>
            <dt>Created</dt>
            <dd>{when(a?.created_at)}</dd>
            <dt>Last sign-in</dt>
            <dd>{a?.last_login ? clock(a.last_login) : 'never'}</dd>
            <dt>First snapshot</dt>
            <dd>{when(data.totals?.first_seen)}</dd>
          </dl>
          {a?.email && <AccountAccess email={a.email} onChange={() => act(async () => undefined)} />}
          <button className="btn-secondary inline ghost" onClick={() => setEditing(true)}>
            {a ? 'Edit profile' : 'Create account row'}
          </button>
        </>
      )}
    </div>
  );
}

function ProjectsCard({
  id,
  data,
  act,
  onViewAs,
}: {
  id: string;
  data: AdminUser;
  act: Act;
  onViewAs: (project: string) => void;
}) {
  const rename = (name: string) => {
    const next = prompt(`Rename "${name}" to:`, name)?.trim();
    if (next && next !== name) act(() => admin.updateProject(id, name, { name: next }));
  };
  const move = (name: string) => {
    const to = prompt(`Move "${name}" and all its snapshots to which account id?`)?.trim();
    if (to && to !== id) act(() => admin.updateProject(id, name, { to }));
  };
  const remove = (name: string, snapshots: number) => {
    if (confirm(`Delete "${name}" and its ${num(snapshots)} snapshots? This cannot be undone.`)) {
      act(() => admin.deleteProject(id, name));
    }
  };

  return (
    <div className="card">
      <h2>Projects</h2>
      <p className="sub">Open one to see its charts as they do.</p>
      {data.projects.length === 0 ? (
        <div className="empty">No projects.</div>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Project</th>
                <th>Snapshots</th>
                <th>Lines</th>
                <th>Files</th>
                <th>Branch</th>
                <th>Agent</th>
                <th>Last snapshot</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.name}>
                  <td>
                    <button className="link-btn plain" onClick={() => onViewAs(p.name)}>
                      {p.name}
                    </button>
                  </td>
                  <td>{num(p.snapshots)}</td>
                  <td>{num(p.total_lines)}</td>
                  <td>{num(p.file_count)}</td>
                  <td>
                    {p.git_branch ?? '—'}
                    {p.git_dirty ? <span className="dot" title="Uncommitted changes" /> : null}
                  </td>
                  <td>{p.agent_version ?? '—'}</td>
                  <td>{when(p.captured_at)}</td>
                  <td className="actions">
                    <button className="link-btn plain" onClick={() => rename(p.name)}>
                      Rename
                    </button>
                    <button className="link-btn plain" onClick={() => move(p.name)}>
                      Move
                    </button>
                    <button className="link-btn" onClick={() => remove(p.name, p.snapshots)}>
                      Delete
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

function KeysAdmin({ id, keys, act }: { id: string; keys: ApiKeyRow[]; act: Act }) {
  const [token, setToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const mint = async () => {
    const label = prompt('Label for the new key:', 'admin')?.trim();
    if (label === undefined) return;
    try {
      setToken((await admin.mintKey(id, label || 'admin')).token);
      await act(async () => undefined);
    } catch (e) {
      setError(message(e));
    }
  };
  const rename = (k: ApiKeyRow) => {
    const label = prompt('New label:', k.label ?? '')?.trim();
    if (label) act(() => admin.updateKey(k.id, { label }));
  };

  return (
    <div className="card">
      <h2>Agent keys</h2>
      <p className="sub">Every key this account has minted, revoked ones included.</p>
      {error && <p className="signin-error">{error}</p>}
      {token && (
        <div className="notice">
          New key, shown once: <code className="mono">{token}</code>{' '}
          <button className="chip" onClick={() => navigator.clipboard?.writeText(token)}>
            Copy
          </button>
        </div>
      )}
      {keys.length === 0 ? (
        <div className="empty">No keys.</div>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Key</th>
                <th>Created</th>
                <th>Last used</th>
                <th>Status</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id} className={k.revoked_at ? 'dim' : undefined}>
                  <td>
                    {k.label ?? '—'}
                    <div className="muted small mono">{k.id.slice(0, 12)}…</div>
                  </td>
                  <td>{clock(k.created_at)}</td>
                  <td>{k.last_used ? clock(k.last_used) : 'never'}</td>
                  <td>{k.revoked_at ? `Revoked ${clock(k.revoked_at)}` : 'Active'}</td>
                  <td className="actions">
                    <button className="link-btn plain" onClick={() => rename(k)}>
                      Rename
                    </button>
                    {k.revoked_at ? (
                      <button className="link-btn plain" onClick={() => act(() => admin.updateKey(k.id, { revoked: false }))}>
                        Restore
                      </button>
                    ) : (
                      <button
                        className="link-btn"
                        onClick={() =>
                          confirm(`Revoke "${k.label ?? 'key'}"? Its agent stops sending.`) &&
                          act(() => admin.updateKey(k.id, { revoked: true }))
                        }
                      >
                        Revoke
                      </button>
                    )}
                    <button
                      className="link-btn"
                      onClick={() =>
                        confirm(`Delete "${k.label ?? 'key'}" for good?`) && act(() => admin.deleteKey(k.id))
                      }
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <button className="btn-secondary inline" onClick={mint}>
        Mint a key for them
      </button>
    </div>
  );
}

const PAGE = 100;

/** Everything their agents sent, newest first, a page at a time. */
function SnapshotLog({ id, projects, rev, act }: { id: string; projects: string[]; rev: number; act: Act }) {
  const [project, setProject] = useState('');
  const [rows, setRows] = useState<AdminSnapshotRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setRows(null);
    admin
      .snapshots(id, { project: project || undefined, limit: PAGE })
      .then((r) => {
        if (!live) return;
        setRows(r.snapshots);
        setMore(r.more);
      })
      .catch((e) => live && setError(message(e)));
    return () => {
      live = false;
    };
  }, [id, project, rev]);

  const loadMore = () => {
    const last = rows?.[rows.length - 1];
    if (!last) return;
    admin
      .snapshots(id, { project: project || undefined, before: last.id, limit: PAGE })
      .then((r) => {
        setRows((prev) => [...(prev ?? []), ...r.snapshots]);
        setMore(r.more);
      })
      .catch((e) => setError(message(e)));
  };

  const signed = (n: number | null) => (n === null ? '—' : n > 0 ? `+${num(n)}` : num(n));

  return (
    <div className="card">
      <h2>Snapshot log</h2>
      <p className="sub">Every snapshot their agents sent, newest first. Unchanged ticks are greyed out.</p>
      <div className="filters">
        <label className="filter">
          <span>Project</span>
          <select value={project} onChange={(e) => setProject(e.target.value)}>
            <option value="">All projects</option>
            {projects.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error && <p className="signin-error">{error}</p>}
      {rows === null ? (
        <div className="empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty">No snapshots.</div>
      ) : (
        <div className="scroll-x">
          <table>
            <thead>
              <tr>
                <th>Captured</th>
                <th>Received</th>
                <th>Project</th>
                <th>Files</th>
                <th>Lines</th>
                <th>Δ lines</th>
                <th>+ / − / ~ files</th>
                <th>Branch</th>
                <th>Head</th>
                <th>Tree</th>
                <th>Agent</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr key={s.id} className={s.unchanged ? 'dim' : undefined}>
                  <td>{clock(s.captured_at)}</td>
                  <td title={`${s.received_at - s.captured_at}s after capture`}>{clock(s.received_at)}</td>
                  <td>{s.project}</td>
                  <td>{num(s.file_count)}</td>
                  <td>{num(s.total_lines)}</td>
                  <td>{signed(s.lines_delta)}</td>
                  <td>
                    {s.files_added ?? 0} / {s.files_removed ?? 0} / {s.files_modified ?? 0}
                  </td>
                  <td>
                    {s.git_branch || '—'}
                    {s.git_dirty ? <span className="dot" title="Uncommitted changes" /> : null}
                  </td>
                  <td className="hash">{shortSha(s.git_head)}</td>
                  <td className="hash" title={s.tree_hash}>
                    {s.tree_hash.slice(0, 8)}
                  </td>
                  <td>{s.agent_version || '—'}</td>
                  <td>
                    <button
                      className="link-btn"
                      onClick={() => confirm('Delete this snapshot?') && act(() => admin.deleteSnapshot(s.id))}
                    >
                      Delete
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {more && (
        <button className="btn-secondary inline ghost" onClick={loadMore}>
          Load {PAGE} more
        </button>
      )}
    </div>
  );
}

function DangerZone({ id, data, act }: { id: string; data: AdminUser; act: Act }) {
  const disabled = !!data.account?.disabled_at;

  const toggle = () => {
    if (!data.account?.email && !disabled) {
      alert('Give this account an email first (Profile → Create account row).');
      return;
    }
    const msg = disabled
      ? 'Re-enable this account? They can sign in and their agents can send again.'
      : 'Disable this account? They are signed out, cannot sign back in, and their agents stop sending. Nothing is deleted.';
    if (confirm(msg)) act(() => admin.updateUser(id, { disabled: !disabled }));
  };

  const remove = async () => {
    const typed = prompt(
      `This deletes the account and ALL its projects, snapshots, file lists and keys. It cannot be undone.\n\n` +
        `They can still sign in again into a fresh, empty account; disable instead to keep them out.\n\n` +
        `Type the account id to confirm:\n${id}`,
    );
    if (typed?.trim() !== id) return;
    try {
      await admin.deleteUser(id);
      location.hash = href('admin');
    } catch (e) {
      alert(message(e) ?? 'Could not delete');
    }
  };

  return (
    <div className="card danger">
      <h2>Danger zone</h2>
      <div className="btn-row">
        <button className="btn-secondary inline ghost" onClick={toggle}>
          {disabled ? 'Re-enable account' : 'Disable account'}
        </button>
        <button className="btn-secondary inline bad" onClick={remove}>
          Delete account and all data
        </button>
      </div>
    </div>
  );
}
