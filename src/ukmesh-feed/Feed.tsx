import { useCallback, useState } from "react";
import { flushSync } from "react-dom";
import { FeedChannels } from "./FeedChannels";
import { useBeaconRevision } from "./privacy";

function ChannelsPanel({ recheck }: { recheck: () => void }) {
  const revision = useBeaconRevision();
  return <section className="ukmesh-feed-panel" aria-label="Public channels">
    {revision ? <FeedChannels key={revision} recheck={recheck} /> : (
      <div className="ukmesh-feed-empty" role="status">
        <p>{revision === null ? "Public channels are unavailable." : "Checking channel availability…"}</p>
        {revision === null && <button type="button" onClick={recheck}>Retry</button>}
      </div>
    )}
  </section>;
}

export function Feed() {
  const [retry, setRetry] = useState(0);
  const recheck = useCallback(() => flushSync(() => setRetry((attempt) => attempt + 1)), []);
  return <div className="ukmesh-feed">
    <a className="ukmesh-feed-skip" href="#channels">Skip to channels</a>
    <header className="ukmesh-feed-header">
      <a className="ukmesh-feed-brand" href="/">UKMesh</a>
      <nav aria-label="UKMesh">
        <a href="https://app.ukmesh.com/">Live Map</a><a href="/repeater">Repeaters</a><a href="/regions">Regions</a>
      </nav>
    </header>
    <main id="channels" className="ukmesh-feed-main">
      <h1>Feed</h1>
      <nav className="ukmesh-feed-views" aria-label="Feed views">
        <a href="/feed" aria-current="page">Channels</a>
        <a href="/feed/packets">Packets</a>
      </nav>
      <ChannelsPanel key={retry} recheck={recheck} />
    </main>
  </div>;
}
