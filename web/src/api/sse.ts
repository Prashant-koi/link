// Server-sent events over fetch (EventSource can't send cookies on every browser
// setting we care about, can't be aborted mid-stream, and can't POST).
export interface SseHandlers {
  [event: string]: (data: any) => void;
}

export async function streamSse(url: string, handlers: SseHandlers, signal?: AbortSignal): Promise<void> {
  const res = await fetch(url, { credentials: "include", signal });
  if (!res.ok || !res.body) {
    let code = `http_${res.status}`;
    try {
      code = ((await res.json()) as { error?: string }).error ?? code;
    } catch {
      // keep the status code
    }
    throw new Error(code);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let end: number;
    while ((end = buffer.indexOf("\n\n")) >= 0) {
      const block = buffer.slice(0, end);
      buffer = buffer.slice(end + 2);
      const event = /^event: (.+)$/m.exec(block)?.[1];
      const data = /^data: (.+)$/m.exec(block)?.[1];
      if (event && data && handlers[event]) handlers[event](JSON.parse(data));
    }
  }
}
