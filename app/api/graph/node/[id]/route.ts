import { scopeFromRequest, unauthorized } from "@/lib/auth/session";
import { summarize_neighborhood } from "@/lib/graph/tools";
import { ScopeError } from "@/lib/graph/types";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const ctx = await scopeFromRequest(req);
  if (!ctx) return unauthorized();
  const { id } = await params;
  try {
    return Response.json(await summarize_neighborhood(ctx, { node_id: id }));
  } catch (e) {
    if (e instanceof ScopeError) return Response.json({ error: e.message }, { status: 403 });
    return Response.json({ error: (e as Error).message }, { status: 500 });
  }
}
