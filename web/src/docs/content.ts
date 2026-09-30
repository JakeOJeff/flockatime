/// <reference types="vite/client" />
import { Marked, type Tokens } from 'marked';
import { iconSvg } from './icons';

/**
 * The docs are plain Markdown in ./pages, bundled as strings at build time, so
 * a page is edited as a .md file and never needs a fetch to show. This module
 * holds the sidebar order, turns a page into HTML and answers search.
 */
const RAW = import.meta.glob('./pages/*.md', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>;

export interface Section {
  title: string;
  icon: string;
  slugs: string[];
}

/** Sidebar order. A page not listed here is not reachable. */
export const SECTIONS: Section[] = [
  { title: 'Overview', icon: 'home', slugs: ['overview'] },
  { title: 'Getting started', icon: 'rocket', slugs: ['quick-start', 'how-it-works', 'privacy'] },
  {
    title: 'Snapshot CLI',
    icon: 'terminal',
    slugs: ['install-windows', 'install-macos', 'install-linux', 'cli-commands', 'cli-config', 'offline-queue'],
  },
  { title: 'Dashboard', icon: 'chart', slugs: ['dashboard-home', 'dashboard-projects', 'data-sources', 'keys', 'hackatime'] },
  { title: 'Self-hosting', icon: 'server', slugs: ['self-host', 'auth', 'env', 'local-dev'] },
  { title: 'API reference', icon: 'code', slugs: ['api-ingest', 'api-dashboard'] },
  { title: 'Troubleshooting', icon: 'lifebuoy', slugs: ['troubleshooting', 'limits'] },
];

export const HOME = 'overview';
export const REPO = 'https://github.com/JakeOJeff/flockatime';

export interface DocPage {
  slug: string;
  title: string;
  /** The first paragraph, as plain text: used by search and page cards. */
  description: string;
  section: Section;
  markdown: string;
  /** Plain text of the whole page, and its lower-cased twin for matching. */
  text: string;
  lower: string;
}

/** Markdown inline syntax stripped down to the words a reader sees. */
function plain(md: string): string {
  return md
    .replace(/```[a-z]*\n?/g, '')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[`*_>#|]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function slugify(text: string): string {
  return plain(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function toPage(slug: string, section: Section): DocPage {
  const markdown = RAW[`./pages/${slug}.md`];
  if (markdown === undefined) throw new Error(`docs: no pages/${slug}.md`);
  const title = /^# (.+)$/m.exec(markdown)?.[1] ?? slug;
  const afterTitle = markdown.split(/^# .+$/m)[1] ?? '';
  const firstPara = afterTitle.trim().split(/\n\s*\n/)[0] ?? '';
  const text = plain(markdown);
  return { slug, title: plain(title), description: plain(firstPara), section, markdown, text, lower: text.toLowerCase() };
}

export const PAGES: DocPage[] = SECTIONS.flatMap((s) => s.slugs.map((slug) => toPage(slug, s)));
export const pageBySlug = new Map(PAGES.map((p) => [p.slug, p]));

export const docHref = (slug: string, anchor?: string) => `#/docs/${slug}${anchor ? `#${anchor}` : ''}`;

export interface Heading {
  id: string;
  text: string;
  depth: number;
}

/** The h2 and h3 headings, in order: the "On this page" list. */
export function headings(page: DocPage): Heading[] {
  return new Marked()
    .lexer(page.markdown)
    .filter((t): t is Tokens.Heading => t.type === 'heading' && (t.depth === 2 || t.depth === 3))
    .map((t) => ({ id: slugify(t.text), text: plain(t.text), depth: t.depth }));
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** `icon | title | description | slug` rows, from a ```cards or ```platforms block. */
function rows(text: string) {
  return text
    .split('\n')
    .map((l) => l.split('|').map((c) => c.trim()))
    .filter((c) => c.length === 4)
    .map(([icon, title, description, slug]) => ({ icon, title, description, slug }));
}

function cards(text: string): string {
  const items = rows(text).map(
    (r, i) =>
      `<a class="doc-card" href="${docHref(r.slug)}" style="--c: var(--cat-${(i % 5) + 1})">` +
      `<span class="doc-card-icon">${iconSvg(r.icon)}</span>` +
      `<strong>${esc(r.title)}</strong><span>${esc(r.description)}</span></a>`,
  );
  return `<div class="doc-cards">${items.join('')}</div>`;
}

function platforms(text: string): string {
  const items = rows(text).map(
    (r) =>
      `<a class="doc-platform" href="${docHref(r.slug)}">` +
      `<span class="doc-platform-art">${iconSvg(r.icon, 'icon logo')}</span>` +
      `<span class="doc-platform-body"><strong>${esc(r.title)} ${iconSvg('arrow-right', 'icon arrow')}</strong>` +
      `<span>${esc(r.description)}</span></span></a>`,
  );
  return `<div class="doc-platforms">${items.join('')}</div>`;
}

/** Set per render: bare `#anchor` links resolve against the page being drawn. */
let renderingSlug = HOME;

const md = new Marked({
  gfm: true,
  renderer: {
    heading({ tokens, depth, text }) {
      const id = slugify(text);
      const inner = this.parser.parseInline(tokens);
      if (depth === 1) return `<h1>${inner}</h1>`;
      const link = depth <= 3 ? `<a class="doc-anchor" href="${docHref(renderingSlug, id)}" aria-hidden="true">#</a>` : '';
      return `<h${depth} id="${id}">${inner}${link}</h${depth}>`;
    },
    link({ href, tokens }) {
      const inner = this.parser.parseInline(tokens);
      if (href.startsWith('#') && !href.startsWith('#/')) {
        return `<a href="${docHref(renderingSlug, href.slice(1))}">${inner}</a>`;
      }
      if (/^https?:/.test(href)) return `<a href="${esc(href)}" target="_blank" rel="noreferrer">${inner}</a>`;
      return `<a href="${esc(href)}">${inner}</a>`;
    },
    code({ text, lang }) {
      if (lang === 'cards') return cards(text);
      if (lang === 'platforms') return platforms(text);
      const label = lang && lang !== 'text' ? `<span>${esc(lang)}</span>` : '<span></span>';
      return (
        `<div class="doc-code"><div class="doc-code-bar">${label}` +
        `<button type="button" data-copy>${iconSvg('copy')}<span>Copy</span></button></div>` +
        `<pre><code>${esc(text)}</code></pre></div>`
      );
    },
    blockquote({ tokens }) {
      return `<div class="doc-callout">${this.parser.parse(tokens)}</div>`;
    },
  },
});

const cache = new Map<string, string>();

/** A page as HTML. The Markdown is ours, bundled at build time, so it is trusted. */
export function render(page: DocPage): string {
  let html = cache.get(page.slug);
  if (html === undefined) {
    renderingSlug = page.slug;
    html = (md.parse(page.markdown) as string)
      // Wide tables scroll inside their own box, never the page.
      .replace(/<table>/g, '<div class="scroll-x doc-table"><table>')
      .replace(/<\/table>/g, '</table></div>');
    cache.set(page.slug, html);
  }
  return html;
}

export interface Hit {
  page: DocPage;
  snippet: string;
}

/** Title matches first, then body matches, each with a line of context. */
export function search(query: string): Hit[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const hits: (Hit & { score: number })[] = [];
  for (const page of PAGES) {
    const inTitle = page.title.toLowerCase().includes(q);
    const at = page.lower.indexOf(q);
    if (!inTitle && at < 0) continue;
    const from = Math.max(0, at - 40);
    const snippet =
      at < 0
        ? page.description
        : (from > 0 ? '…' : '') + page.text.slice(from, at + q.length + 60).trim() + '…';
    hits.push({ page, snippet, score: inTitle ? 0 : 1 });
  }
  return hits.sort((a, b) => a.score - b.score).slice(0, 12);
}

export function neighbours(slug: string): { prev: DocPage | null; next: DocPage | null } {
  const i = PAGES.findIndex((p) => p.slug === slug);
  return { prev: PAGES[i - 1] ?? null, next: PAGES[i + 1] ?? null };
}
