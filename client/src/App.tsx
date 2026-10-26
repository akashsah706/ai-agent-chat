import { useEffect, useRef, useState } from "react";
import { useChat } from "./hooks/useChat";
import { useTheme } from "./hooks/useTheme";
import MessageContent from "./components/MessageContent";

const EXAMPLES = [
  "What's the weather in Delhi?",
  "What is (245 * 18) + 99?",
  "Compare the temperature of Mumbai and Delhi",
];

function App() {
  const { messages, isLoading, sendMessage, stop, clearChat } = useChat();
  const { theme, toggle } = useTheme();
  const [input, setInput] = useState("");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  function handleSend(text: string = input) {
    if (!text.trim() || isLoading) return;
    sendMessage(text);
    setInput("");
  }

  const last = messages[messages.length - 1];

  return (
    <div className="mx-auto flex h-dvh max-w-2xl flex-col p-3 sm:p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h1 className="text-xl font-bold sm:text-2xl">AI Agent Chat</h1>
          <p className="text-xs text-gray-500 dark:text-gray-400 sm:text-sm">
            Streaming responses + tool calling
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {messages.length > 0 && (
            <button
              onClick={clearChat}
              className="rounded-lg border px-3 py-1 text-sm text-gray-600 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
            >
              Clear
            </button>
          )}
          <button
            onClick={toggle}
            aria-label="Toggle dark mode"
            className="rounded-lg border px-3 py-1 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
          >
            {theme === "dark" ? "☀️" : "🌙"}
          </button>
        </div>
      </header>

      <div className="flex-1 space-y-3 overflow-y-auto">
        {messages.length === 0 && (
          <div className="mt-10 text-center">
            <p className="mb-4 text-gray-500 dark:text-gray-400">Try asking:</p>
            <div className="flex flex-col items-center gap-2">
              {EXAMPLES.map((ex) => (
                <button
                  key={ex}
                  onClick={() => handleSend(ex)}
                  className="rounded-full border px-4 py-2 text-sm hover:bg-gray-100 dark:border-gray-600 dark:hover:bg-gray-800"
                >
                  {ex}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}
          >
            <div className="min-w-0 max-w-[92%] sm:max-w-[85%]">
              {msg.tools.map((t) => (
                <div
                  key={t.id}
                  className="mb-1 break-words rounded border border-yellow-200 bg-yellow-50 px-2 py-1 text-xs text-yellow-900 dark:border-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-100"
                >
                  🔧 {t.name}({JSON.stringify(t.args)}){" "}
                  {t.result ? `→ ${t.result}` : "⏳ running..."}
                </div>
              ))}

              {(msg.content || msg.role === "user") && (
                <div
                  className={`break-words rounded-2xl px-4 py-2 ${
                    msg.role === "user"
                      ? "whitespace-pre-wrap bg-blue-600 text-white"
                      : msg.isError
                        ? "bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-200"
                        : "bg-gray-200 text-gray-900 dark:bg-gray-700 dark:text-gray-100"
                  }`}
                >
                  {msg.role === "assistant" && !msg.isError ? (
                    <MessageContent content={msg.content} />
                  ) : (
                    msg.content
                  )}
                </div>
              )}
            </div>
          </div>
        ))}

        {isLoading && last?.content === "" && last?.tools.length === 0 && (
          <p className="text-sm text-gray-500 dark:text-gray-400">
            AI is thinking...
          </p>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="min-w-0 flex-1 rounded-lg border bg-white px-3 py-2 text-base dark:border-gray-600 dark:bg-gray-800"
          type="text"
          placeholder="Type your message..."
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSend();
          }}
          disabled={isLoading}
        />
        {isLoading ? (
          <button
            onClick={stop}
            className="rounded-lg bg-red-600 px-4 py-2 text-white"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={() => handleSend()}
            className="rounded-lg bg-blue-600 px-4 py-2 text-white disabled:opacity-50"
            disabled={!input.trim()}
          >
            Send
          </button>
        )}
      </div>
    </div>
  );
}

export default App;