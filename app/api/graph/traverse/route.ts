import { scoped } from "@/lib/graph/handler";
import { traverse } from "@/lib/graph/tools";

export const POST = scoped((ctx, body) =>
  traverse(ctx, {
    from_node_id: String(body.from_node_id ?? body.id ?? ""),
    edge_types: body.edge_types as string[] | undefined,
    depth: body.depth ? Number(body.depth) : undefined,
    limit: body.limit ? Number(body.limit) : undefined,
  }),
);
export const GET = POST;
