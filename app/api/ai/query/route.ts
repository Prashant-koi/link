import { scopeFromRequest, unauthorized } from "@/lib/auth/session";
import { runAgent } from "@/lib/ai/agent";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** SSE stream of agent events: tool calls, tokens, and the rendered subgraph. */
export async function POST(req: Request) {
  const ctx = await scopeFromRequest(req);
  if (!ctx) return unauthorized();

  const { query } = (await req.json()) as { query?: string };
  if (!query?.trim()) return Response.json({ error: "query required" }, { status: 400 });

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (event: unknown) =>
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      try {
        for await (const event of runAgent(ctx, query)) {
          console.log(`[ai] ${ctx.personId}/${ctx.role}`, event.type, "name" in event ? event.name : "");
          send(event);
        }
      } catch (e) {
        send({ type: "error", text: (e as Error).message });
        send({ type: "done" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
    },
  });
}
