"use client";

import { useSession } from "next-auth/react";
import { useChat } from '@ai-sdk/react'
import { Loader2 } from "lucide-react";
import { ChatMessage } from "~/components/chat-message";
import { SignInModal } from "~/components/sign-in-modal";
import { useState } from "react";

interface ChatProps {
  userName: string;
}

export const ChatPage = ({ userName }: ChatProps) => {
  const { data: session } = useSession();
  const isAuthenticated = !!session?.user;

  const [showSignInModal, setShowSignInModal] = useState(false);

  const {
    messages,               // [{ id, role, content }, …]  – auto-updated
    input,                  // local input value
    handleInputChange,      // onChange handler for <input>
    handleSubmit,           // std. onSubmit handler (sends request)
    append,                 // helper to push a user message programmatically
    isLoading               // true while a request is inflight
  } = useChat({
    api: "/api/chat",       // your route
    streamProtocol: "data", // redundant (default), included for clarity
    onError(error) {
      // optional global error handler
      console.error(error);
    }
  });

  // Wrap the hook’s handleSubmit so we can block unauthenticated users
  const onFormSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    if (!isAuthenticated) {
      setShowSignInModal(true);
      return;
    }

    await handleSubmit(e);  // will call the route, stream, etc.
  };

  return (
    <>
      <div className="flex flex-1 flex-col">
        <div
          className="mx-auto w-full max-w-[65ch] flex-1 overflow-y-auto p-4 scrollbar-thin scrollbar-track-gray-800 scrollbar-thumb-gray-600 hover:scrollbar-thumb-gray-500"
          role="log"
          aria-label="Chat messages"
        >
          {messages.map(({ id, role, content }) => (
            <ChatMessage
              key={id}
              text={content}
              role={role}
              userName={userName}
            />
          ))}
        </div>

        <div className="border-t border-gray-700">
          <form
            onSubmit={onFormSubmit}
            className="mx-auto max-w-[65ch] p-4"
          >
            <div className="flex gap-2">
              <input
                value={input}
                onChange={handleInputChange}
                placeholder={
                  isAuthenticated
                    ? "Say something..."
                    : "Sign in to start chatting..."
                }
                autoFocus
                aria-label="Chat input"
                disabled={isLoading || !isAuthenticated}
                className="flex-1 rounded border border-gray-700 bg-gray-800 p-2 text-gray-200 placeholder-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50"
              />
              <button
                type="submit"
                disabled={isLoading || !input.trim() || !isAuthenticated}
                className="rounded bg-gray-700 px-4 py-2 text-white hover:bg-gray-600 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-blue-400 disabled:opacity-50 disabled:hover:bg-gray-700"
              >
                {isLoading ? (
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
