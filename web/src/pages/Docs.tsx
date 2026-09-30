import { useEffect, useMemo, useRef, useState } from 'react';
import {
  HOME,
  REPO,
  SECTIONS,
  docHref,
  headings,
  neighbours,
  pageBySlug,
  render,
  search,
  type DocPage,
} from '../docs/content';
import { iconSvg } from '../docs/icons';
import '../docs/docs.css';

function Icon({ name, className }: { name: string; className?: string }) {
  return <span className="icon-wrap" dangerouslySetInnerHTML={{ __html: iconSvg(name, className) }} />;
}

/** `#/docs/<slug>#<anchor>` arrives here as "<slug>#<anchor>". */
export function Docs({ route }: { route: string | null }) {
  const [slug, anchor] = (route || HOME).split('#');
  const page = pageBySlug.get(slug) ?? null;

  return (
    <div className="docs">
      <DocsNav current={page} />
      {page ? <Article page={page} anchor={anchor} /> : <NotFound />}
    </div>
  );
}

function NotFound() {
  return (
    <article className="docs-main">
      <div className="doc-body">
        <h1>Page not found</h1>
        <p>
          There is no docs page at this address. Start from the <a href={docHref(HOME)}>overview</a>, or search from
          the sidebar.
        </p>
      </div>
    </article>
  );
}

/* ---------- left: search + section tree ---------- */

function DocsNav({ current }: { current: DocPage | null }) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(() => new Set(current ? [current.section.title] : []));
  const input = useRef<HTMLInputElement>(null);
  const hits = useMemo(() => search(query), [query]);

  // Moving to a page opens its section; sections opened by hand stay open.
  useEffect(() => {
    if (current) setOpen((o) => (o.has(current.section.title) ? o : new Set(o).add(current.section.title)));
    setQuery('');
  }, [current]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        input.current?.focus();
        input.current?.select();
      }
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const toggle = (title: string) =>
    setOpen((o) => {
      const n = new Set(o);
      if (n.has(title)) n.delete(title);
      else n.add(title);
      return n;
    });

  const isMac = /Mac|iPhone|iPad/.test(navigator.platform);

  return (
    <aside className="docs-nav" aria-label="Documentation">
      <label className="docs-search">
        <Icon name="search" />
        <input
          ref={input}
          type="search"
          placeholder="Search docs"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') setQuery('');
            if (e.key === 'Enter' && hits[0]) location.hash = docHref(hits[0].page.slug);
          }}
        />
        {!query && <kbd>{isMac ? '⌘ K' : 'Ctrl K'}</kbd>}
      </label>

      {/* Phones get a page picker in place of the tree. */}
      <select
        className="docs-picker"
        aria-label="Docs page"
        value={current?.slug ?? ''}
        onChange={(e) => (location.hash = docHref(e.target.value))}
      >
        {!current && <option value="">Choose a page</option>}
        {SECTIONS.map((s) => (
          <optgroup key={s.title} label={s.title}>
            {s.slugs.map((slug) => (
              <option key={slug} value={slug}>
                {pageBySlug.get(slug)!.title}
              </option>
            ))}
          </optgroup>
        ))}
      </select>

      {query ? (
        <ul className="docs-hits">
          {hits.length === 0 && <li className="muted">No pages match “{query}”.</li>}
          {hits.map((h) => (
            <li key={h.page.slug}>
              <a href={docHref(h.page.slug)}>
                <span className="docs-hit-title">{h.page.title}</span>
                <span className="docs-hit-section">{h.page.section.title}</span>
                <span className="docs-hit-snippet">{h.snippet}</span>
              </a>
            </li>
          ))}
        </ul>
      ) : (
        <ul className="docs-tree">
          {SECTIONS.map((s) => {
            // A one-page section is a plain link, like Overview.
            if (s.slugs.length === 1) {
              const only = s.slugs[0];
              return (
                <li key={s.title}>
                  <a
                    className="docs-section"
                    href={docHref(only)}
                    aria-current={current?.slug === only ? 'page' : undefined}
                  >
                    <Icon name={s.icon} />
                    <span>{s.title}</span>
                  </a>
                </li>
              );
            }
            const expanded = open.has(s.title);
            return (
              <li key={s.title}>
                <button
                  type="button"
                  className="docs-section"
                  aria-expanded={expanded}
                  data-active={current?.section === s ? '' : undefined}
                  onClick={() => toggle(s.title)}
                >
                  <Icon name={s.icon} />
                  <span>{s.title}</span>
                  <Icon name="chevron" className="icon chevron" />
                </button>
                {expanded && (
                  <ul className="docs-pages">
                    {s.slugs.map((slug) => (
                      <li key={slug}>
                        <a href={docHref(slug)} aria-current={current?.slug === slug ? 'page' : undefined}>
                          {pageBySlug.get(slug)!.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </aside>
  );
}

/* ---------- middle: the page; right: on this page ---------- */

const copyText = (text: string) =>
  navigator.clipboard.writeText(text).then(
    () => true,
    () => false,
  );

function Article({ page, anchor }: { page: DocPage; anchor?: string }) {
  const html = useMemo(() => render(page), [page]);
  const toc = useMemo(() => headings(page), [page]);
  const [active, setActive] = useState<string | null>(null);
  /** A heading the reader jumped to stays highlighted until they scroll by hand. */
  const pinned = useRef<string | null>(null);
  const [copiedPage, setCopiedPage] = useState(false);
  const { prev, next } = neighbours(page.slug);

  useEffect(() => {
    document.title = `${page.title} · flockatime docs`;
    return () => {
      document.title = 'flockatime';
    };
  }, [page]);

  // The shell scrolls to the top on every hash change; land on the anchor after that.
  useEffect(() => {
    pinned.current = anchor ?? null;
    if (anchor) document.getElementById(anchor)?.scrollIntoView();
  }, [page, anchor]);

  // Scroll spy: the active heading is the last one whose top has passed the fold.
  useEffect(() => {
    if (toc.length === 0) return;
    let frame = 0;
    const onScroll = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        if (pinned.current) return setActive(pinned.current);
        let id: string | null = toc[0].id;
        for (const h of toc) {
          const el = document.getElementById(h.id);
          if (el && el.getBoundingClientRect().top <= 120) id = h.id;
        }
        // At the very bottom the last heading may never reach the fold.
        if (innerHeight + scrollY >= document.documentElement.scrollHeight - 4) id = toc[toc.length - 1].id;
        setActive(id);
      });
    };
    const unpin = () => (pinned.current = null);
    onScroll();
    addEventListener('scroll', onScroll, { passive: true });
    for (const ev of ['wheel', 'touchstart', 'keydown'] as const) addEventListener(ev, unpin, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener('scroll', onScroll);
      for (const ev of ['wheel', 'touchstart', 'keydown'] as const) removeEventListener(ev, unpin);
    };
  }, [toc]);

  /** Same-page anchors scroll without a hash change, so a second click still scrolls. */
  const jump = (e: React.MouseEvent, id: string) => {
    const el = document.getElementById(id);
    if (!el) return;
    e.preventDefault();
    pinned.current = id;
    setActive(id);
    el.scrollIntoView({ behavior: 'smooth' });
    history.replaceState(null, '', docHref(page.slug, id));
  };

  const onBodyClick = (e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const copy = target.closest<HTMLButtonElement>('[data-copy]');
    if (copy) {
      const code = copy.closest('.doc-code')?.querySelector('code')?.textContent ?? '';
      copyText(code).then((ok) => {
        const label = copy.querySelector('span');
        if (!ok || !label) return;
        label.textContent = 'Copied';
        setTimeout(() => (label.textContent = 'Copy'), 1500);
      });
      return;
    }
    const link = target.closest<HTMLAnchorElement>('a[href]');
    const prefix = docHref(page.slug) + '#';
    if (link && link.getAttribute('href')!.startsWith(prefix)) {
      jump(e, link.getAttribute('href')!.slice(prefix.length));
    }
  };

  return (
    <>
      <article className="docs-main">
        <div className="eyebrow">{page.section.title}</div>
        <div className="doc-body" onClick={onBodyClick} dangerouslySetInnerHTML={{ __html: html }} />

        <Helpful page={page} key={page.slug} />

        <nav className="doc-pager" aria-label="Pagination">
          {prev ? (
            <a className="prev" href={docHref(prev.slug)}>
              <Icon name="arrow-left" />
              <span>
                <small>Previous</small>
                {prev.title}
              </span>
            </a>
          ) : (
            <span />
          )}
          {next && (
            <a className="next" href={docHref(next.slug)}>
              <span>
                <small>Next</small>
                {next.title}
              </span>
              <Icon name="arrow-right" />
            </a>
          )}
        </nav>
      </article>

      <aside className="docs-toc" aria-label="On this page">
        {toc.length > 0 && (
          <>
            <div className="docs-toc-title">On this page</div>
            <ul>
              {toc.map((h) => (
                <li key={h.id} className={h.depth === 3 ? 'sub' : undefined}>
                  <a
                    href={docHref(page.slug, h.id)}
                    aria-current={active === h.id ? 'location' : undefined}
                    onClick={(e) => jump(e, h.id)}
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </>
        )}
        <div className="docs-actions">
          <a href={`${REPO}/edit/main/web/src/docs/pages/${page.slug}.md`} target="_blank" rel="noreferrer">
            <Icon name="github" />
            Edit on GitHub
          </a>
          <button type="button" onClick={() => scrollTo({ top: 0, behavior: 'smooth' })}>
            <Icon name="arrow-up" />
            Scroll to top
          </button>
          <button
            type="button"
            onClick={() =>
              copyText(page.markdown).then((ok) => {
                if (!ok) return;
                setCopiedPage(true);
                setTimeout(() => setCopiedPage(false), 1500);
              })
            }
          >
            <Icon name={copiedPage ? 'check' : 'copy'} />
            {copiedPage ? 'Copied' : 'Copy as Markdown'}
          </button>
        </div>
      </aside>
    </>
  );
}

/**
 * There is no feedback store on the server, so "No" points at the issue
 * tracker with the page already named rather than pretending to record it.
 */
function Helpful({ page }: { page: DocPage }) {
  const [answer, setAnswer] = useState<'yes' | 'no' | null>(null);
  const issue = `${REPO}/issues/new?title=${encodeURIComponent(`Docs: ${page.title}`)}`;

  return (
    <div className="doc-helpful">
      {answer === null && (
        <>
          <span>Was this page helpful?</span>
          <div>
            <button type="button" onClick={() => setAnswer('yes')}>
              <Icon name="thumbs-up" />
              Yes
            </button>
            <button type="button" onClick={() => setAnswer('no')}>
              <Icon name="thumbs-down" />
              No
            </button>
          </div>
        </>
      )}
      {answer === 'yes' && <span>Thanks for letting us know.</span>}
      {answer === 'no' && (
        <span>
          Sorry about that.{' '}
          <a href={issue} target="_blank" rel="noreferrer">
            Open an issue
          </a>{' '}
          and say what was missing or wrong.
        </span>
      )}
    </div>
  );
}

