import { scoped } from "@/lib/graph/handler";
import { financeLedger } from "@/lib/graph/apps";
export const GET = scoped((ctx) => financeLedger(ctx));
