import { useState, useCallback, useMemo, useEffect, useLayoutEffect, useRef, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { useInfiniteQuery, useIsFetching, useQueryClient, type InfiniteData } from "@tanstack/react-query";
import { getChannels } from "../../api/client";
import { isRateLimited, subscribeRateLimit } from "../../api/rate-limit";
import { LIVE_BUFFER_CAP } from "../../lib/constants";
import { useRegion } from "../../hooks/useRegion";
import { useIsMobile } from "../../hooks/useMediaQuery";
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
  const known = new Set<string>();
  for (const page of old.pages) for (const message of page.items) known.add(message.packetHash);
  const added = messages.filter((message) => {
    if (known.has(message.packetHash)) return false;
    known.add(message.packetHash);
    return true;
  });
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

function applyChannelTimes(old: InfiniteData<ChannelPage> | undefined, times: ReadonlyMap<number, number>) {
  if (!old) return old;
  let changed = false;
  const pages = old.pages.map((page) => {
    let pageChanged = false;
    const items = page.items.map((channel) => {
      const time = times.get(channel.id);
      if (time === undefined || time <= channel.lastSeen) return channel;
      pageChanged = true;
      return { ...channel, lastSeen: time };
    });
    if (!pageChanged) return page;
    changed = true;
    return { ...page, items };
  });
  return changed ? { ...old, pages } : old;
}

function batchChannelMessages(apply: (messages: ChannelMessage[]) => void) {
  let queued: ChannelMessage[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const take = () => {
    const messages = queued;
    clearTimeout(timer);
    timer = undefined;
    queued = [];
    return messages;
  };
  const flush = () => {
    const messages = take();
    if (messages.length) apply(messages);
  };
  return {
    take,
    add(message: ChannelMessage) {
      queued.push(message);
      if (queued.length === LIVE_BUFFER_CAP) flush();
      else timer ??= setTimeout(flush, 16);
    },
  };
}

function matchesThread(message: ChannelMessage, id: number | null, hash: string | undefined, scope: string) {
  const matchesChannel = message.channelId !== undefined ? message.channelId === id : message.channelHash === hash;
  return id !== null && matchesChannel && (!scope || message.scope === scope);
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
    setSelection(channels.find((ch) => ch.id === id) ?? null);
    setHeardCounts({});
  }, [channels]);

  const handleScopeChange = useCallback((scope: string) => {
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
  const selectedHash = selectedChannel?.channelHash;

  const handleChannelMessages = useCallback(
    (messages: ChannelMessage[]) => {
      const listKey = ["channels", regionKey];
      const byId = new Map<number, ChannelSummary>();
      const byHash = new Map<string, ChannelSummary>();
      const directories = queryClient.getQueriesData<InfiniteData<ChannelPage>>({ queryKey: listKey });
      for (const [, cached] of directories) {
        for (const page of cached?.pages ?? []) {
          for (const channel of page.items) {
            if (!byId.has(channel.id)) byId.set(channel.id, channel);
            if (!byHash.has(channel.channelHash)) byHash.set(channel.channelHash, channel);
          }
        }
      }
      const selected = (selectedId === null ? undefined : byId.get(selectedId)) ?? selection;
      const times = new Map<number, number>();
      const arrivals: ChannelMessage[] = [];
      let discoveredChannel = false;
      for (const data of messages) {
        const known = data.channelId !== undefined ? byId.get(data.channelId) : byHash.get(data.channelHash);
        if (known) times.set(known.id, Math.max(times.get(known.id) ?? -Infinity, data.sentAt));
        else discoveredChannel = true;
        if (matchesThread(data, selectedId, selected?.channelHash, messageScope)) arrivals.push(data);
      }
      if (times.size) {
        // Display timestamps may change; the server's page cursors must not.
        for (const [key, old] of directories) {
          const next = applyChannelTimes(old, times);
          if (old !== next) queryClient.setQueryData(key, next);
        }
      }
      if (discoveredChannel && !isRateLimited()) {
        // A decrypted message means a keyed channel; refetch that list from its first page.
        if (queryClient.isFetching({ queryKey: keyedKey, exact: true })) refreshPending.current = true;
        else void queryClient.resetQueries({ queryKey: keyedKey, exact: true });
      }

      if (arrivals.length) {
        if (queryClient.isFetching({ queryKey: messageKey, exact: true }) || !queryClient.getQueryData(messageKey)) {
          for (const data of arrivals) {
            if (pendingMessages.current.size >= LIVE_BUFFER_CAP && !pendingMessages.current.has(data.packetHash)) {
              messagesOverflowed.current = true;
            } else pendingMessages.current.set(data.packetHash, data);
          }
        }
        // A fresh arrival is the only signal left once idle-and-overflowed, so try recovery here too.
        flushPending();
        // The WS event has no retained observation total; repeats do not add observers.
        setHeardCounts((prev) => {
          let next = prev;
          let grew = false;
          for (const data of arrivals) {
            const previous = next[data.packetHash];
            const reach = Math.max(previous ?? 0, data.observationCount ?? 1);
            if (previous === reach) continue;
            if (next === prev) next = { ...prev };
            if (previous === undefined) grew = true;
            next[data.packetHash] = reach;
          }
          if (publicFeed && grew) {
            const keys = Object.keys(next);
            for (const key of keys.slice(0, Math.max(0, keys.length - LIVE_BUFFER_CAP))) delete next[key];
          }
          return next;
        });
        // Append to the retained newest page; browsing older history must not evict it.
        queryClient.setQueryData<InfiniteData<CursorPage<ChannelMessage>>>(
          messageKey,
          (old) => appendMessages(old, arrivals, publicFeed),
        );
      }
    },
    [queryClient, selectedId, selection, regionKey, keyedKey, messageScope, messageKey, flushPending, publicFeed],
  );

  useLayoutEffect(() => {
    const batch = batchChannelMessages(handleChannelMessages);
    const pending = pendingMessages.current;
    const unsubscribe = wsManager.onChannelMessage(batch.add);
    return () => {
      unsubscribe();
      const queued = batch.take();
      // The old subscription may have been revoked. Let REST reconcile the
      // affected old scope instead of applying its live payload after the switch.
      const refetchType = isRateLimited() ? "none" : "active";
      if (queued.length) {
        void queryClient.invalidateQueries({ queryKey: ["channels", regionKey], refetchType });
      }
      if (pending.size || messagesOverflowed.current
        || queued.some((message) => matchesThread(message, selectedId, selectedHash, messageScope))) {
        void queryClient.invalidateQueries({ queryKey: messageKey, exact: true, refetchType });
      }
      pending.clear();
      messagesOverflowed.current = false;
    };
  }, [handleChannelMessages, messageKey, messageScope, queryClient, regionKey, selectedHash, selectedId, wsManager]);

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
