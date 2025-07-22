import { jsonSchema, streamText, tool } from "ai";
import { model } from "~/lib/model";
import { searchSerper } from "~/serper";
import { systemPrompt } from "./system-prompt";

export const maxDuration = 60;

export async function POST(request: Request) {
  const { messages } = await request.json();

  if (!messages || !Array.isArray(messages) || messages.length === 0) {
    throw new Error("No messages provided");
  }

  const result = streamText({
    system: systemPrompt,
    model,
    messages,
    tools: {
      searchWeb: tool({
        description: "Search the web for information on a given topic",
        inputSchema: jsonSchema({
          type: "object",
          properties: {
            query: {
              type: "string",
              description: "The search query to look up on the web",
            },
          },
          required: ["query"],
        }),
        execute: async ({ query }: { query: string }, { abortSignal }) => {
          try {
            const results = await searchSerper({ q: query, num: 10 }, abortSignal);
            return {
              results: results.organic.map((r) => ({
                title: r.title,
                link: r.link,
                snippet: r.snippet,
              })),
            };
          } catch (err) {
            return {
              error:
                "Failed to search: " +
                (err instanceof Error ? err.message : "Unknown error"),
            };
          }
        },
      }),
    },
    maxRetries: 10,
  });

  return result.toUIMessageStreamResponse();
}
