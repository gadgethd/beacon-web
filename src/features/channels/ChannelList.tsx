import { useState, useCallback, useMemo, useEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery, useIsFetching, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { getChannels } from "../../api/client";
import { isRateLimited, subscribeRateLimit } from "../../api/rate-limit";
import { LIVE_BUFFER_CAP } from "../../lib/constants";
import { useRegion } from "../../hooks/useRegion";
import { useIsMobile } from "../../hooks/useMediaQuery";
import { useWsChannelMessageHandler } from "../../hooks/useWsHandlers";
import { SkeletonRows } from "../../components/SkeletonRows";
import { ChannelSidebar } from "./ChannelSidebar";
import { ChannelFilterBar } from "./ChannelFilterBar";
import { MessagePanel } from "./MessagePanel";
import { filterChannels, type ChannelKeyFilter, type ChannelHashtagFilter } from "./channel-filters";
import type { ChannelMessage, ChannelPage, ChannelSummary } from "./types";
import type { CursorPage } from "../../types/api";
import type { WsManager } from "../../api/ws-manager";

interface ChannelListProps {
  wsManager: WsManager;
  onAnalyze?: (hash: string | null) => void;
  publicFeed?: boolean;
}

// keyed channels are few, so they load in big pages; the rest page on demand
const KEYED_PAGE_SIZE = 200;
const nextChannelPage = (last: ChannelPage) => last.hasMore ? last.nextPageCursor ?? last.nextCursor ?? undefined : undefined;

function appendMessages(old: InfiniteData<CursorPage<ChannelMessage>> | undefined, messages: ChannelMessage[], bounded: boolean) {
  if (!old) return old;
  const known = new Set(old.pages.flatMap((page) => page.items.map((message) => message.packetHash)));
  const added = messages.filter((message) => !known.has(message.packetHash));
  if (!added.length) return old;
  return { ...old, pages: old.pages.map((page, index) => {
    if (index !== 0) return page;
    const items = [...page.items, ...added];
    if (bounded && items.length > LIVE_BUFFER_CAP) {
      items.sort((a, b) => b.sentAt - a.sentAt);
      items.length = LIVE_BUFFER_CAP;
    }
    return { ...page, items };
  }) };
}

export function ChannelList({ wsManager, onAnalyze, publicFeed = false }: ChannelListProps) {
  const { t } = useTranslation();
  const { iatas, regionKey, isResolved } = useRegion();
  const regionPending = isResolved === false;
  const isMobile = useIsMobile();
  // Keep the open channel available when a directory page is evicted or refreshed.
  const [selection, setSelection] = useState<ChannelSummary | null>(null);
  const selectedId = selection?.id ?? null;
  const [heardCounts, setHeardCounts] = useState<Record<string, number>>({});
  const [messageScope, setMessageScope] = useState("");
  const [search, setSearch] = useState("");
  const [searchField, setSearchField] = useState("name");
  const [keyFilter, setKeyFilter] = useState<ChannelKeyFilter>("");
  const [hashtagFilter, setHashtagFilter] = useState<ChannelHashtagFilter>("");
  // tied to the region it was opened in, so a region switch never fetches the new region's other channels
  const [othersRegion, setOthersRegion] = useState<string | null>(null);
  const showOthers = othersRegion === regionKey;
  const queryClient = useQueryClient();
  const refreshPending = useRef(false);
  const pendingMessages = useRef(new Map<string, ChannelMessage>());
  const messagesOverflowed = useRef(false);
  const messageKey = useMemo(() => ["channel-messages", selectedId, regionKey, messageScope], [selectedId, regionKey, messageScope]);
  const messageFetching = useIsFetching({ queryKey: messageKey, exact: true });

  const flushPending = useCallback(() => {
    if (queryClient.isFetching({ queryKey: messageKey, exact: true })) return;
    if (messagesOverflowed.current) {
      if (isRateLimited()) return;
      messagesOverflowed.current = false;
      pendingMessages.current.clear();
      void queryClient.invalidateQueries({ queryKey: messageKey, exact: true });
    } else if (pendingMessages.current.size && queryClient.getQueryData(messageKey)) {
      // Merge live arrivals after history settles so its older snapshot cannot erase them.
      const queued = [...pendingMessages.current.values()];
      pendingMessages.current.clear();
      queryClient.setQueryData<InfiniteData<CursorPage<ChannelMessage>>>(messageKey, (old) => appendMessages(old, queued, publicFeed));
    }
  }, [messageKey, queryClient, publicFeed]);

  useEffect(() => {
    flushPending();
  }, [messageFetching, flushPending]);

  // An overflow parked behind a 429 would otherwise sit until the user switches channel.
  useEffect(() => subscribeRateLimit(flushPending), [flushPending]);

  const prevRegion = useRef(regionKey);
  useEffect(() => {
    if (prevRegion.current !== regionKey) {
      prevRegion.current = regionKey;
      refreshPending.current = false;
      pendingMessages.current.clear();
      messagesOverflowed.current = false;
      setSelection(null);
      setHeardCounts({});
      setMessageScope("");
      setSearch("");
      setKeyFilter("");
      setHashtagFilter("");
    }
  }, [regionKey]);

  const keyedKey = useMemo(() => ["channels", regionKey, "keyed"], [regionKey]);
  const keyed = useInfiniteQuery({
    queryKey: keyedKey,
    queryFn: ({ pageParam, signal }) => getChannels({ iatas, cursor: pageParam, keyKnown: true, limit: KEYED_PAGE_SIZE }, signal),
    initialPageParam: undefined as number | string | undefined,
    getNextPageParam: nextChannelPage,
    staleTime: 60_000,
    maxPages: publicFeed ? 5 : undefined,
    enabled: !regionPending,
  });
  const keyedLoading = keyed.isLoading || regionPending;
  const others = useInfiniteQuery({
    queryKey: ["channels", regionKey, "other"],
    queryFn: ({ pageParam, signal }) => getChannels({ iatas, cursor: pageParam, keyKnown: false }, signal),
    initialPageParam: undefined as number | string | undefined,
    getNextPageParam: nextChannelPage,
    staleTime: 60_000,
    enabled: !publicFeed && !regionPending && (showOthers || keyFilter === "unknown"),
  });

  // A server without the keyKnown filter mixes unkeyed channels in; don't page through all of them.
  const keyedUnfiltered = keyed.data?.pages.some((p) => p.items.some((ch) => !ch.keyKnown)) ?? false;
  const { hasNextPage: keyedHasMore, isFetching: keyedFetching, isError: keyedError, fetchNextPage: fetchKeyed } = keyed;
  useEffect(() => {
    if (!publicFeed && keyedHasMore && !keyedFetching && !keyedError && !keyedUnfiltered) void fetchKeyed();
  }, [publicFeed, keyedHasMore, keyedFetching, keyedError, keyedUnfiltered, fetchKeyed]);

  useEffect(() => {
    if (!keyedFetching && refreshPending.current) {
      refreshPending.current = false;
      void queryClient.resetQueries({ queryKey: keyedKey, exact: true });
    }
  }, [keyedFetching, queryClient, keyedKey]);

  const channels = useMemo(() => {
    const byId = new Map<number, ChannelSummary>();
    for (const page of keyed.data?.pages ?? []) {
      for (const channel of page.items) {
        if (channel.keyKnown && !byId.has(channel.id)) byId.set(channel.id, channel);
      }
    }
    for (const page of others.data?.pages ?? []) {
      for (const channel of page.items) {
        if (!byId.has(channel.id)) byId.set(channel.id, channel);
      }
    }
    return [...byId.values()];
  }, [keyed.data, others.data]);

  const handleSelect = useCallback((id: number) => {
    pendingMessages.current.clear();
    messagesOverflowed.current = false;
    setSelection(channels.find((ch) => ch.id === id) ?? null);
    setHeardCounts({});
  }, [channels]);

  const handleScopeChange = useCallback((scope: string) => {
    pendingMessages.current.clear();
    messagesOverflowed.current = false;
    setMessageScope(scope);
  }, []);

  // keyed first; within each, "Public" pinned first, then named channels, then unnamed by most recent
  const sortedChannels = useMemo(
    () =>
      [...channels].sort((a, b) => {
        if (a.keyKnown !== b.keyKnown) return a.keyKnown ? -1 : 1;
        const aPub = a.name === "Public" ? 1 : 0;
        const bPub = b.name === "Public" ? 1 : 0;
        if (aPub !== bPub) return bPub - aPub;
        if (a.name && !b.name) return -1;
        if (!a.name && b.name) return 1;
        return b.lastSeen - a.lastSeen;
      }),
    [channels],
  );

  const filteredChannels = useMemo(
    () => filterChannels(sortedChannels, { search, searchField, keyFilter, hashtagFilter }),
    [sortedChannels, search, searchField, keyFilter, hashtagFilter],
  );

  const selectedChannel = channels.find((ch) => ch.id === selectedId) ?? selection;

  const handleChannelMessage = useCallback(
    (data: ChannelMessage) => {
      const listKey = ["channels", regionKey];
      const cachedChannels = queryClient.getQueriesData<InfiniteData<ChannelPage>>({ queryKey: listKey })
        .flatMap(([, cached]) => cached?.pages.flatMap((p) => p.items) ?? []);
      const matchesChannel = (ch: ChannelSummary) => data.channelId !== undefined ? ch.id === data.channelId : ch.channelHash === data.channelHash;
      const known = cachedChannels.find(matchesChannel);
      if (known) {
        // Display timestamps may change; the server's page cursors must not.
        queryClient.setQueriesData<InfiniteData<ChannelPage>>({ queryKey: listKey }, (old) => old && ({
          ...old,
          pages: old.pages.map((p) => ({ ...p, items: p.items.map((ch) => ch.id === known.id
            ? { ...ch, lastSeen: Math.max(ch.lastSeen, data.sentAt) } : ch) })),
        }));
      } else if (!isRateLimited()) {
        // A decrypted message means a keyed channel; refetch that list from its first page.
        if (queryClient.isFetching({ queryKey: keyedKey, exact: true })) refreshPending.current = true;
        else void queryClient.resetQueries({ queryKey: keyedKey, exact: true });
      }

      const selected = cachedChannels.find((ch) => ch.id === selectedId) ?? selection;
      if (selected && matchesChannel(selected) && (!messageScope || data.scope === messageScope)) {
        if (queryClient.isFetching({ queryKey: messageKey, exact: true }) || !queryClient.getQueryData(messageKey)) {
          if (pendingMessages.current.size >= LIVE_BUFFER_CAP && !pendingMessages.current.has(data.packetHash)) {
            messagesOverflowed.current = true;
          } else pendingMessages.current.set(data.packetHash, data);
        }
        // A fresh arrival is the only signal left once idle-and-overflowed, so try recovery here too.
        flushPending();
        // The WS event has no retained observation total; repeats do not add observers.
        setHeardCounts((prev) => {
          const previous = prev[data.packetHash];
          const reach = Math.max(previous ?? 0, data.observationCount ?? 1);
          if (previous === reach) return prev;
          const retained = publicFeed && previous === undefined
            ? Object.fromEntries(Object.entries(prev).slice(-(LIVE_BUFFER_CAP - 1))) : prev;
          return { ...retained, [data.packetHash]: reach };
        });
        // Append to the retained newest page; browsing older history must not evict it.
        queryClient.setQueryData<InfiniteData<CursorPage<ChannelMessage>>>(
          messageKey,
          (old) => appendMessages(old, [data], publicFeed),
        );
      }
    },
    [queryClient, selectedId, selection, regionKey, keyedKey, messageScope, messageKey, flushPending, publicFeed],
  );

  useWsChannelMessageHandler(wsManager, handleChannelMessage);

  // mobile: opening a thread takes over the whole view, hiding the list and filter bar
  const showList = !isMobile || selectedChannel === null;

  return (
    <div className="flex flex-col flex-1 min-h-0">
      {showList && (publicFeed ? (
        <label className="ukmesh-channel-search">
          Find a channel
          <input value={search} onChange={(event) => setSearch(event.target.value)} type="search" />
        </label>
      ) : (
        <ChannelFilterBar
          search={search}
          onSearchChange={setSearch}
          searchField={searchField}
          onSearchFieldChange={setSearchField}
          keyFilter={keyFilter}
          onKeyChange={setKeyFilter}
          hashtagFilter={hashtagFilter}
          onHashtagChange={setHashtagFilter}
        />
      ))}
      <div className="flex flex-1 min-h-0">
        {showList && (
          <div className="flex flex-col min-h-0 w-full md:w-56 md:min-w-56 border-r border-border bg-bg-surface">
            {keyedLoading ? (
              <SkeletonRows rows={8} />
            ) : (
              <ChannelSidebar
                channels={filteredChannels}
                selectedId={selectedId}
                onSelect={handleSelect}
              />
            )}
            {!keyedLoading && filteredChannels.length === 0 && !keyed.isError && !others.isError && (
              <p className="px-3 py-2 text-xs font-mono text-text-muted">
                {publicFeed && channels.length === 0 ? "No channel messages have arrived yet." : t("channels.noMatches")}
              </p>
            )}
            {(keyed.isError || others.isError) && <p role="alert" className="px-3 py-2 text-xs text-danger">{t("channels.loadError")}</p>}
            {keyed.isError ? (
              <PagerButton disabled={keyed.isFetching} onClick={() => void keyed.refetch()}>
                {keyed.isFetching ? t("channels.loadingChannels") : t("channels.retryChannels")}
              </PagerButton>
            ) : publicFeed ? (
              keyedHasMore && <PagerButton disabled={keyedFetching} onClick={() => void fetchKeyed()}>{t("channels.loadMore")}</PagerButton>
            ) : !others.isEnabled ? (
              !publicFeed && !keyedLoading && <PagerButton onClick={() => setOthersRegion(regionKey)}>{t("channels.loadOthers")}</PagerButton>
            ) : (others.hasNextPage || others.isError) && (
              <PagerButton disabled={others.isFetching} onClick={() => void (others.hasNextPage ? others.fetchNextPage() : others.refetch())}>
                {others.isFetching ? t("channels.loadingChannels") : others.isError ? t("channels.retryChannels") : t("channels.loadMore")}
              </PagerButton>
            )}
          </div>
        )}
        {(!isMobile || selectedChannel !== null) && (
          <MessagePanel
            channel={selectedChannel}
            heardCounts={heardCounts}
            iatas={iatas}
            regionKey={regionKey}
            scope={messageScope}
            onScopeChange={publicFeed ? undefined : handleScopeChange}
            publicFeed={publicFeed}
            onAnalyze={onAnalyze}
            onBack={isMobile ? () => setSelection(null) : undefined}
          />
        )}
      </div>
    </div>
  );
}

function PagerButton({ disabled, onClick, children }: { disabled?: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className="m-2 shrink-0 rounded border border-border px-3 py-1.5 text-xs font-mono text-text-normal hover:bg-text-normal/3 disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
    >
      {children}
    </button>
  );
}
