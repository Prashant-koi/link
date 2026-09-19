import { scoped } from "@/lib/graph/handler";
import { find_paths } from "@/lib/graph/tools";

export const POST = scoped((ctx, body) =>
  find_paths(ctx, {
    from_node_id: String(body.from_node_id ?? ctx.personId),
    to_node_id: body.to_node_id as string | undefined,
    to_label: body.to_label as string | undefined,
    max_depth: body.max_depth ? Number(body.max_depth) : undefined,
  }),
);
export const GET = POST;
