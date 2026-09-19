import { scoped } from "@/lib/graph/handler";
import { goals } from "@/lib/graph/apps";
export const GET = scoped((ctx) => goals(ctx));
