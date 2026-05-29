"use client";

// Composer: the war-table compose bar. Auto-growing textarea, send button,
// reply chip, UTF-8 byte counter, and congestion notice. Controlled: the parent
// (ThreadRenderer) owns the draft, the in-flight state, and the transport, so
// the composer can be portaled into the mobile morph bar and back without losing
// the draft (a portal flip remounts this element, but the draft lives above it).

import { useLayoutEffect, useMemo, useRef } from "react";
import { SendHorizontal, LoaderCircle, Reply, X } from "lucide-react";
import { WT_MAX_TEXT_BYTES } from "novus-mundus-sdk";
import type { WtMessage } from "@/lib/store/war-table";
import { cn } from "@/lib/utils";
import { PlayerName } from "@/components/war-table/PlayerName";
import { placeholderFor, useSenderIdentity } from "@/components/war-table/MessageBubble";

// Show the byte counter once the draft is within this many bytes of the limit.
const BYTE_COUNTER_NEAR = 40;

// UTF-8 byte length of a string. The war-table limit is on BYTES, not chars: a
// 4-byte emoji costs 4. Shared by the live counter and the input clamp.
const utf8Encoder = new TextEncoder();
function utf8ByteLength(s: string): number {
  return utf8Encoder.encode(s).length;
}

// Trim a string to at most maxBytes UTF-8 bytes without splitting a multi-byte
// code point. Clamps paste/typing that would exceed the limit.
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

export interface ComposerProps {
  // Current draft text. Owned by the parent so it survives the composer being
  // portaled between the inline slot and the morph bar.
  draft: string;
  // Set the draft. The composer clamps to the byte limit before calling this.
  onDraftChange: (next: string) => void;
  // Send the current draft. The parent reads its own draft, posts, and clears it
  // on success; a failure leaves the draft for retry.
  onSubmit: () => void;
  // True while a send is in flight (drives the spinner + disabled state).
  sending: boolean;
  // false = read-only access: textarea + send disabled, "Read-only" placeholder.
  canPost: boolean;
  // Placeholder while postable; required (the caller resolves any default).
  placeholder: string;
  // The message being replied to, or null. Owned by the parent (set from a
  // bubble's onReply). Drives the reply chip.
  replyTarget: WtMessage | null;
  // Clear the reply target (chip dismiss).
  onClearReply: () => void;
  // useWarTable.congested: drives the high-fee notice line.
  congested: boolean;
  // Stable id for the <textarea>. The parent passes threadPda.toBase58().
  threadId: string;
}

export function Composer({
  draft,
  onDraftChange,
  onSubmit,
  sending,
  canPost,
  placeholder,
  replyTarget,
  onClearReply,
  congested,
  threadId,
}: ComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Resolve the reply target's PlayerAccount PDA from its wallet (same
  // derivation the bubbles use) so the chip names the player via PlayerName.
  // useSenderIdentity tolerates an empty string (returns null) when no target.
  const replyTargetPda = useSenderIdentity(replyTarget?.senderWallet ?? "");

  const draftBytes = useMemo(() => utf8ByteLength(draft), [draft]);
  const remainingBytes = WT_MAX_TEXT_BYTES - draftBytes;
  const overBudget = remainingBytes < 0;
  const showByteCounter = remainingBytes <= BYTE_COUNTER_NEAR;

  // Auto-grow the textarea to fit the draft up to the max-height cap, then let it
  // scroll. Runs on every draft change (typing, the send-clear, or a fresh mount
  // after a portal flip) so the height always matches the controlled value.
  useLayoutEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  function onKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter inserts a newline.
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      onSubmit();
    }
  }

  return (
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
            onClick={onClearReply}
            aria-label="Cancel reply"
            className="shrink-0 rounded-full p-1 text-text-muted transition-colors hover:bg-surface hover:text-text-primary"
          >
            <X className="h-3.5 w-3.5" aria-hidden />
          </button>
        </div>
      ) : null}

      <div className="flex items-end gap-2">
        {/* Border + focus ring are set via inline style on purpose: the Tailwind
            border utilities here inherit the tier-accent var on :focus (the
            glaring orange outline). A fixed inline border stays calm, and
            outline: none suppresses the browser's blue default. */}
        <textarea
          id={threadId}
          ref={textareaRef}
          value={draft}
          onChange={(e) => onDraftChange(trimToByteLength(e.target.value, WT_MAX_TEXT_BYTES))}
          onKeyDown={onKeyDown}
          disabled={!canPost || sending}
          rows={1}
          placeholder={canPost ? placeholder : "Read-only"}
          style={{ outline: "none" }}
          className={cn(
            "no-scrollbar min-h-10 max-h-32 flex-1 resize-none rounded-3xl border border-border-default bg-surface px-4 py-2.5 text-sm text-text-primary placeholder:text-text-muted",
            (!canPost || sending) && "cursor-not-allowed opacity-60",
            "focus:border-accent/40 focus:outline-none",
          )}
        />
        <button
          type="button"
          onClick={onSubmit}
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
  );
}
