import type { Message } from "ai";
import { appendResponseMessages, createDataStream } from "ai";
import { eq } from "drizzle-orm";
import { Langfuse } from "langfuse";
import { after } from "next/server";
import { createResumableStreamContext } from "resumable-stream/ioredis";
import { streamFromDeepSearch } from "~/deep-search";
import { Redis } from "ioredis";
import { env } from "~/env";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import {
  appendStreamId,
  getChat,
  getStreamIds,
  upsertChat,
} from "~/server/db/queries";
import { chats } from "~/server/db/schema";
import type { OurMessageAnnotation } from "~/types";

const streamContext = createResumableStreamContext({
  waitUntil: after,
  publisher: new Redis(env.REDIS_URL),
  subscriber: new Redis(env.REDIS_URL),
});

const langfuse = new Langfuse({
  environment: env.NODE_ENV,
});

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const body = (await request.json()) as {
    messages: Array<Message>;
    chatId?: string;
  };

  const { messages, chatId } = body;

  if (!messages.length) {
    return new Response("No messages provided", { status: 400 });
  }

  // If no chatId is provided, create a new chat with the user's message
  let currentChatId = chatId;
  if (!currentChatId) {
    const newChatId = crypto.randomUUID();

    currentChatId = newChatId;
  } else {
    // Verify the chat belongs to the user
    const chat = await db.query.chats.findFirst({
      where: eq(chats.id, currentChatId),
    });

    if (!chat || chat.userId !== session.user.id) {
      return new Response("Chat not found or unauthorized", { status: 404 });
    }
  }

  await upsertChat({
    userId: session.user.id,
    chatId: currentChatId,
    title: messages[messages.length - 1]!.content.slice(0, 50) + "...",
    messages: messages,
  });

  const trace = langfuse.trace({
    sessionId: currentChatId,
    name: "chat",
    userId: session.user.id,
  });

  const streamId = crypto.randomUUID();

  // Record this new stream so we can resume later
  await appendStreamId({ chatId: currentChatId, streamId });

  const stream = createDataStream({
    execute: async (dataStream) => {
      // If this is a new chat, send the chat ID to the frontend
      if (!chatId) {
        dataStream.writeData({
          type: "NEW_CHAT_CREATED",
          chatId: currentChatId,
        });
      }

      const annotations: OurMessageAnnotation[] = [];

      const result = await streamFromDeepSearch({
        messages,
        onFinish: async ({ response }) => {
          // Merge the existing messages with the response messages
          const updatedMessages = appendResponseMessages({
            messages,
            responseMessages: response.messages,
          });

          const lastMessage = updatedMessages[updatedMessages.length - 1];
          if (!lastMessage) {
            return;
          }

          // Add the annotations to the last message
          lastMessage.annotations = annotations;

          // Save the complete chat history
          await upsertChat({
            userId: session.user.id,
            chatId: currentChatId,
            title: lastMessage.content.slice(0, 50) + "...",
            messages: updatedMessages,
          });

          await langfuse.flushAsync();
        },
        langfuseTraceId: trace.id,
        writeMessageAnnotation: (annotation) => {
          // Save the annotation in-memory
          annotations.push(annotation);
          // Send it to the client
          dataStream.writeMessageAnnotation(annotation);
        },
      });

      result.mergeIntoDataStream(dataStream);

      // Consume the stream - without this,
      // we won't be able to resume the stream later
      await result.consumeStream();
    },
    onError: (e) => {
      console.error(e);
      return "Oops, an error occurred!";
    },
  });

  return new Response(
    await streamContext.resumableStream(streamId, () => stream),
  );
}

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const chatId = searchParams.get("chatId");

  const session = await auth();

  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  if (!chatId) {
    return new Response("chatId is required", { status: 400 });
  }

  const chat = await getChat({ chatId, userId: session.user.id });

  if (!chat) {
    return new Response("Chat not found", { status: 404 });
  }

  const { mostRecentStreamId, streamIds } = await getStreamIds({ chatId });

  if (!streamIds.length) {
    return new Response("No streams found", { status: 404 });
  }

  if (!mostRecentStreamId) {
    return new Response("No recent stream found", { status: 404 });
  }

  const emptyDataStream = createDataStream({
    execute: () => {},
  });

  const stream = await streamContext.resumableStream(
    mostRecentStreamId,
    () => emptyDataStream,
  );

  console.log("STREAM FOUND", stream);

  if (stream) {
    return new Response(stream, { status: 200 });
  }

  const mostRecentMessage = chat.messages.at(-1);

  if (!mostRecentMessage || mostRecentMessage.role !== "assistant") {
    return new Response(emptyDataStream, { status: 200 });
  }

  const streamWithMessage = createDataStream({
    execute: (buffer) => {
      buffer.writeData({
        type: "append-message",
        message: JSON.stringify(mostRecentMessage),
      });
    },
  });

  return new Response(streamWithMessage, { status: 200 });
}
