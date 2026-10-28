
require("dotenv").config();

const express = require("express");
const cors = require("cors");
const OpenAI = require("openai");
const rateLimit = require("express-rate-limit");

const app = express();

app.set("trust proxy", 1);

const client = new OpenAI({
  apiKey: process.env.GROQ_API_KEY,
  baseURL: "https://api.groq.com/openai/v1",
});

const MODEL = "openai/gpt-oss-120b";
const MAX_STEPS = 5;
const WEATHER_TIMEOUT_MS = 15000;

const allowedOrigin =
  process.env.FRONTEND_URL || "http://localhost:5173";

app.use(cors({ origin: allowedOrigin }));
app.use(express.json({ limit: "1mb" }));

app.get("/", (_req, res) => {
  res.send("AI Chat Backend is running!");
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const tools = [
  {
    type: "function",
    function: {
      name: "calculator",
      description: "Calculate a basic math expression.",
      parameters: {
        type: "object",
        properties: {
          expression: { type: "string" },
        },
        required: ["expression"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_weather",
      description: "Get current weather for a city.",
      parameters: {
        type: "object",
        properties: {
          city: { type: "string" },
        },
        required: ["city"],
        additionalProperties: false,
      },
    },
  },
];

// Basic arithmetic parser; does not execute arbitrary JavaScript.
function calculate(expression) {
  const input = String(expression || "").replace(/\s/g, "");

  if (!input || !/^[\d.+\-*/()%]+$/.test(input)) {
    throw new Error("Invalid arithmetic expression.");
  }

  const tokens = input.match(/\d+(?:\.\d+)?|[()+\-*/%]/g);

  if (!tokens || tokens.join("") !== input) {
    throw new Error("Invalid arithmetic expression.");
  }

  let index = 0;

  function factor() {
    const token = tokens[index++];

    if (token === "+") return factor();
    if (token === "-") return -factor();

    if (token === "(") {
      const result = expressionParser();

      if (tokens[index++] !== ")") {
        throw new Error("Missing closing parenthesis.");
      }

      return result;
    }

    const number = Number(token);

    if (!Number.isFinite(number)) {
      throw new Error("Invalid number.");
    }

    return number;
  }

  function term() {
    let value = factor();

    while (["*", "/", "%"].includes(tokens[index])) {
      const operator = tokens[index++];
      const right = factor();

      if (operator === "*") value *= right;
      if (operator === "/") value /= right;
      if (operator === "%") value %= right;
    }

    return value;
  }

  function expressionParser() {
    let value = term();

    while (tokens[index] === "+" || tokens[index] === "-") {
      const operator = tokens[index++];
      const right = term();

      value = operator === "+" ? value + right : value - right;
    }

    return value;
  }

  const result = expressionParser();

  if (index !== tokens.length || !Number.isFinite(result)) {
    throw new Error("Invalid calculation.");
  }

  return result;
}

async function fetchWeatherJson(url, label) {
  console.log(`[Weather] Requesting ${label}`);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(WEATHER_TIMEOUT_MS),
    headers: { Accept: "application/json" },
  });

  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}`);
  }

  return response.json();
}

async function runTool(name, args) {
  try {
    if (name === "calculator") {
      return String(calculate(args.expression));
    }

    if (name === "get_weather") {
      const city = String(args.city || "").trim();

      if (!city) {
        return "Please provide a city name.";
      }

      const geoUrl =
        "https://geocoding-api.open-meteo.com/v1/search" +
        `?name=${encodeURIComponent(city)}&count=1&language=en&format=json`;

      let geo;

      try {
        geo = await fetchWeatherJson(geoUrl, "geocoding API");
      } catch (error) {
        console.error("[Weather geocoding error]", {
          message: error.message,
          cause: error.cause?.message,
          code: error.cause?.code,
        });

        return "Weather lookup failed while finding the city. Please try again later.";
      }

      const place = geo.results?.[0];

      if (!place) {
        return `City not found: ${city}`;
      }

      const weatherUrl =
        "https://api.open-meteo.com/v1/forecast" +
        `?latitude=${place.latitude}` +
        `&longitude=${place.longitude}` +
        "&current=temperature_2m,wind_speed_10m" +
        `&timezone=${encodeURIComponent(place.timezone || "auto")}`;

      let weather;

      try {
        weather = await fetchWeatherJson(weatherUrl, "forecast API");
      } catch (error) {
        console.error("[Weather forecast error]", {
          message: error.message,
          cause: error.cause?.message,
          code: error.cause?.code,
        });

        return "The city was found, but its weather data could not be fetched.";
      }

      const current = weather.current;

      if (
        !current ||
        typeof current.temperature_2m !== "number" ||
        typeof current.wind_speed_10m !== "number"
      ) {
        console.error("[Weather] Unexpected response:", weather);
        return "Weather data is temporarily unavailable.";
      }

      return JSON.stringify({
        city: place.name,
        country: place.country || "",
        temperature_c: current.temperature_2m,
        wind_speed_kmh: current.wind_speed_10m,
        time: current.time,
        timezone: weather.timezone || place.timezone || "auto",
        source: "Open-Meteo",
      });
    }

    return "Unknown tool.";
  } catch (error) {
    console.error(`[Tool error: ${name}]`, {
      message: error.message,
      cause: error.cause?.message,
      code: error.cause?.code,
    });

    return `Tool failed: ${error.message}`;
  }
}

const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    error: "Too many requests. Please wait a minute and try again.",
  },
});

app.post("/api/chat", chatLimiter, async (req, res) => {
  const { messages } = req.body || {};

  if (!Array.isArray(messages) || messages.length === 0) {
    return res.status(400).json({
      error: "messages array is required",
    });
  }

  const invalid = messages.some(
    (message) =>
      !message ||
      typeof message.content !== "string" ||
      !["user", "assistant"].includes(message.role)
  );

  if (invalid) {
    return res.status(400).json({
      error: "Invalid message format",
    });
  }

  const tooLong = messages.some(
    (message) =>
      message.role === "user" && message.content.length > 4000
  );

  if (tooLong) {
    return res.status(400).json({
      error: "Your message is too long",
    });
  }

  if (!process.env.GROQ_API_KEY) {
    return res.status(500).json({
      error: "GROQ_API_KEY is missing in the server environment.",
    });
  }

  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });

  if (typeof res.flushHeaders === "function") {
    res.flushHeaders();
  }

  const send = (data) => {
    if (!res.writableEnded && !res.destroyed) {
      res.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  const controller = new AbortController();

  res.on("close", () => {
    if (!res.writableEnded) {
      controller.abort();
    }
  });

  const convo = [
    {
      role: "system",
      content:
        "You are a helpful assistant. Reply in the user's language. " +
        "Use tools when useful. For weather, use only the actual tool result. " +
        "Never invent live weather data. If a tool fails, clearly say that " +
        "live weather could not be retrieved.",
    },
    ...messages.slice(-20),
  ];

  try {
    let finished = false;

    for (let step = 0; step < MAX_STEPS; step++) {
      if (controller.signal.aborted) return;

      const stream = await client.chat.completions.create(
        {
          model: MODEL,
          messages: convo,
          tools,
          tool_choice: "auto",
          stream: true,
        },
        { signal: controller.signal }
      );

      let content = "";
      const calls = {};

      for await (const chunk of stream) {
        if (controller.signal.aborted) return;

        const delta = chunk.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.content) {
          content += delta.content;
          send({ type: "token", text: delta.content });
        }

        for (const toolCall of delta.tool_calls || []) {
          const call = (calls[toolCall.index] ||= {
            id: "",
            name: "",
            args: "",
          });

          if (toolCall.id) call.id = toolCall.id;
          if (toolCall.function?.name) {
            call.name += toolCall.function.name;
          }
          if (toolCall.function?.arguments) {
            call.args += toolCall.function.arguments;
          }
        }
      }

      const toolCalls = Object.values(calls);

      if (toolCalls.length === 0) {
        finished = true;
        break;
      }

      convo.push({
        role: "assistant",
        content: content || null,
        tool_calls: toolCalls.map((call) => ({
          id: call.id,
          type: "function",
          function: {
            name: call.name,
            arguments: call.args,
          },
        })),
      });

      for (const call of toolCalls) {
        let args;

        try {
          args = JSON.parse(call.args || "{}");
        } catch {
          args = {};
        }

        send({
          type: "tool_start",
          id: call.id,
          name: call.name,
          args,
        });

        const result = await runTool(call.name, args);

        send({
          type: "tool_result",
          id: call.id,
          name: call.name,
          result,
        });

        convo.push({
          role: "tool",
          tool_call_id: call.id,
          content: result,
        });
      }
    }

    if (!controller.signal.aborted && !finished) {
      send({
        type: "token",
        text: "\n\nI reached the tool-call limit. Please try again.",
      });
    }
  } catch (error) {
    if (!controller.signal.aborted) {
      console.error("[Chat error]", error);

      send({
        type: "error",
        message: "AI request failed. Check the server logs.",
      });
    }
  } finally {
    if (!res.writableEnded) {
      send({ type: "done" });
      res.end();
    }
  }
});

const PORT = process.env.PORT || 5000;

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Server running on port ${PORT}`);
});
