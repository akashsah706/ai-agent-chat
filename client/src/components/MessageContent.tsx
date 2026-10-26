import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

function CodeBlock({ language, code }: { language: string; code: string }) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard allow nahi hua, kuch mat karo
    }
  }

  return (
    <div className="my-2 overflow-hidden rounded-lg bg-gray-900 text-gray-100">
      <div className="flex items-center justify-between bg-gray-800 px-3 py-1 text-xs text-gray-300">
        <span>{language}</span>
        <button onClick={handleCopy} className="hover:text-white">
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <pre className="overflow-x-auto p-3 text-sm">
        <code>{code}</code>
      </pre>
    </div>
  );
}

export default function MessageContent({ content }: { content: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      components={{
        // pre ko hum CodeBlock se handle karte hain, isliye yaha sirf pass-through
        pre: ({ children }) => <>{children}</>,
        code: ({ className, children }) => {
          const match = /language-(\w+)/.exec(className || "");
          const text = String(children).replace(/\n$/, "");

          // Language likhi ho ya multi-line ho toh code block, warna chhota inline code
          if (match || text.includes("\n")) {
            return <CodeBlock language={match?.[1] ?? "text"} code={text} />;
          }
          return (
            <code className="rounded bg-gray-300 px-1 py-0.5 text-[0.9em] dark:bg-gray-600">
              {children}
            </code>
          );
        },
        p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
        ul: ({ children }) => (
          <ul className="mb-2 list-disc pl-5">{children}</ul>
        ),
        ol: ({ children }) => (
          <ol className="mb-2 list-decimal pl-5">{children}</ol>
        ),
        a: ({ href, children }) => (
          <a
            href={href}
            target="_blank"
            rel="noreferrer"
            className="text-blue-600 underline dark:text-blue-400"
          >
            {children}
          </a>
        ),
        table: ({ children }) => (
          <div className="my-2 overflow-x-auto">
            <table className="min-w-full border text-sm">{children}</table>
          </div>
        ),
        th: ({ children }) => (
          <th className="border bg-gray-100 px-2 py-1 text-left dark:bg-gray-800">
            {children}
          </th>
        ),
        td: ({ children }) => <td className="border px-2 py-1">{children}</td>,
      }}
    >
      {content}
    </ReactMarkdown>
  );
}
