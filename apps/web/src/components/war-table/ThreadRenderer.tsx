"use client";

// ThreadRenderer: the shared war-table message list plus compose box, drawn in
// the iOS-Messages bubble layout.
//
// Embedded in the team chat tab, the rally panel, the encounter panel, and the
// DM conversation screen. Each surface passes its thread PDA and scope; this
// component owns the read/subscribe/post lifecycle via useWarTable, the
// grouping/day-separator logic, auto-scroll, and the pill compose bar. The
// individual bubbles are drawn by MessageBubble.
//
// Messages render oldest-at-top, newest-at-bottom, auto-scrolling to the latest
// on update. Consecutive messages from one sender stack into a group with one
// avatar + name header and one trailing timestamp. Own messages sit right in the
// accent fill; received messages sit left in a neutral fill. System messages are
// centered pills. Locked and tombstoned messages render a dim placeholder.
//
// Stays usable both compact (team/rally/encounter panels, default max-h-96) and
// full-screen (the DM page passes maxHeightClass="max-h-none").

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { PublicKey } from "@solana/web3.js";
import { useWallet } from "@solana/wallet-adapter-react";
import { MessageSquare, SendHorizontal, LoaderCircle, Pin, Reply, X } from "lucide-react";
import { WtKind, WarTableScope, WT_MAX_TEXT_BYTES } from "novus-mundus-sdk";
import { useWarTable } from "@/lib/hooks/useWarTable";
import { ZERO_ID, type WtMessage } from "@/lib/store/war-table";
import { useWtReadStore } from "@/lib/store/wt-read";
import { cn } from "@/lib/utils";
import { PlayerName } from "@/components/war-table/PlayerName";
import {
  MessageBubble,
  placeholderFor,
  useSenderIdentity,
  type GroupPos,
} from "@/components/war-table/MessageBubble";

export interface ThreadRendererProps {
  threadPda: PublicKey;
  scope: WarTableScope;
  // base58 PlayerAccount PDA of the DM peer; only meaningful for DM scope.
  peer?: string;
  // when false the compose box is disabled (read-only access).
  canPost: boolean;
  // compose-box placeholder text.
  placeholder?: string;
  // height cap on the scroll region. Default keeps the embedded-panel behavior;
  // the DM page passes "max-h-none" to fill the screen.
  maxHeightClass?: string;
  // Decides whether the connected viewer may pin/unpin a given message. Default
  // is own-only; the team-chat embed passes an officer-aware predicate (D5:
  // officers-or-own for team, own otherwise). Keeps this component scope-agnostic.
  canPin?: (msg: WtMessage) => boolean;
}

// Map the chat WarTableScope to the actions-menu scope: only DM hides the
// "Send message" item, since we are already inside that DM.
function menuScopeFor(scope: WarTableScope): "thread" | "dm" {
  return scope === WarTableScope.Dm ? "dm" : "thread";
}

// Flat render-item stream produced from the ordered message list. Day separators
// and system pills are interleaved with grouped message bubbles.
type RenderItem =
  | { kind: "day"; key: string; label: string }
  | { kind: "system"; key: string; msg: WtMessage }
  | {
      kind: "msg";
      key: string;
      msg: WtMessage;
      mine: boolean;
      groupPos: GroupPos;
      showMeta: boolean;
    };

const GROUP_GAP_SECS = 5 * 60;

// Show the byte counter once the draft is within this many bytes of the limit.
const BYTE_COUNTER_NEAR = 40;

// UTF-8 byte length of a string. The war-table limit is on BYTES, not chars: a
// 4-byte emoji costs 4. Shared by the compose guard and the live counter.
const utf8Encoder = new TextEncoder();
function utf8ByteLength(s: string): number {
  return utf8Encoder.encode(s).length;
}

// Trim a string to at most maxBytes UTF-8 bytes without splitting a multi-byte
// code point. Used to clamp paste/typing that would exceed the limit.
function trimToByteLength(s: string, maxBytes: number): string {
  if (utf8ByteLength(s) <= maxBytes) return s;
  // Walk by code points (not UTF-16 units) so surrogate pairs stay intact.
  let bytes = 0;
  let out = "";
  for (const ch of s) {
    const chBytes = utf8Encoder.encode(ch).length;
    if (bytes + chBytes > maxBytes) break;
    bytes += chBytes;
    out += ch;
  }
  return out;
}

// Local-day bucket for a unix-seconds timestamp. Uses the local date parts so
// the day separator matches the viewer's calendar, not UTC.
function localDayKey(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Human day label: Today / Yesterday / a full weekday-month-day string.
function dayLabel(unixSecs: number): string {
  const d = new Date(unixSecs * 1000);
  const now = new Date();
  const today = localDayKey(Math.floor(now.getTime() / 1000));
  const yesterday = localDayKey(Math.floor(now.getTime() / 1000) - 86400);
  const key = localDayKey(unixSecs);
  if (key === today) return "Today";
  if (key === yesterday) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
}

// Pure grouping: turn the ordered message list into the render-item stream.
// connectedWallet decides own vs received; pass it in so this stays pure.
function buildRenderItems(messages: WtMessage[], connectedWallet: string | null): RenderItem[] {
  const items: RenderItem[] = [];
  // The local-day of the previous message; messages with createdAt === 0 inherit
  // this so a missing advisory timestamp never forces a spurious separator.
  let prevDayKey: string | null = null;
  // Index of the current group's tail bubble, kept so we can patch its groupPos
  // as the group extends; null when no group is open.
  let groupAnchor: { lastMsgIndex: number } | null = null;
  let prevMsg: WtMessage | null = null;

  const closeGroup = () => {
    groupAnchor = null;
  };

  for (const msg of messages) {
    // Reaction (5), pin (6) and tombstone (4) are control/fold messages, never
    // their own bubble: a tombstone folds its victim (which renders the
    // "[Message removed]" placeholder), so the kind=4 record must not also draw
    // an empty bubble. Reactions/pins are already excluded by the store; this
    // also guards the optimistic-pending window where they briefly live here.
    if (
      msg.kind === WtKind.Reaction ||
      msg.kind === WtKind.Pin ||
      msg.kind === WtKind.Tombstone
    )
      continue;

    if (msg.kind === WtKind.System) {
      closeGroup();
      items.push({ kind: "system", key: msg.id, msg });
      prevMsg = null;
      continue;
    }

    const hasTs = msg.createdAt > 0;
    const dayKey: string | null = hasTs ? localDayKey(msg.createdAt) : prevDayKey;

    // Day separator before the first message and whenever the local day rolls
    // over. A missing timestamp inherits prevDayKey, so it joins that day.
    if (hasTs && dayKey !== prevDayKey) {
      closeGroup();
      items.push({ kind: "day", key: `day-${msg.id}`, label: dayLabel(msg.createdAt) });
    }
    if (dayKey) prevDayKey = dayKey;

    const mine = connectedWallet !== null && msg.senderWallet === connectedWallet;
    const isReply = msg.kind === WtKind.Reply;

    // A new group starts when the sender, side, day or the 5-minute gap break,
    // or when this or the previous message is a reply (replies always show their
    // own header), or when pending crosses with confirmed.
    let startNew = true;
    if (groupAnchor && prevMsg) {
      const sameSender = prevMsg.senderWallet === msg.senderWallet;
      const sameDay = !hasTs || prevMsg.createdAt === 0 || localDayKey(prevMsg.createdAt) === dayKey;
      const withinGap =
        !hasTs ||
        prevMsg.createdAt === 0 ||
        msg.createdAt - prevMsg.createdAt <= GROUP_GAP_SECS;
      const prevReply = prevMsg.kind === WtKind.Reply;
      const samePending = (prevMsg.pending === true) === (msg.pending === true);
      startNew = !(sameSender && sameDay && withinGap && !prevReply && !isReply && samePending);
    }

    if (startNew) {
      const index = items.length;
      items.push({
        kind: "msg",
        key: msg.id,
        msg,
        mine,
        groupPos: "single",
        showMeta: true,
      });
      groupAnchor = { lastMsgIndex: index };
    } else if (groupAnchor) {
      // Promote the previous tail of this group from last/single to first/middle
      // so the corners stack correctly, then append this one as the new tail.
      // Promote the prior tail: single becomes the group's first bubble (keeping
      // its avatar + name); an earlier first/last becomes middle. Only the first
      // bubble carries showMeta; the last bubble's timestamp is driven by
      // groupPos inside MessageBubble, not showMeta.
      const prevItem = items[groupAnchor.lastMsgIndex];
      if (prevItem && prevItem.kind === "msg") {
        prevItem.groupPos = prevItem.groupPos === "single" ? "first" : "middle";
      }
      const index = items.length;
      items.push({
        kind: "msg",
        key: msg.id,
        msg,
        mine,
        groupPos: "last",
        showMeta: false,
      });
      groupAnchor.lastMsgIndex = index;
    }

    prevMsg = msg;
  }

  return items;
}

export function ThreadRenderer({
  threadPda,
  scope,
  peer,
  canPost,
  placeholder,
  maxHeightClass = "max-h-96",
  canPin,
}: ThreadRendererProps) {
  const {
    messages,
    isLoading,
    loadingOlder,
    hasMore,
    loadOlder,
    post,
    congested,
    pinnedId,
    replyTo,
    deleteMessage,
    react,
    unreact,
    myReactionId,
    pin,
    unpin,
  } = useWarTable(threadPda, scope, { peer });
  const { publicKey } = useWallet();
  const connectedWallet = publicKey ? publicKey.toBase58() : null;

  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  // The message being replied to (drives the composer chip), or null.
  const [replyTarget, setReplyTarget] = useState<WtMessage | null>(null);
  // Resolve the reply target's PlayerAccount PDA from its wallet (same derivation
  // the bubbles use) so the chip shows the player's name via PlayerName, matching
  // the rest of the thread instead of a raw shortened address. The hook tolerates
  // an empty string (returns null) when there is no active reply target.
  const replyTargetPda = useSenderIdentity(replyTarget?.senderWallet ?? "");
  // A message id briefly ring-highlighted after a jump-to-parent, cleared on a timer.
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Top-of-list sentinel for scroll-up load-older, plus the distance-from-bottom
  // captured before a load-older so the layout effect can restore the viewport.
  const topSentinelRef = useRef<HTMLDivElement | null>(null);
  const restoreFromBottom = useRef<number | null>(null);

  // Own-only is the default pin gate; a scope-aware embed (team) overrides it.
  const canPinFor = useCallback(
    (msg: WtMessage): boolean => {
      if (canPin) return canPin(msg);
      return connectedWallet !== null && msg.senderWallet === connectedWallet;
    },
    [canPin, connectedWallet],
  );

  // Scroll to a message by its hex id and pulse a highlight ring. Used by the
  // reply quote tap and the pin banner jump.
  const onJumpTo = useCallback((targetId: string) => {
    const el = scrollRef.current?.querySelector(`[data-msg-id="${targetId}"]`);
    if (el instanceof HTMLElement) el.scrollIntoView({ block: "center" });
    setHighlightId(targetId);
    if (highlightTimer.current !== null) clearTimeout(highlightTimer.current);
    highlightTimer.current = setTimeout(() => setHighlightId(null), 1200);
  }, []);

  useEffect(() => {
    return () => {
      if (highlightTimer.current !== null) clearTimeout(highlightTimer.current);
    };
  }, []);

  // Index by id so a reply can quote a snippet of its parent.
  const byId = useMemo(() => {
    const m = new Map<string, WtMessage>();
    for (const msg of messages) m.set(msg.id, msg);
    return m;
  }, [messages]);

  const renderItems = useMemo(
    () => buildRenderItems(messages, connectedWallet),
    [messages, connectedWallet],
  );

  // The currently pinned message, resolved from the thread pin id. Null when
  // there is no pin or the pinned message is not loaded / was tombstoned.
  const pinnedMsg = useMemo(() => {
    if (pinnedId === ZERO_ID) return null;
    const m = byId.get(pinnedId);
    if (!m || m.tombstoned || m.locked) return null;
    return m;
  }, [pinnedId, byId]);

  // Embeds run with the default cap and want the tighter compact metrics; the
  // full-screen DM page opts out of the cap and reads as not-compact.
  const compact = maxHeightClass !== "max-h-none";
  const avatarSize = compact ? 28 : 32;
  const menuScope = menuScopeFor(scope);

  // Auto-scroll to the newest message whenever the list changes. Keying on the
  // last message id as well as the count re-pins to the bottom when a pending
  // echo reconciles into its confirmed copy (count unchanged, id changes).
  const messageCount = messages.length;
  const lastMessageId = messages[messageCount - 1]?.id;
  // Pin to the bottom only when the NEWEST message changes (new arrival, or a
  // pending echo reconciling). Keying off the count too would yank to the bottom
  // when a scroll-up load-older PREPENDS (count grows, last id unchanged).
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [lastMessageId]);

  // Load-older: remember the distance from the bottom, then page. The layout
  // effect below restores it once the older page has prepended.
  const handleLoadOlder = useCallback(() => {
    const el = scrollRef.current;
    if (el) restoreFromBottom.current = el.scrollHeight - el.scrollTop;
    void loadOlder();
  }, [loadOlder]);

  // Preserve scroll position across an older-page prepend: older messages grow
  // the list at the TOP, which would otherwise shove the viewport down. Restore
  // the saved distance-from-bottom (no-op for new/seed loads, which leave the
  // ref null).
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (el && restoreFromBottom.current !== null) {
      el.scrollTop = el.scrollHeight - restoreFromBottom.current;
      restoreFromBottom.current = null;
    }
  }, [messageCount]);

  // Auto-trigger load-older when the top sentinel scrolls into view (it sits
  // off-screen at the top until the user scrolls up; absent when no older
  // history remains). The loadingOlder guard in the hook prevents overlap.
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    const root = scrollRef.current;
    if (!sentinel || !root || !hasMore) return;
    const obs = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) handleLoadOlder();
      },
      { root, threshold: 0.1 },
    );
    obs.observe(sentinel);
    return () => obs.disconnect();
  }, [hasMore, handleLoadOlder]);

  // Mark this thread read while it is on screen: advance the last-seen cursor to
  // the newest CONFIRMED message. Pending echoes carry a temp id that sorts last,
  // so they must be skipped or they'd swallow a later real message. Clears the
  // unread badge on open, on each new message while viewing, and after our send.
  const markRead = useWtReadStore((s) => s.markRead);
  useEffect(() => {
    for (let i = messages.length - 1; i >= 0; i--) {
      const m = messages[i]!;
      if (!m.pending) {
        markRead(threadPda.toBase58(), m.id);
        break;
      }
    }
  }, [messages, threadPda, markRead]);

  // Byte budget for the compose box. The war-table limit is on UTF-8 bytes
  // (a 4-byte emoji costs 4), so the counter and the Send gate measure bytes,
  // never characters. The textarea onChange already trims input to the limit, so
  // overBudget should never be true in practice; it is kept as a defensive Send
  // gate in case a value slips in some other way.
  const draftBytes = useMemo(() => utf8ByteLength(draft), [draft]);
  const remainingBytes = WT_MAX_TEXT_BYTES - draftBytes;
  const overBudget = remainingBytes < 0;
  const showByteCounter = remainingBytes <= BYTE_COUNTER_NEAR;

  // Auto-grow the textarea up to the max-height pill cap, then let it scroll.
  function autoGrow() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }

  async function handleSend() {
    const text = draft.trim();
    if (!text || sending || !canPost || utf8ByteLength(text) > WT_MAX_TEXT_BYTES) return;
    setSending(true);
    try {
      // When a reply target is set, post a reply (kind=3) quoting it; otherwise
      // a plain text message. Clear the reply chip only on success.
      if (replyTarget) {
        await replyTo(replyTarget.id, text);
        setReplyTarget(null);
      } else {
        await post({ kind: WtKind.Text, payload: text });
      }
      setDraft("");
      const el = textareaRef.current;
      if (el) el.style.height = "auto";
    } catch {
      // useWarTable already surfaces the failure via notify; keep the draft so
      // the player can retry without retyping.
    } finally {
      setSending(false);
    }
  }

  // Toggle a reaction chip on a message: un-react when it is already mine (the
  // hook resolves my reaction message id), otherwise react with the emoji.
  const onToggleReaction = useCallback(
    (msgId: string, emoji: string, reactedByMe: boolean) => {
      if (reactedByMe) {
        const target = myReactionId(msgId, emoji);
        if (target) void unreact(target);
        return;
      }
      void react(msgId, emoji);
    },
    [myReactionId, unreact, react],
  );

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  // min-h-64 only for the compact embeds; the full-screen DM (max-h-none) must
  // not carry a 16rem floor or it overflows short mobile viewports.
  return (
    <div className={cn("flex h-full flex-col gap-2", compact && "min-h-64", maxHeightClass)}>
      {pinnedMsg ? (
        <div className="flex items-center gap-2 rounded-lg border border-border-default bg-surface-overlay px-3 py-1.5 text-xs">
          <Pin className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
          <button
            type="button"
            onClick={() => onJumpTo(pinnedMsg.id)}
            className="flex-1 truncate text-left text-text-secondary transition-colors hover:text-text-primary"
          >
            {pinnedMsg.body}
          </button>
          {canPinFor(pinnedMsg) ? (
            <button
              type="button"
              onClick={() => void unpin()}
              aria-label="Unpin message"
              className="shrink-0 rounded-full p-0.5 text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          ) : null}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        className="flex-1 space-y-1 overflow-y-auto rounded-lg border border-border-default bg-surface/60 px-3 py-3"
      >
        {hasMore ? (
          <div ref={topSentinelRef} className="flex justify-center py-2">
            {loadingOlder ? (
              <span className="flex items-center gap-2 text-[10px] uppercase tracking-wider text-text-muted">
                <LoaderCircle className="h-3 w-3 animate-spin" aria-hidden />
                Loading earlier messages
              </span>
            ) : (
              <button
                type="button"
                onClick={handleLoadOlder}
                className="rounded-full border border-border-default bg-surface-overlay px-3 py-0.5 text-[10px] uppercase tracking-wider text-text-muted transition-colors hover:text-text-secondary"
              >
                Load earlier
              </button>
            )}
          </div>
        ) : null}
        {isLoading && messages.length === 0 ? (
          <div className="flex h-full items-center justify-center gap-2 text-xs text-text-muted">
            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            Loading messages
          </div>
        ) : messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-2 text-center text-xs text-text-muted">
            <MessageSquare className="h-5 w-5 opacity-60" aria-hidden />
            No messages yet
          </div>
        ) : (
          renderItems.map((item) => {
            if (item.kind === "day") {
              return (
                <div key={item.key} className="flex items-center justify-center py-2">
                  <span className="rounded-full border border-border-default bg-surface-overlay px-3 py-0.5 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                    {item.label}
                  </span>
                </div>
              );
            }

            if (item.kind === "system") {
              return (
                <div key={item.key} className="flex justify-center py-1">
                  <span className="rounded-full border border-border-default bg-surface-overlay px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
                    {item.msg.locked || item.msg.tombstoned ? placeholderFor(item.msg) : item.msg.body}
                  </span>
                </div>
              );
            }

            // Groups breathe with extra top margin on their first bubble; bubbles
            // within a group hug via the container's space-y-1.
            const startsGroup = item.groupPos === "single" || item.groupPos === "first";
            const parent =
              item.msg.kind === WtKind.Reply ? byId.get(item.msg.parentId) ?? null : null;

            const msgId = item.msg.id;
            return (
              <div
                key={item.key}
                data-msg-id={msgId}
                className={cn(
                  startsGroup && "mt-3",
                  highlightId === msgId && "rounded-2xl ring-2 ring-accent",
                )}
              >
                <MessageBubble
                  msg={item.msg}
                  parent={parent}
                  mine={item.mine}
                  groupPos={item.groupPos}
                  showMeta={item.showMeta}
                  menuScope={menuScope}
                  avatarSize={avatarSize}
                  connectedWallet={connectedWallet}
                  pinnedId={pinnedId}
                  canPin={canPinFor(item.msg)}
                  onReact={(emoji) => onToggleReaction(msgId, emoji, false)}
                  onUnreact={(emoji) => onToggleReaction(msgId, emoji, true)}
                  onReply={() => setReplyTarget(item.msg)}
                  onPin={() => void pin(msgId)}
                  onUnpin={() => void unpin()}
                  onDelete={() => void deleteMessage(msgId)}
                  onJumpTo={onJumpTo}
                />
              </div>
            );
          })
        )}
      </div>

      <div className="flex flex-col gap-1">
        {replyTarget ? (
          <div className="flex items-center gap-2 rounded-lg border-l-2 border-accent bg-surface-overlay py-1.5 pl-2.5 pr-2 text-xs">
            <Reply className="h-3.5 w-3.5 shrink-0 text-accent" aria-hidden />
            <span className="flex min-w-0 flex-1 flex-col leading-tight">
              <PlayerName
                playerPda={replyTargetPda}
                fallbackKey={replyTarget.senderWallet}
                className="truncate font-semibold text-accent"
              />
              <span className="truncate text-text-muted">
                {replyTarget.locked || replyTarget.tombstoned
                  ? placeholderFor(replyTarget)
                  : replyTarget.body}
              </span>
            </span>
            <button
              type="button"
              onClick={() => setReplyTarget(null)}
              aria-label="Cancel reply"
              className="shrink-0 rounded-full p-1 text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
            >
              <X className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
        ) : null}

        <div className="flex items-end gap-2">
          {/* Border + focus ring are set via inline style on purpose: the
              Tailwind border utilities here inherit the tier-accent var on
              :focus (the glaring orange outline). A fixed inline border stays
              calm, and outline: none suppresses the browser's blue default. */}
          <textarea
            id={threadPda.toBase58()}
            ref={textareaRef}
            value={draft}
            onChange={(e) => {
              // Clamp to the byte limit on input so the draft can never exceed
              // it (typing past the cap or pasting a long block is trimmed).
              setDraft(trimToByteLength(e.target.value, WT_MAX_TEXT_BYTES));
              autoGrow();
            }}
            onKeyDown={onKeyDown}
            disabled={!canPost || sending}
            rows={1}
            placeholder={canPost ? (placeholder ?? "write a message...") : "Read-only"}
            style={{ outline: "none" }}
            className={cn(
              "no-scrollbar min-h-10 max-h-32 flex-1 resize-none rounded-3xl border border-border-default bg-surface px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted",
              (!canPost || sending) && "cursor-not-allowed opacity-60",
              "focus:border-accent/40 focus:outline-none",
            )}
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!canPost || sending || draft.trim().length === 0 || overBudget}
            aria-label="Send message"
            className={cn(
              "flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-accent text-surface transition-opacity",
              "disabled:cursor-not-allowed disabled:opacity-40",
            )}
          >
            {sending ? (
              <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
            ) : (
              <SendHorizontal className="h-4 w-4" aria-hidden />
            )}
          </button>
        </div>
        {showByteCounter && (
          <p
            className={cn(
              "text-right text-[10px] tabular-nums",
              overBudget ? "text-danger" : "text-text-muted",
            )}
          >
            {remainingBytes} bytes left
          </p>
        )}
        {congested && (
          <p className="text-[10px] text-text-muted">
            Network fees are high right now; your message was sent at the capped priority fee.
          </p>
        )}
      </div>
    </div>
  );
}
