import { scoped } from "@/lib/graph/handler";
import { hrRoster } from "@/lib/graph/apps";
export const GET = scoped((ctx) => hrRoster(ctx));
