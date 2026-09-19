import { scoped } from "@/lib/graph/handler";
import { search_nodes } from "@/lib/graph/tools";

export const POST = scoped((ctx, body) =>
  search_nodes(ctx, {
    query_terms: String(body.query_terms ?? body.q ?? ""),
    labels: body.labels as string[] | undefined,
    limit: body.limit as number | undefined,
  }),
);
export const GET = POST;
