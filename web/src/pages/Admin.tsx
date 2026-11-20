import { useEffect, useMemo, useState } from 'react';
import {
  SignedOutError,
  access,
  admin,
  bytes,
  clock,
  newestVersion,
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
import { PageHead, Pills } from '../ui';

const message = (e: unknown) => (e instanceof SignedOutError ? null : e instanceof Error ? e.message : String(e));

const when = (t: number | null | undefined) => (t ? clock(t) : '—');

/** What to call an account in a list: name, else email, else its raw id. */
const labelOf = (u: { id: string; name: string | null; email: string | null }) => u.name ?? u.email ?? u.id;

const initial = (s: string) => s.trim().charAt(0).toUpperCase() || '?';

/** A row of headline numbers in one card, split by hairlines. */
function StatRow({ cells }: { cells: { label: string; value: string; sub?: string }[] }) {
  return (
    <div className="statrow">
      {cells.map((c) => (
        <div key={c.label}>
          <div className="label">{c.label}</div>
          <div className="value" title={c.value}>
            {c.value}
          </div>
          {c.sub && <div className="sub">{c.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** A "⋯" button opening a short list of actions. Closes after one is picked. */
function Menu({ label, items }: { label: string; items: { text: string; danger?: boolean; run: () => void }[] }) {
  return (
    <details className="menu">
      <summary aria-label={label} title={label}>
        ⋯
      </summary>
      <div className="menu-list" role="menu">
        {items.map((i) => (
          <button
            key={i.text}
            role="menuitem"
            className={i.danger ? 'danger' : undefined}
            onClick={(e) => {
              (e.currentTarget.closest('details') as HTMLDetailsElement).open = false;
              i.run();
            }}
          >
            {i.text}
          </button>
        ))}
      </div>
    </details>
  );
}

function Switch({ checked, onChange, children }: { checked: boolean; onChange: (v: boolean) => void; children: React.ReactNode }) {
  return (
    <label className="switch">
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span aria-hidden />
      {children}
    </label>
  );
}

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

/** Gives an id that only has data (no account row) an email, so someone can sign in to it. */
async function createRow(id: string): Promise<boolean> {
  const email = prompt(`Email for "${id}"? Whoever signs in with it gets this account's data.`)?.trim();
  if (!email) return false;
  await admin.updateUser(id, { email });
  return true;
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
  // Data recorded under an id nobody can sign in as.
  const orphans = users?.filter((u) => !u.email && (u.projects > 0 || u.active_keys > 0)) ?? [];

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!users || !needle) return users;
    return users.filter((u) => [u.id, u.email, u.name].some((v) => v?.toLowerCase().includes(needle)));
  }, [users, q]);

  const makeRow = async (id: string) => {
    try {
      if (await createRow(id)) load();
    } catch (e) {
      setError(message(e));
    }
  };

  return (
    <>
      <PageHead eyebrow="Admin" title="Everyone on flockatime">
        <p className="lede">Every account, what it has sent, and the controls to change any of it.</p>
      </PageHead>

      {viewAs && (
        <div className="banner">
          <span>
            You are still viewing the dashboard as <strong>{labelOf(viewAs)}</strong>.
          </span>
          <button className="btn-secondary" style={{ marginTop: 0 }} onClick={() => onViewAs(null, 'admin')}>
            Stop
          </button>
        </div>
      )}
      {error && <p className="signin-error">{error}</p>}

      {overview && (
        <StatRow
          cells={[
            { label: 'Accounts', value: num(overview.accounts), sub: overview.disabled ? `${overview.disabled} disabled` : undefined },
            { label: 'Active today', value: num(overview.active_24h), sub: 'sent a snapshot in 24h' },
            { label: 'Projects', value: num(overview.projects) },
            { label: 'Snapshots', value: num(overview.snapshots), sub: `${num(overview.snapshots_24h)} in 24h` },
            { label: 'Active keys', value: num(overview.active_keys) },
            { label: 'Stored file lists', value: bytes(overview.stored_bytes), sub: `${num(overview.trees)} trees` },
          ]}
        />
      )}

      {orphans.map((u) => (
        <div className="banner" key={u.id}>
          <strong>
            {overview && overview.accounts === 0 ? '0 accounts, but ' : ''}
            {num(u.projects)} project{u.projects === 1 ? '' : 's'} and {num(u.active_keys)} key
            {u.active_keys === 1 ? '' : 's'}
          </strong>
          <span>
            belong to “{u.id}”, which has no account row. Make it an account so someone can sign in to it.
          </span>
          <button className="btn-lime" onClick={() => makeRow(u.id)}>
            Create account for {u.id}
          </button>
        </div>
      ))}

      {waiting > 0 && (
        <div className="banner">
          <span>
            {waiting} {waiting === 1 ? 'person has' : 'people have'} signed in without being on the list. They are
            marked <strong>Wants access</strong> below.
          </span>
        </div>
      )}

      <div className="card flush">
        <div className="flush-head">
          <div>
            <h2>Accounts</h2>
            <p>Open one to see everything it has sent, or view the dashboard as them.</p>
          </div>
          <input
            className="search"
            type="search"
            placeholder="Search name, email or id"
            aria-label="Search accounts"
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
            <table className="atable">
              <thead>
                <tr>
                  <th>Account</th>
                  <th>Projects</th>
                  <th>Snapshots</th>
                  <th>Keys</th>
                  <th>Last snapshot</th>
                  <th>Last sign-in</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="who">
                        <span className="avatar sm" aria-hidden>
                          {initial(labelOf(u))}
                        </span>
                        <div>
                          <a className="who-name" href={href('admin', u.id)}>
                            {labelOf(u)}
                          </a>
                          {!u.email && <span className="pill warn">no account row</span>}
                          {u.role === 'admin' && <span className="pill admin">Admin</span>}
                          {u.disabled_at ? <span className="pill bad">Disabled</span> : null}
                          {u.email && !u.role && !u.last_login && <span className="pill muted-pill">No access</span>}
                          {u.email && !u.role && u.last_login ? (
                            <>
                              <span className="pill warn" title="Signed in but is not on the list">
                                Wants access
                              </span>
                              <button
                                className="link-btn plain let-in"
                                onClick={() => access.set(u.email!, 'user').then(load, (err) => setError(message(err)))}
                              >
                                Let in
                              </button>
                            </>
                          ) : null}
                          {u.name && u.email && <div className="who-sub">{u.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td>{num(u.projects)}</td>
                    <td>{num(u.snapshots)}</td>
                    <td>{num(u.active_keys)}</td>
                    <td>{when(u.last_received)}</td>
                    <td className="muted">{u.last_login ? clock(u.last_login) : 'never'}</td>
                    <td>
                      <div className="row-actions">
                        <a className="btn-secondary sm" href={href('admin', u.id)}>
                          Inspect
                        </a>
                        <button
                          className="btn-secondary sm"
                          onClick={() => onViewAs({ id: u.id, name: u.name, email: u.email })}
                        >
                          View as
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="admin-grid">
        <AccessCard onChange={load} />
        <NewAccount onCreated={load} />
      </div>
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
  const kind = (e: string) => (e.startsWith('@') ? 'Everyone at this domain' : 'One person');

  return (
    <div className="card">
      <h2>Who can sign in</h2>
      <p className="sub">
        Add an email for one person, or <strong>@domain</strong> for everyone at that exact domain. Removing someone
        locks them and their agents out on the next request.
      </p>

      <form className="access-form" onSubmit={add}>
        <input
          className="field"
          required
          placeholder="name@example.com or @example.com"
          aria-label="Email or @domain"
          value={entry}
          onChange={(e) => setEntry(e.target.value)}
        />
        <div className="seg">
          <Pills
            label="Role"
            value={entry.startsWith('@') ? 'user' : role}
            options={[
              { value: 'user', label: 'Can sign in' },
              ...(entry.startsWith('@') ? [] : [{ value: 'admin' as Role, label: 'Admin' }]),
            ]}
            onChange={setRole}
          />
        </div>
        <button className="btn-lime">Add</button>
      </form>
      {error && <p className="signin-error">{error}</p>}

      {data && (
        <ul className="access-list">
          {data.entries.map((a) => (
            <li key={a.entry}>
              <div>
                <b>{a.entry}</b>
                <div className="who-sub">
                  {kind(a.entry)} · added {clock(a.created_at)}
                  {a.added_by ? ` by ${a.added_by}` : ''}
                </div>
              </div>
              {a.entry.startsWith('@') ? (
                <span className="pill muted-pill">Can sign in</span>
              ) : (
                <select
                  aria-label={`Role for ${a.entry}`}
                  value={a.role}
                  onChange={(e) => run(() => access.set(a.entry, e.target.value as Role))}
                >
                  <option value="user">Can sign in</option>
                  <option value="admin">Admin</option>
                </select>
              )}
              <button
                className="link-btn"
                onClick={() =>
                  confirm(`Remove ${a.entry}? Anyone it lets in is signed out and their agents stop.`) &&
                  run(() => access.remove(a.entry))
                }
              >
                Remove
              </button>
            </li>
          ))}
          {fixed.map((a) => (
            <li key={`cfg:${a.entry}`}>
              <div>
                <b>{a.entry}</b>
                <div className="who-sub">{kind(a.entry)} · set in wrangler.jsonc</div>
              </div>
              {a.role === 'admin' ? <span className="pill admin">Admin</span> : <span className="pill muted-pill">Can sign in</span>}
              <span className="fixed" title="Set in wrangler.jsonc; change it there and redeploy">
                🔒 fixed
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="foot-note">Only one email can be admin. Entries from wrangler.jsonc can only be changed there.</p>
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
    <div className="access-strip">
      <div>
        <span className="kicker">Sign-in access</span>{' '}
        <span className={`pill ${state.role === 'admin' ? 'admin' : state.role ? 'ok' : 'bad'}`}>{label}</span>
        {why && <div className="who-sub">{why}</div>}
      </div>
      <div className="row-actions">
        {!state.role && (
          <button className="btn-secondary sm" onClick={() => run(() => access.set(email, 'user'))}>
            Let them sign in
          </button>
        )}
        {state.role !== 'admin' && (
          <button className="btn-secondary sm" onClick={() => run(() => access.set(email, 'admin'))}>
            Make admin
          </button>
        )}
        {state.role === 'admin' && state.entry?.role === 'admin' && (
          <button className="btn-secondary sm" onClick={() => run(() => access.set(email, 'user'))}>
            Remove admin
          </button>
        )}
        {state.entry && (
          <button
            className="btn-secondary sm"
            onClick={() => confirm(`Remove ${email} from the sign-in list?`) && run(() => access.remove(email))}
          >
            Remove from list
          </button>
        )}
      </div>
      {error && <p className="signin-error">{error}</p>}
    </div>
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
      <p className="sub">Set up keys or move projects to someone before their first sign-in.</p>
      <form className="stack-form" onSubmit={submit}>
        <input className="field" type="email" required placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field" placeholder="Name (optional)" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <input
            className="field"
            placeholder="Hack Club Auth id (optional)"
            aria-label="Hack Club Auth id"
            value={id}
            onChange={(e) => setId(e.target.value)}
          />
          <p className="hint">Without it, they get a made-up id nobody can sign in as.</p>
        </div>
        <div className="form-end">
          <Switch checked={allow} onChange={setAllow}>
            Let them sign in
          </Switch>
          <button className="btn-lime" disabled={busy}>
            {busy ? 'Adding…' : 'Add account'}
          </button>
        </div>
      </form>
      {error && <p className="signin-error">{error}</p>}
    </div>
  );
}

/* ---------- one account ---------- */

function AdminAccount({ id, onViewAs }: { id: string; onViewAs: ViewAsFn }) {
  const [data, setData] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
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
    setEditing(false);
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
  const title = a ? labelOf({ id, name: a.name, email: a.email }) : id;
  const liveKeys = data.keys.filter((k) => !k.revoked_at);
  const latest = data.projects.reduce<(typeof data.projects)[number] | null>(
    (m, p) => ((p.received_at ?? 0) > (m?.received_at ?? 0) ? p : m),
    null,
  );
  const lastAt = t?.last_received ? new Date(t.last_received * 1000) : null;

  return (
    <>
      <a className="back" href={href('admin')}>
        ← All accounts
      </a>

      <header className="acct-head">
        <span className="avatar lg" aria-hidden>
          {initial(title)}
        </span>
        <div className="acct-text">
          <h1>
            {title}
            {!a && <span className="pill warn">no account row</span>}
            {a?.disabled_at ? <span className="pill bad">Disabled {clock(a.disabled_at)}</span> : null}
          </h1>
          <p className="lede">
            {a ? (a.name ? `${a.email} · ` : '') : 'Data recorded under this id with no sign-in attached. '}
            {t?.first_seen ? `First snapshot ${clock(t.first_seen)}` : 'No snapshots yet'}
            {' · '}
            {a?.last_login ? `last signed in ${clock(a.last_login)}` : 'never signed in'}.
          </p>
        </div>
        <div className="row-actions">
          <button className="btn-secondary" style={{ marginTop: 0 }} onClick={() => setEditing(!editing)}>
            {a ? 'Edit profile' : 'Create account row'}
          </button>
          <button className="btn-lime" onClick={() => onViewAs(viewAs)}>
            View dashboard as them
          </button>
        </div>
      </header>

      {error && <p className="signin-error">{error}</p>}
      {editing && <ProfileForm id={id} data={data} act={act} done={() => setEditing(false)} />}
      {a?.email && <AccountAccess email={a.email} onChange={() => act(async () => undefined)} />}

      <StatRow
        cells={[
          { label: 'Projects', value: num(data.projects.length) },
          { label: 'Snapshots', value: num(t?.snapshots), sub: `${num(t?.snapshots_7d)} in 7 days` },
          { label: 'Lines added', value: num(t?.lines_added), sub: `${num(t?.lines_removed)} removed` },
          {
            label: 'Active keys',
            value: num(liveKeys.length),
            sub: (() => {
              const unused = liveKeys.filter((k) => !k.last_used).length;
              return unused ? `${unused} never used` : undefined;
            })(),
          },
          {
            label: 'Last snapshot',
            value: lastAt ? lastAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : '—',
            sub: lastAt
              ? `${lastAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}${latest ? ` · ${latest.name}` : ''}`
              : undefined,
          },
          { label: 'Stored', value: bytes(t?.stored_bytes), sub: `${num(t?.trees)} trees` },
        ]}
      />

      <div className="admin-grid wide-left">
        <ProjectsCard id={id} data={data} act={act} onViewAs={(p) => onViewAs(viewAs, 'projects', p)} />
        <KeysAdmin id={id} keys={data.keys} act={act} />
      </div>
      <SnapshotLog id={id} data={data} rev={rev} act={act} />
      <DangerZone id={id} data={data} act={act} />
    </>
  );
}

type Act = (fn: () => Promise<unknown>) => Promise<void>;

function ProfileForm({ id, data, act, done }: { id: string; data: AdminUser; act: Act; done: () => void }) {
  const a = data.account;
  const [email, setEmail] = useState(a?.email ?? '');
  const [name, setName] = useState(a?.name ?? '');

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    await act(() => admin.updateUser(id, { email, name }));
    done();
  };

  return (
    <div className="card">
      <h2>{a ? 'Edit profile' : 'Create account row'}</h2>
      <p className="sub">
        Account id <span className="mono">{id}</span>
        {a ? ` · created ${when(a.created_at)}` : '. Whoever signs in with this email gets this data.'}
      </p>
      <form className="form-row" onSubmit={save}>
        <input className="field" type="email" required placeholder="Email" aria-label="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
        <input className="field" placeholder="Name" aria-label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <button className="btn-lime">Save</button>
        <button type="button" className="btn-secondary" style={{ marginTop: 0 }} onClick={done}>
          Cancel
        </button>
      </form>
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
  const newest = newestVersion(data.projects.map((p) => p.agent_version));

  return (
    <div className="card">
      <div className="card-head">
        <h2>Projects</h2>
        <span className="muted small">Open one to see its charts as they do. ⋯ to rename, move or delete.</span>
      </div>
      {data.projects.length === 0 ? (
        <div className="empty">No projects.</div>
      ) : (
        <div className="scroll-x">
          <table className="compact">
            <thead>
              <tr>
                <th>Project</th>
                <th>Snapshots</th>
                <th>Lines</th>
                <th>Files</th>
                <th className="left">Branch</th>
                <th className="left">Agent</th>
                <th>Last snapshot</th>
                <th>
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {data.projects.map((p) => (
                <tr key={p.name}>
                  <td>
                    <button className="link-btn plain strong" onClick={() => onViewAs(p.name)}>
                      {p.name}
                    </button>
                  </td>
                  <td className="strong">{num(p.snapshots)}</td>
                  <td>{num(p.total_lines)}</td>
                  <td className="muted">{num(p.file_count)}</td>
                  <td className="left">
                    {p.git_branch ?? '—'}
                    {p.git_dirty ? <span className="dot" title="Uncommitted changes" /> : null}
                  </td>
                  <td className="left">
                    {newest && p.agent_version && p.agent_version !== newest ? (
                      <span className="pill warn" style={{ marginLeft: 0 }}>
                        {p.agent_version}
                      </span>
                    ) : (
                      p.agent_version ?? '—'
                    )}
                  </td>
                  <td className="muted small">{when(p.captured_at)}</td>
                  <td>
                    <Menu
                      label={`Actions for ${p.name}`}
                      items={[
                        { text: 'Rename', run: () => rename(p.name) },
                        { text: 'Move to another account', run: () => move(p.name) },
                        { text: 'Delete', danger: true, run: () => remove(p.name, p.snapshots) },
                      ]}
                    />
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
      <div className="card-head">
        <h2>Agent keys</h2>
        <span className="meta">
          <button className="btn-lime sm" onClick={mint}>
            Mint a key
          </button>
        </span>
      </div>
      <p className="sub">Every key this account has minted, revoked ones included.</p>
      {error && <p className="signin-error">{error}</p>}
      {token && (
        <div className="well" style={{ marginTop: 0, marginBottom: 12 }}>
          <span>New key, shown once:</span>
          <code className="mono">{token}</code>
          <button className="chip" onClick={() => navigator.clipboard?.writeText(token)}>
            Copy
          </button>
        </div>
      )}
      {keys.length === 0 ? (
        <div className="empty">No keys.</div>
      ) : (
        <ul className="key-list">
          {keys.map((k) => (
            <li key={k.id} className={k.revoked_at ? 'revoked' : undefined}>
              <div className="key-main">
                <div>
                  <b>{k.label ?? 'Unnamed'}</b>
                  {k.revoked_at ? (
                    <span className="pill bad">revoked</span>
                  ) : k.last_used ? (
                    <span className="pill ok">active</span>
                  ) : (
                    <span className="pill muted-pill">never used</span>
                  )}
                </div>
                <div className="who-sub">
                  <span className="mono">{k.id.slice(0, 12)}…</span> · made {clock(k.created_at)}
                </div>
              </div>
              <div className="key-used">
                <span>{k.revoked_at ? 'revoked' : 'used'}</span>
                {k.revoked_at ? clock(k.revoked_at) : k.last_used ? clock(k.last_used) : 'never'}
              </div>
              <Menu
                label={`Actions for ${k.label ?? 'key'}`}
                items={[
                  { text: 'Rename', run: () => rename(k) },
                  k.revoked_at
                    ? { text: 'Restore', run: () => act(() => admin.updateKey(k.id, { revoked: false })) }
                    : {
                        text: 'Revoke',
                        danger: true,
                        run: () =>
                          confirm(`Revoke "${k.label ?? 'key'}"? Its agent stops sending.`) &&
                          act(() => admin.updateKey(k.id, { revoked: true })),
                      },
                  {
                    text: 'Delete',
                    danger: true,
                    run: () => confirm(`Delete "${k.label ?? 'key'}" for good?`) && act(() => admin.deleteKey(k.id)),
                  },
                ]}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const PAGE = 100;
const PROJECT_PILLS = 4;
/** Past this, a snapshot sat in the offline queue; worth showing its received time. */
const LAG_SECONDS = 120;

type LogItem = { kind: 'row'; s: AdminSnapshotRow } | { kind: 'fold'; key: string; rows: AdminSnapshotRow[] };

/** Everything their agents sent, newest first, a page at a time. */
function SnapshotLog({ id, data, rev, act }: { id: string; data: AdminUser; rev: number; act: Act }) {
  const [project, setProject] = useState('');
  const [rows, setRows] = useState<AdminSnapshotRow[] | null>(null);
  const [more, setMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hideUnchanged, setHideUnchanged] = useState(true);
  const [allPills, setAllPills] = useState(false);
  const [open, setOpen] = useState<Set<string>>(new Set());

  useEffect(() => {
    let live = true;
    setRows(null);
    setOpen(new Set());
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

  // Runs of unchanged ticks fold into one line each.
  const items = useMemo<LogItem[]>(() => {
    if (!rows) return [];
    if (!hideUnchanged) return rows.map((s) => ({ kind: 'row', s }));
    const out: LogItem[] = [];
    for (const s of rows) {
      const prev = out[out.length - 1];
      if (s.unchanged && prev?.kind === 'fold' && prev.rows[0].project === s.project) prev.rows.push(s);
      else if (s.unchanged) out.push({ kind: 'fold', key: `f${s.id}`, rows: [s] });
      else out.push({ kind: 'row', s });
    }
    return out;
  }, [rows, hideUnchanged]);

  const lagged = rows?.some((s) => s.received_at - s.captured_at > LAG_SECONDS) ?? false;
  const newest = newestVersion(data.projects.map((p) => p.agent_version));
  const names = data.projects.map((p) => p.name);
  const pills = allPills ? names : names.slice(0, PROJECT_PILLS);
  const total = project ? data.projects.find((p) => p.name === project)?.snapshots ?? 0 : data.totals?.snapshots ?? 0;
  const cols = lagged ? 13 : 12;

  const signedCell = (n: number | null) =>
    n === null ? <span className="muted">—</span> : n > 0 ? <span className="add">+{num(n)}</span> : n < 0 ? <span className="rem-red">{num(n)}</span> : <span>0</span>;

  const range = (rs: AdminSnapshotRow[]) => {
    const [a, b] = [rs[rs.length - 1].captured_at, rs[0].captured_at];
    const day = (t: number) => new Date(t * 1000).toDateString();
    const time = (t: number) => new Date(t * 1000).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const date = (t: number) => new Date(t * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
    if (day(a) === day(b)) return time(a) === time(b) ? time(a) : `${time(a)}–${time(b)}`;
    // "Nov 14–17" within a month, "Oct 30–Nov 2" across one.
    const sameMonth = new Date(a * 1000).getMonth() === new Date(b * 1000).getMonth();
    return `${date(a)}–${sameMonth ? new Date(b * 1000).getDate() : date(b)}`;
  };

  const row = (s: AdminSnapshotRow) => (
    <tr key={s.id} className={s.unchanged ? 'dim' : undefined}>
      <td>
        {clock(s.captured_at)}
        {s.chain && s.chain !== 'ok' && s.chain !== 'start' ? <span className="pill warn">{s.chain}</span> : null}
      </td>
      {lagged && (
        <td className="muted" title={`${s.received_at - s.captured_at}s after capture`}>
          {clock(s.received_at)}
        </td>
      )}
      <td className="left strong">{s.project}</td>
      <td>{num(s.file_count)}</td>
      <td>{num(s.total_lines)}</td>
      <td>{signedCell(s.lines_delta)}</td>
      <td className="muted">{s.lines_added === null ? '—' : `+${num(s.lines_added)} / −${num(s.lines_removed)}`}</td>
      <td>
        {s.files_added ?? 0} / {s.files_removed ?? 0} / {s.files_modified ?? 0}
      </td>
      <td className="left">
        {s.git_branch || '—'}
        {s.git_dirty ? <span className="dot" title="Uncommitted changes" /> : null}
      </td>
      <td className="hash left">{shortSha(s.git_head)}</td>
      <td className="hash left" title={s.tree_hash}>
        {s.tree_hash.slice(0, 8)}
      </td>
      <td title={s.os ? `${s.os}/${s.arch}${s.capture_ms !== null ? `, ${s.capture_ms} ms capture` : ''}` : undefined}>
        {newest && s.agent_version && s.agent_version !== newest ? (
          <span className="pill warn">{s.agent_version}</span>
        ) : (
          s.agent_version || '—'
        )}
      </td>
      <td>
        <button
          className="x-btn"
          aria-label="Delete this snapshot"
          title="Delete this snapshot"
          onClick={() => confirm('Delete this snapshot?') && act(() => admin.deleteSnapshot(s.id))}
        >
          ✕
        </button>
      </td>
    </tr>
  );

  return (
    <div className="card">
      <div className="card-head">
        <h2>Snapshot log</h2>
        <span className="muted small">Newest first. Unchanged ticks are folded together.</span>
        <div className="meta log-controls">
          <div className="pills" role="group" aria-label="Project">
            <button type="button" aria-pressed={project === ''} onClick={() => setProject('')}>
              All
            </button>
            {pills.map((p) => (
              <button key={p} type="button" aria-pressed={project === p} onClick={() => setProject(p)}>
                {p}
              </button>
            ))}
            {!allPills && names.length > PROJECT_PILLS && (
              <button type="button" aria-pressed={false} onClick={() => setAllPills(true)}>
                +{names.length - PROJECT_PILLS}
              </button>
            )}
          </div>
          <Switch checked={hideUnchanged} onChange={setHideUnchanged}>
            Hide unchanged
          </Switch>
        </div>
      </div>
      {error && <p className="signin-error">{error}</p>}
      {rows === null ? (
        <div className="empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="empty">No snapshots.</div>
      ) : (
        <div className="scroll-x">
          <table className="compact log">
            <thead>
              <tr>
                <th>Captured</th>
                {lagged && <th>Received</th>}
                <th className="left">Project</th>
                <th>Files</th>
                <th>Lines</th>
                <th>Δ lines</th>
                <th>+ / − lines</th>
                <th>+ / − / ~ files</th>
                <th className="left">Branch</th>
                <th className="left">Head</th>
                <th className="left">Tree</th>
                <th>Agent</th>
                <th>
                  <span className="sr-only">Delete</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((it) =>
                it.kind === 'row' ? (
                  row(it.s)
                ) : open.has(it.key) ? (
                  it.rows.map(row)
                ) : (
                  <tr key={it.key} className="fold">
                    <td colSpan={cols}>
                      <button
                        className="fold-btn"
                        onClick={() => setOpen((o) => new Set(o).add(it.key))}
                        aria-label={`Show ${it.rows.length} unchanged ticks`}
                      >
                        <span>
                          ▸ <b>{num(it.rows.length)} unchanged tick{it.rows.length === 1 ? '' : 's'}</b> ·{' '}
                          {it.rows[0].project} · {range(it.rows)}
                        </span>
                        <span className="muted">show</span>
                      </button>
                    </td>
                  </tr>
                ),
              )}
            </tbody>
          </table>
        </div>
      )}
      <div className="log-foot">
        {more && (
          <button className="btn-secondary" style={{ marginTop: 0 }} onClick={loadMore}>
            Load {PAGE} more
          </button>
        )}
        {rows && rows.length > 0 && (
          <span className="muted small">
            Showing {num(rows.length)} of {num(total)}
            {lagged ? '' : ' · received time matches captured time on all rows, so it’s hidden'}
          </span>
        )}
      </div>
    </div>
  );
}

function DangerZone({ id, data, act }: { id: string; data: AdminUser; act: Act }) {
  const disabled = !!data.account?.disabled_at;
  const keys = data.keys.filter((k) => !k.revoked_at).length;

  const toggle = () => {
    if (!data.account?.email && !disabled) {
      alert('Give this account an email first (Create account row).');
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
      <div>
        <h2>Danger zone</h2>
        <p className="sub" style={{ margin: 0 }}>
          Disabling blocks sign-in and all {num(keys)} key{keys === 1 ? '' : 's'}. Deleting removes{' '}
          {num(data.projects.length)} project{data.projects.length === 1 ? '' : 's'} and {num(data.totals?.snapshots)}{' '}
          snapshots for good.
        </p>
      </div>
      <div className="row-actions">
        <button className="btn-outline-bad" onClick={toggle}>
          {disabled ? 'Re-enable account' : 'Disable account'}
        </button>
        <button className="btn-bad" onClick={remove}>
          Delete account and all data
        </button>
      </div>
    </div>
  );
}
