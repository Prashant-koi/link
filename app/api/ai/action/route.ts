import { scoped } from "@/lib/graph/handler";
import { add_to_calendar, draft_intro_email, generate_checklist } from "@/lib/graph/tools";
import type { Scope } from "@/lib/auth/roles";

/**
 * Agentic actions, invoked after the user confirms in the UI. Capability checks
 * live inside the tools, not here — the API is not the gate.
 */
export const POST = scoped(async (ctx: Scope, body) => {
  switch (body.action) {
    case "draft_intro_email":
      return draft_intro_email(ctx, {
        person_id: String(body.person_id),
        context: body.context as string | undefined,
      });
    case "add_to_calendar":
      return add_to_calendar(ctx, { event_id: String(body.event_id) });
    case "generate_checklist":
      return generate_checklist(ctx, {
        goal_id: body.goal_id as string | undefined,
        application_id: body.application_id as string | undefined,
      });
    default:
      throw new Error(`unknown action ${String(body.action)}`);
  }
});
