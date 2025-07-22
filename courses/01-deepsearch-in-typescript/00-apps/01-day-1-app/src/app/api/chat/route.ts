import {
  streamText,
  convertToModelMessages,
  tool,
  jsonSchema,
  stepCountIs,
} from "ai";
import { auth } from "~/server/auth";
import { db } from "~/server/db";
import { requestLogs, users } from "~/server/db/schema";
import { and, eq, gte, sql } from "drizzle-orm";
import { env } from "~/env";
import { model } from "~/lib/model";
import { systemPrompt } from "./system-prompt";
import { searchSerper } from "~/serper";

export const maxDuration = 60;

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user?.id) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  const [dbUser] = await db
    .select({ id: users.id, isAdmin: users.isAdmin })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!dbUser) {
    return new Response(JSON.stringify({ error: "User not found" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }
  const { messages } = await request.json();

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error("No messages provided");
  }

  // Rate limiting: count today's requests; admins bypass the limit.
  const DAILY_LIMIT = env.DAILY_REQUEST_LIMIT;
  if (!dbUser.isAdmin) {
    const rows = await db
      .select({ count: sql<number>`count(*)` })
      .from(requestLogs)
      .where(
        and(
          eq(requestLogs.userId, dbUser.id),
          gte(requestLogs.createdAt, sql`date_trunc('day', now())`),
        ),
      );
    const reqCount = Number(rows[0]?.count ?? 0);

    if (reqCount >= DAILY_LIMIT) {
      return new Response(
        JSON.stringify({ error: "Daily request limit reached" }),
        { status: 429, headers: { "content-type": "application/json" } },
      );
    }
  }

  // Record the request
  await db.insert(requestLogs).values({ userId: dbUser.id });

  const result = streamText({
    system: systemPrompt,
    model,
    messages: convertToModelMessages(messages),
    tools: {
      searchWeb: tool({
        description: "Search the web for information on a given topic",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The query to search the web for",
            },
          },
          required: ["query"],
        }),
        execute: async ({ query }: { query: string }, { abortSignal }) => {
          try {
            const results = await searchSerper(
              { q: query, num: 10 },
              abortSignal,
            );
            return results.organic.map((r) => ({
              title: r.title,
              link: r.link,
              snippet: r.snippet,
            }));
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            console.error("searchWeb tool error:", message);
            return [{ title: "Search error", link: "", snippet: message }];
          }
        },
      }),
    },
    toolChoice: "auto",
    maxRetries: 3,
    stopWhen: stepCountIs(10),
    // Debug hooks to help diagnose tool/step behavior
    includeRawChunks: true,
    onChunk: async (chunk) => {
      try {
        console.log(
          "[streamText] chunk:",
          typeof chunk === "string" ? chunk : JSON.stringify(chunk),
        );
      } catch (err) {
        console.log("[streamText] chunk (non-serializable)");
      }
    },
    onStepFinish: (step) => {
      try {
        console.log("[streamText] step finished:", JSON.stringify(step));
      } catch (err) {
        console.log("[streamText] step finished (non-serializable)");
      }
    },
    onFinish: (event) => {
      try {
        console.log("[streamText] finished:", JSON.stringify(event));
      } catch (err) {
        console.log("[streamText] finished (non-serializable)");
      }
    },
    onError: (err) => {
      console.error(
        "[streamText] error:",
        err instanceof Error ? err.message : String(err),
      );
    },
  });

  return result.toUIMessageStreamResponse();
}
