import { scoped } from "@/lib/graph/handler";
import { recommend_for_person } from "@/lib/graph/tools";

export const POST = scoped((ctx, body) =>
  recommend_for_person(ctx, {
    person_id: (body.person_id as string) ?? ctx.personId,
    target_labels: body.target_labels as string[] | undefined,
    limit: body.limit ? Number(body.limit) : undefined,
  }),
);
export const GET = POST;
