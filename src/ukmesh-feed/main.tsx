import { StrictMode, useCallback, useEffect, useState } from "react";
import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ready } from "../i18n";
import { ChannelList } from "../features/channels/ChannelList";
import { RegionProvider, useRegion } from "../hooks/useRegion";
import { parseSelection } from "../hooks/region-selection";
import { useWsStatus } from "../hooks/useWsStatus";
import { WsManager } from "../api/ws-manager";
import { queryRetryDefaults } from "../api/rate-limit";
import { WS_URL } from "../lib/constants";
import { useBeaconRevision } from "./privacy";
import "../index.css";
import "./theme.css";

const EVENTS = ["channelMessage"];

function Channels({ recheck }: { recheck: () => void }) {
  const [manager] = useState(() => new WsManager(WS_URL, recheck));
  const { iatas, isResolved } = useRegion();
  const { status } = useWsStatus(manager);
  const queryClient = useQueryClient();

  useEffect(() => {
    if (isResolved === false) return;
    manager.connect({ events: EVENTS, iatas });
    return () => manager.disconnect();
  }, [manager, isResolved, iatas]);

  useEffect(() => manager.onLagged(() => {
    void queryClient.invalidateQueries({ queryKey: ["channels"] });
    void queryClient.invalidateQueries({ queryKey: ["channel-messages"] });
  }), [manager, queryClient]);

  return <>
    <p className="ukmesh-feed-connection" role="status">
      {status === "connected" ? "Live" : status === "connecting" ? "Connecting to live messages…" : "Live connection unavailable"}
    </p>
    <ChannelList wsManager={manager} publicFeed />
  </>;
}

function PublicChannels({ recheck }: { recheck: () => void }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { ...queryRetryDefaults, gcTime: 0 } } }));
  const [selection] = useState(() => parseSelection(new URLSearchParams(location.search)));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>
    <RegionProvider defaultSelection={selection}><Channels recheck={recheck} /></RegionProvider>
  </QueryClientProvider>;
}

function ChannelsPanel({ recheck }: { recheck: () => void }) {
  const revision = useBeaconRevision();
  return <section className="ukmesh-feed-panel" aria-label="Public channels">
    {revision ? <PublicChannels key={revision} recheck={recheck} /> : (
      <div className="ukmesh-feed-empty" role="status">
        <p>{revision === null ? "Public channels are unavailable." : "Checking channel availability…"}</p>
        {revision === null && <button type="button" onClick={recheck}>Retry</button>}
      </div>
    )}
  </section>;
}

function Feed() {
  const [retry, setRetry] = useState(0);
  const recheck = useCallback(() => flushSync(() => setRetry((attempt) => attempt + 1)), []);
  return <div className="ukmesh-feed">
    <a className="ukmesh-feed-skip" href="#channels">Skip to channels</a>
    <header className="ukmesh-feed-header">
      <a className="ukmesh-feed-brand" href="/">UKMesh</a>
      <nav aria-label="UKMesh"><a href="/repeater">Repeaters</a><a href="/regions">Regions</a></nav>
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

void ready.then(() => createRoot(document.getElementById("root")!).render(<StrictMode><Feed /></StrictMode>));
