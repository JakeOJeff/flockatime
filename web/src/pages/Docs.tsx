import { href } from '../App';
import { PageHead } from '../ui';

export function Docs() {
  return (
    <>
      <PageHead eyebrow="Docs" title="How flockatime works" />

      <div className="card prose">
        <h2>Two sources, one dashboard</h2>
        <p>
          <strong>Hackatime</strong> measures time in your editor: how long, in which language, editor and OS.
          That powers the Home page.
        </p>
        <p>
          <strong>snapshot-agent</strong> measures the project itself. Every couple of seconds it records the{' '}
          <em>shape</em> of the repo you are editing — how many files, how many lines, which commit is checked
          out — and sends it here when something changed. That powers each project page: total lines, churn,
          sessions, work per commit.
        </p>

        <h2>What leaves your machine</h2>
        <ul>
          <li>Line counts, file counts, and a hash of each path and each file's contents.</li>
          <li>The git branch, HEAD commit, dirty flag and how far ahead of upstream you are.</li>
          <li>
            Never file contents, and never file names — that is why "Most-revised files" shows hashes. Run{' '}
            <code>snapshot-agent once</code> locally to map one back.
          </li>
        </ul>

        <h2>Getting started</h2>
        <ol>
          <li>Set up Hackatime in your editor.</li>
          <li>
            Open <a href={href('extensions')}>Extensions</a>, generate the install command, and run it on the
            machine you code on.
          </li>
          <li>Start editing. Projects appear under <a href={href('projects')}>Projects</a> as you work.</li>
        </ol>

        <h2>Reading the numbers</h2>
        <ul>
          <li>
            <strong>Active time</strong> is how long the tree was actually moving — snapshots grouped into
            sessions, split on a 15-minute gap. It is usually lower than editor time.
          </li>
          <li>
            <strong>Replayed snapshots</strong>: if the agent was offline it queues snapshots and sends them
            later. Charts plot them when they were captured, not when they arrived.
          </li>
          <li>
            <strong>Keys</strong>: each install gets its own key. Revoke one in{' '}
            <a href={href('settings')}>Settings</a> to cut that machine off.
          </li>
        </ul>
      </div>
    </>
  );
}
