/**
 * OpenAI-compatible chat client. Points at vLLM in production:
 *   vllm serve Qwen/Qwen2.5-14B-Instruct --enable-auto-tool-choice \
 *     --tool-call-parser hermes --port 8000
 *
 * LLM_BASE_URL unset => isLLMConfigured() is false and the agent loop falls
 * back to a deterministic planner, so the whole app still demos without a GPU.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
  name?: string;
}

export interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

export interface ToolSchema {
  type: "function";
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export function isLLMConfigured(): boolean {
  return Boolean(process.env.LLM_BASE_URL);
}

function baseUrl(): string {
  return (process.env.LLM_BASE_URL || "").replace(/\/$/, "");
}

export async function chat(
  messages: ChatMessage[],
  tools?: ToolSchema[],
  opts: { temperature?: number; signal?: AbortSignal } = {},
): Promise<ChatMessage> {
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.LLM_API_KEY || "not-needed"}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      messages,
      ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
      temperature: opts.temperature ?? 0.2,
      max_tokens: 800,
    }),
    signal: opts.signal,
  });

  if (!res.ok) {
    throw new Error(`LLM ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const json = await res.json();
  return json.choices?.[0]?.message as ChatMessage;
}

/** Token stream of the final, grounded answer. */
export async function* streamChat(
  messages: ChatMessage[],
  opts: { temperature?: number; signal?: AbortSignal } = {},
): AsyncGenerator<string> {
  const res = await fetch(`${baseUrl()}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${process.env.LLM_API_KEY || "not-needed"}`,
    },
    body: JSON.stringify({
      model: process.env.LLM_MODEL,
      messages,
      stream: true,
      temperature: opts.temperature ?? 0.3,
      max_tokens: 800,
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    throw new Error(`LLM stream ${res.status}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") return;
      try {
        const delta = JSON.parse(payload).choices?.[0]?.delta?.content;
        if (delta) yield delta as string;
      } catch {
        /* keep-alive or partial frame; ignore */
      }
    }
  }
}
