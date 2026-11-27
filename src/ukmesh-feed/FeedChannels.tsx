import { useEffect, useState } from "react";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { ChannelList } from "../features/channels/ChannelList";
import { RegionProvider, useRegion } from "../hooks/useRegion";
import { parseSelection } from "../hooks/region-selection";
import { usePauseWhenHidden } from "../hooks/usePauseWhenHidden";
import { useWsStatus } from "../hooks/useWsStatus";
import { WsManager } from "../api/ws-manager";
import { queryRetryDefaults } from "../api/rate-limit";
import { WS_URL } from "../lib/constants";

const EVENTS = ["channelMessage"];
const liveTime = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", second: "2-digit" });

function ChannelLiveStatus({ manager, area, isResolved }: { manager: WsManager; area: string; isResolved?: boolean }) {
  const { status } = useWsStatus(manager);
  const [latest, setLatest] = useState<{ area: string; at: number }>();
  const lastUpdate = isResolved !== false && latest?.area === area ? latest.at : undefined;

  useEffect(() => manager.onChannelMessage(() => {
    const at = Math.floor(Date.now() / 1_000) * 1_000;
    setLatest(previous => previous?.area === area && previous.at === at ? previous : { area, at });
  }), [manager, area]);

  return <div className="ukmesh-feed-connection">
    <span role="status">
      {isResolved === false ? "Loading observer areas…" : status === "connected" ? "Live"
        : status === "connecting" && !lastUpdate ? "Connecting…" : "Reconnecting"}
    </span>
    <span>Last live update {lastUpdate
      ? <time dateTime={new Date(lastUpdate).toISOString()}>{liveTime.format(lastUpdate)}</time>
      : "unavailable"}</span>
  </div>;
}

function Channels({ recheck }: { recheck?: () => void }) {
  const [manager] = useState(() => new WsManager(WS_URL, recheck));
  const { iatas, isResolved } = useRegion();
  const queryClient = useQueryClient();
  usePauseWhenHidden(manager);

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
    <ChannelLiveStatus manager={manager} area={JSON.stringify(iatas ?? null)} isResolved={isResolved} />
    <ChannelList wsManager={manager} publicFeed />
  </>;
}

export function FeedChannels({ recheck }: { recheck?: () => void }) {
  const [client] = useState(() => new QueryClient({ defaultOptions: { queries: { ...queryRetryDefaults, gcTime: 0 } } }));
  const [selection] = useState(() => parseSelection(new URLSearchParams(location.search)));
  useEffect(() => () => client.clear(), [client]);
  return <QueryClientProvider client={client}>
    <RegionProvider defaultSelection={selection}><Channels recheck={recheck} /></RegionProvider>
  </QueryClientProvider>;
}
