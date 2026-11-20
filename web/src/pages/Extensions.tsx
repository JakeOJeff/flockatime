import { useEffect, useState } from 'react';
import type { Hackatime } from '../api';
import { PlatformPills, SetupSteps, UninstallCard, guessPlatform, type Platform } from '../ConnectCli';
import { PageHead } from '../ui';

/** `focus` is the section to scroll to: #/extensions/install or #/extensions/uninstall. */
export function Extensions({ focus, ht }: { focus?: string | null; ht: Hackatime | null }) {
  const [platform, setPlatform] = useState<Platform>(guessPlatform);

  useEffect(() => {
    if (focus) document.getElementById(focus)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }, [focus]);

  const installDoc = platform === 'windows' ? 'install-windows' : 'install-macos';

  return (
    <>
      <PageHead title="Set up snapshot-agent" aside={<PlatformPills platform={platform} setPlatform={setPlatform} />}>
        <p className="lede">Three steps, about two minutes. File contents and names never leave your machine.</p>
      </PageHead>

      <div className="setup">
        <div id="install">
          <SetupSteps ht={ht} platform={platform} />
          <UninstallCard id="uninstall" platform={platform} />
        </div>

        <aside>
          <div className="aside-card">
            <h2>Where your data comes from</h2>
            <div className="src cli">
              <b>snapshot-agent</b>
              <p>Lines, churn and saves. Time your files were changing.</p>
            </div>
            <div className="src ht">
              <b>Hackatime</b>
              <p>
                All editor time, languages and OS.{' '}
                <a href="https://hackatime.hackclub.com" target="_blank" rel="noreferrer">
                  Open ↗
                </a>
              </p>
            </div>
          </div>

          <div className="aside-card">
            <h2>Need help?</h2>
            <div className="links">
              <a href={`#/docs/${installDoc}#upgrade`}>Upgrading</a>
              <a href="#/docs/troubleshooting">Troubleshooting</a>
              <a href="#/extensions/uninstall">Uninstall snapshot-agent</a>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}
