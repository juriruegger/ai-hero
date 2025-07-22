"use client";

import { useSession } from "next-auth/react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport, type UIMessage, isToolUIPart } from "ai";
import { Loader2, AlertTriangle, Search, ChevronDown } from "lucide-react";
import { ChatMessage } from "~/components/chat-message";
import { SignInModal } from "~/components/sign-in-modal";
import { useEffect, useRef, useState } from "react";

function Collapse({ open, children }: { open: boolean; children: React.ReactNode }) {
  const innerRef = useRef<HTMLDivElement | null>(null);
  const [height, setHeight] = useState<number>(0);

  useEffect(() => {
    if (innerRef.current) {
      // Measure content height whenever open state or children change
      setHeight(innerRef.current.scrollHeight);
    }
  }, [open, children]);

  return (
    <div
      className="overflow-hidden transition-all duration-300 ease-out"
      style={{ maxHeight: open ? height : 0, opacity: open ? 1 : 0.4 }}
      aria-hidden={!open}
    >
      <div ref={innerRef}>{children}</div>
    </div>
  );
}

interface ChatProps {
  userName: string;
}

export const ChatPage = ({ userName }: ChatProps) => {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  const [showSignInModal, setShowSignInModal] = useState(false);
  const [input, setInput] = useState("");
  const [expandedResults, setExpandedResults] = useState<Record<string, boolean>>({});

  const { messages, sendMessage, status, error } = useChat({
    transport: new DefaultChatTransport({ api: "/api/chat" }),
    onError(error: Error) {
      // optional global error handler
      console.error(error);
    },
  });

  // Handle form submission with authentication check
  const onFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input?.trim() || status === "streaming" || status === "submitted")
      return;

    if (!isAuthenticated) {
      setShowSignInModal(true);
      return;
    }

    await sendMessage({ text: input });
    setInput("");
  };

  return (
    <>
      <div className="flex flex-1 flex-col">
        {(status === "error" || error) && (
          <div className="mx-auto w-full max-w-[65ch] p-4">
            <div className="rounded border border-red-600 bg-red-900/30 p-3 text-red-300">
              <div className="mb-1 flex items-center gap-2">
                <AlertTriangle className="size-4" />
                <span className="font-medium">Request failed</span>
              </div>
              <div className="text-sm opacity-90">
                {error?.message ?? "Unknown error"}
              </div>
            </div>
          </div>
        )}
        <div
          className="mx-auto w-full max-w-[65ch] flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600 hover:scrollbar-thumb-gray-500"
          role="log"
          aria-label="Chat messages"
        >
          {messages.map((message: UIMessage) => {
            let text = "";
            let toolInfo: string | null = null;
            let toolRunning = false;
            let toolParts: any[] = [];

            if (message.parts) {
              const textPart = message.parts.find((p) => p.type === "text");
              if (textPart && "text" in textPart)
                text = (textPart as any).text ?? "";

              toolParts = message.parts.filter((p) => isToolUIPart(p as any)) as any[];
              if (toolParts.length > 0) {
                const summaries: string[] = [];
                for (const tp of toolParts) {
                  const toolName = String(tp.type).replace(/^tool-/, "");
                  const count = Array.isArray(tp.output) ? tp.output.length : undefined;
                  summaries.push(
                    `Used: ${toolName}${count != null ? ` (${count} result${count === 1 ? "" : "s"})` : ""}`,
                  );
                  if (tp.state === "input-streaming" || tp.state === "input-available") {
                    toolRunning = true;
                  }
                }
                toolInfo = summaries.join(" · ");
              }
            }

            return (
              <div key={message.id}>
                {toolRunning && (
                  <div className="mb-2 flex items-center gap-2 text-sm text-gray-400">
                    <svg
                      className="size-4 animate-spin"
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                    >
                      <circle
                        cx="12"
                        cy="12"
                        r="10"
                        strokeWidth="3"
                        opacity="0.2"
                      ></circle>
                      <path d="M22 12a10 10 0 0 1-10 10" strokeWidth="3"></path>
                    </svg>
                    <span>Searching the web…</span>
                  </div>
                )}

                {toolInfo && (
                  <div className="mb-1 text-xs text-gray-500">{toolInfo}</div>
                )}

                {/* Render tool outputs for all tool calls */}
                {toolParts.map((tp: any, index: number) => {
                  const key = `${message.id}-${index}`;
                  const toolName = String(tp.type).replace(/^tool-/, "");
                  const count = Array.isArray(tp.output) ? tp.output.length : 0;
                  const hasList = Array.isArray(tp.output) && tp.output.length > 0;
                  return (
                    <div
                      key={key}
                      className="mb-4 rounded border border-gray-700 bg-gray-800/60 shadow-sm transition-all hover:shadow-md hover:shadow-black/20"
                    >
                      <div className="flex items-center justify-between border-b border-gray-700 px-3 py-2 text-xs uppercase tracking-wide text-gray-400">
                        <div className="flex items-center gap-2">
                          <Search className="size-3.5" />
                          <span>{toolName} results</span>
                          <span className="ml-2 rounded bg-gray-700 px-1.5 py-0.5 text-[10px] normal-case text-gray-300">
                            {count} result{count === 1 ? "" : "s"}
                          </span>
                        </div>
                        {hasList && (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedResults((prev) => ({
                                ...prev,
                                [key]: !prev[key],
                              }))
                            }
                            aria-expanded={!!expandedResults[key]}
                            className="inline-flex items-center gap-1 rounded px-2 py-1 text-[11px] text-gray-300 transition-colors hover:bg-gray-700/60"
                          >
                            <span className="mr-1">{expandedResults[key] ? "Hide" : "Show"}</span>
                            <ChevronDown
                              className={`size-3 transition-transform ${expandedResults[key] ? "rotate-180" : "rotate-0"}`}
                            />
                          </button>
                        )}
                      </div>
                      {hasList && (
                        <Collapse open={!!expandedResults[key]}>
                          <ul className="divide-y divide-gray-700">
                          {tp.output.map((item: any, idx: number) => {
                            const title = item?.title ?? item?.name ?? `Result ${idx + 1}`;
                            const link = item?.link ?? item?.url ?? "";
                            const snippet = item?.snippet ?? item?.description ?? "";
                            const isError = title === "Search error" || !link;
                            return (
                              <li key={idx} className="px-3 py-2 transition-colors hover:bg-gray-800/80">
                                <div className="flex flex-col gap-1">
                                  <div className="text-sm font-medium text-blue-300">
                                    {link ? (
                                      <a
                                        href={link}
                                        target="_blank"
                                        rel="noreferrer noopener"
                                        className="hover:underline"
                                      >
                                        {title}
                                      </a>
                                    ) : (
                                      <span className="text-red-300">{title}</span>
                                    )}
                                  </div>
                                  {snippet && (
                                    <div className={`text-xs ${isError ? "text-red-300" : "text-gray-300"}`}>
                                      {snippet}
                                    </div>
                                  )}
                                  {link && (
                                    <div className="text-[11px] text-gray-500 break-all">{link}</div>
                                  )}
                                </div>
                              </li>
                            );
                          })}
                          </ul>
                        </Collapse>
                      )}
                    </div>
                  );
                })}

                <ChatMessage
                  text={text}
                  role={message.role}
                  userName={userName}
                />
              </div>
            );
          })}
        </div>

        <div className="border-t border-gray-700">
          <form onSubmit={onFormSubmit} className="mx-auto max-w-[65ch] p-4">
            <div className="flex gap-2">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder={
                  isAuthenticated
                    ? "Say something..."
                    : "Sign in to start chatting..."
                }
                autoFocus
                aria-label="Chat input"
                disabled={
                  status === "streaming" ||
                  status === "submitted" ||
                  !isAuthenticated
                }
                className="flex-1 rounded border border-gray-700 bg-gray-800 p-2 text-gray-200 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={
                  status === "streaming" ||
                  status === "submitted" ||
                  !input.trim() ||
                  !isAuthenticated
                }
                className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:hover:bg-gray-700"
              >
                {status === "streaming" || status === "submitted" ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  "Send"
                )}
              </button>
            </div>
          </form>
        </div>
      </div>

      <SignInModal
        isOpen={showSignInModal}
        onClose={() => setShowSignInModal(false)}
      />
    </>
  );
};
