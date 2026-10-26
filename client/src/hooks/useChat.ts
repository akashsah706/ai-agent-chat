import { useEffect, useRef, useState } from "react";

export type ToolStep = {
  id: string;
  name: string;
  args: unknown;
  result?: string;
};

export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  tools: ToolStep[];
  isError?: boolean;
};

const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:5000";

const STORAGE_KEY = "ai-agent-chat-messages";

function loadMessages(): Message[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Message[]) : [];
  } catch {
    return [];
  }
}

export function useChat() {
  const [messages, setMessages] = useState<Message[]>(loadMessages);
  const [isLoading, setIsLoading] = useState(false);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (isLoading) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(messages));
    } catch {
      // storage full ya blocked ho toh chup raho
    }
  }, [messages, isLoading]);

  const updateLast = (fn: (m: Message) => Message) =>
    setMessages((prev) =>
      prev.length === 0
        ? prev
        : [...prev.slice(0, -1), fn(prev[prev.length - 1])],
    );

  async function sendMessage(text: string) {
    const clean = text.trim();
    if (!clean || isLoading) return;

    const userMsg: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: clean,
      tools: [],
    };
    const aiMsg: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      tools: [],
    };

    const history = [...messages, userMsg]
      .filter((m) => !m.isError && m.content)
      .map(({ role, content }) => ({ role, content }));

    setMessages((prev) => [...prev, userMsg, aiMsg]);
    setIsLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${API_URL}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: history }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Request failed");
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";

        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          const ev = JSON.parse(part.slice(6));

          if (ev.type === "token") {
            updateLast((m) => ({ ...m, content: m.content + ev.text }));
          } else if (ev.type === "tool_start") {
            updateLast((m) => ({
              ...m,
              tools: [...m.tools, { id: ev.id, name: ev.name, args: ev.args }],
            }));
          } else if (ev.type === "tool_result") {
            updateLast((m) => ({
              ...m,
              tools: m.tools.map((t) =>
                t.id === ev.id ? { ...t, result: ev.result } : t,
              ),
            }));
          } else if (ev.type === "error") {
            updateLast((m) => ({ ...m, content: ev.message, isError: true }));
          }
        }
      }
    } catch (err) {
      if (err instanceof DOMException && err.name === "AbortError") return;
      const msg = err instanceof Error ? err.message : "Something went wrong";
      updateLast((m) => ({ ...m, content: `Error: ${msg}`, isError: true }));
    } finally {
      setIsLoading(false);
      abortRef.current = null;
    }
  }

  function stop() {
    abortRef.current?.abort();
  }

  function clearChat() {
    abortRef.current?.abort();
    setMessages([]);
  }

  return { messages, isLoading, sendMessage, stop, clearChat };
}
