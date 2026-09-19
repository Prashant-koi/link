import { scopeFromRequest, unauthorized } from "@/lib/auth/session";
import { isLLMConfigured } from "@/lib/ai/client";

export async function GET(req: Request) {
  const scope = await scopeFromRequest(req);
  if (!scope) return unauthorized();
  return Response.json({ scope, llm: { configured: isLLMConfigured(), model: process.env.LLM_MODEL ?? null } });
}
