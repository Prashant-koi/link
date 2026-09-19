import { scoped } from "@/lib/graph/handler";
import { calendar } from "@/lib/graph/apps";
export const GET = scoped((ctx, body) =>
  calendar(ctx, { offeringId: body.offeringId as string | undefined, query: body.q as string | undefined }),
);
