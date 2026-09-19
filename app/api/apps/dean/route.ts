import { scoped } from "@/lib/graph/handler";
import { deanDashboard } from "@/lib/graph/apps";
export const GET = scoped((ctx) => deanDashboard(ctx));
