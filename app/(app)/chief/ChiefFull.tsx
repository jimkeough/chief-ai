"use client";

// The /chief route: the conversation as a full screen. It shares state with the
// launcher-opened sheet and leaves the persistent floating controls visible.

import { useChief } from "@/app/components/ChiefProvider";
import ChiefConversation from "@/app/components/ChiefConversation";

export default function ChiefFull() {
  const { messages, newChat, streaming } = useChief();
  return (
    <div
      className="fixed inset-x-0 bottom-0 z-20 mx-auto flex max-w-[480px] flex-col"
      style={{
        top: "calc(env(safe-area-inset-top) + 66px)",
        background: "var(--bg)",
        paddingBottom: "env(safe-area-inset-bottom)",
      }}
    >
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <div className="text-micro text-ink-3">CHIEF</div>
        {messages.length > 0 && (
          <button
            onClick={() => void newChat()}
            disabled={streaming}
            className="font-mono text-[11px] tracking-[0.08em] text-ink-3"
          >
            NEW CONVERSATION
          </button>
        )}
      </div>
      <ChiefConversation />
    </div>
  );
}
