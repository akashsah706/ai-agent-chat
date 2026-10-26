require("dotenv").config();
const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const rateLimit = require("express-rate-limit");

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const MODEL = "openai/gpt-oss-120b";
const MAX_STEPS = 5;

const app = express();

app.set("trust proxy", 1); // Render jaise hosting ke peeche asli IP padhne ke liye

// Sirf apni website backend ko call kar sake
const allowedOrigin = process.env.FRONTEND_URL || "http://localhost:5173";
app.use(cors({ origin: allowedOrigin }));

app.use(express.json({ limit: "1mb" }));

app.get("/", (req, res) => {
  res.send("AI Chat Backend is running!");
});

const tools = [
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Evaluate a math expression like (12*5)/3",
      parameters: {
        type: "object",
        properties: { expression: { type: "string" } },
        required: ["expression"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get the current weather of a city",
      parameters: {
        type: "object",
        properties: { city: { type: "string" } },
        required: ["city"],
      },
    },
  },
];

async function runTool(name, args) {
  try {
    if (name === "calculator") {
      const expr = String(args.expression ?? "");
      if (!/^[0-9+\-*/().%\s]+$/.test(expr)) return "Invalid expression";
      return String(Function(`"use strict"; return (${expr})`)());
    }

    if (name === "get_weather") {
      const geoRes = await fetch(
        `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(args.city)}&count=1`,
      );
      const geo = await geoRes.json();
      const place = geo.results?.[0];
      if (!place) return "City not found";

      const wRes = await fetch(
        `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}&current=temperature_2m,wind_speed_10m`,
      );
      const w = await wRes.json();
      return JSON.stringify({ city: place.name, ...w.current });
    }

    return "Unknown tool";
  } catch {
    return "Tool failed";
  }
}

// Ek IP se 1 minute mein limit se zyada requests nahi
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10, // TEST ke liye 3. Test ke baad isse 10 kar dena
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many requests. Please wait a minute and try again." },
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  const { messages } = req.body;

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({ error: "messages array is required" });
  }

  

  // Limit sirf user ke likhe message pe, AI ke jawab pe nahi
  const invalid = messages.some(
    (m) =>
      typeof m.content !== "string" ||
      (m.role !== "user" && m.role !== "assistant"),
  );
  if (invalid) {
    return res.status(400).json({ error: "Invalid message format" });
  }

  const tooLong = messages.some(
    (m) => m.role === "user" && m.content.length > 4000,
  );
  if (tooLong) {
    return res.status(400).json({ error: "Your message is too long" });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({ error: "GROQ_API_KEY is missing in .env" });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
  });

  const send = (obj) => res.write(`data: ${JSON.stringify(obj)}\n\n`);

  const controller = new AbortController();
  res.on("close", () => controller.abort());

  const convo = [
    {
      role: "system",
      content:
        "You are a helpful assistant. Use the tools when they help. Reply in the same language as the user.",
    },
    ...messages.slice(-20), // sirf aakhri 20 messages, token bachane ke liye
  ];

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = await client.chat.completions.create(
        { model: MODEL, messages: convo, tools, stream: true },
        { signal: controller.signal },
      );

      let content = "";
      const calls = {};

      for await (const chunk of stream) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          send({ type: "token", text: delta.content });
        }

        for (const tc of delta.tool_calls ?? []) {
          const c = (calls[tc.index] ??= { id: "", name: "", args: "" });
          if (tc.id) c.id = tc.id;
          if (tc.function?.name) c.name = tc.function.name;
          if (tc.function?.arguments) c.args += tc.function.arguments;
        }
      }

      const list = Object.values(calls);
      if (list.length === 0) break;

      convo.push({
        role: "assistant",
        content: content || null,
        tool_calls: list.map((c) => ({
          id: c.id,
          type: "function",
          function: { name: c.name, arguments: c.args },
        })),
      });

      for (const c of list) {
        let args = {};
        try {
          args = JSON.parse(c.args || "{}");
        } catch {}

        send({ type: "tool_start", id: c.id, name: c.name, args });
        const result = await runTool(c.name, args);
        send({ type: "tool_result", id: c.id, name: c.name, result });
        convo.push({ role: "tool", tool_call_id: c.id, content: result });
      }
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error("Chat error:", error.message);
      send({
        type: "error",
        message: "AI request failed. Check your API key.",
      });
    }
  }

  if (!res.writableEnded) {
    send({ type: "done" });
    res.end();
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});
