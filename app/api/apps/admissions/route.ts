import { scoped } from "@/lib/graph/handler";
import { admissionsPipeline } from "@/lib/graph/apps";
export const GET = scoped((ctx) => admissionsPipeline(ctx));
