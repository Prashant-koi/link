import { scoped } from "@/lib/graph/handler";
import { nodes_by_interest } from "@/lib/graph/tools";

export const POST = scoped((ctx, body) =>
  nodes_by_interest(ctx, {
    interest_names: (body.interest_names as string[]) ?? String(body.interests ?? "").split(",").filter(Boolean),
    target_labels: body.target_labels as string[] | undefined,
    expand_subfields: body.expand_subfields !== false,
    limit: body.limit ? Number(body.limit) : undefined,
  }),
);
export const GET = POST;
