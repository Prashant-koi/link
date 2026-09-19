import { scoped } from "@/lib/graph/handler";
import { courseFolders } from "@/lib/graph/apps";
export const GET = scoped((ctx) => courseFolders(ctx));
