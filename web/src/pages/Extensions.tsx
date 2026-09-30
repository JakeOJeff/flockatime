import { InstallCard } from '../ConnectCli';
import { PageHead } from '../ui';

export function Extensions() {
  return (
    <>
      <PageHead eyebrow="Setup" title="Extensions">
        <p className="lede">What feeds this dashboard, and how to install it on the machine you code on.</p>
      </PageHead>

      <InstallCard />

      <div className="card">
        <h2>Hackatime</h2>
        <p className="sub">
          Editor time — languages, editors, operating systems — comes from Hackatime's editor plugins. The agent
          also reads their log to know which repo you are in, so set Hackatime up first.
        </p>
        <a className="btn-secondary inline" href="https://hackatime.hackclub.com" target="_blank" rel="noreferrer">
          Set up Hackatime ↗
        </a>
      </div>
    </>
  );
}
