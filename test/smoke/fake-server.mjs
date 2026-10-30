// Fake LLM API server for smoke tests. Speaks the Anthropic Messages API (/v1/messages) and the
// OpenAI chat completions API (/v1/chat/completions). Responses are deterministic functions of the
// prompt; every request is appended as one JSON line to the file named by FAKE_LOG.
import http from "node:http";
import fs from "node:fs";

const port = Number(process.env.FAKE_PORT || process.argv[2] || 4321);
const logFile = process.env.FAKE_LOG || "";

export function answerFor(userText) {
  if (userText.includes("Instruction:")) {
    return 'const greeting = "hello world";';
  }
  if (userText.includes("function add(a: number, b: number): number {")) {
    return "\n  return a + b;\n}";
  }
  return "";
}

function logRequest(kind, body, headers) {
  if (!logFile) {
    return;
  }
  fs.appendFileSync(logFile, JSON.stringify({ kind, at: Date.now(), headers, body }) + "\n");
}

function sse(res, events) {
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache",
    connection: "keep-alive",
  });
  for (const [event, data] of events) {
    if (event) {
      res.write(`event: ${event}\n`);
    }
    res.write(`data: ${typeof data === "string" ? data : JSON.stringify(data)}\n\n`);
  }
  res.end();
}

function anthropic(req, res, body) {
  if (!req.headers["x-api-key"] && !req.headers.authorization) {
    res.writeHead(401, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        type: "error",
        error: { type: "authentication_error", message: "missing key" },
      }),
    );
    return;
  }
  const user =
    Array.isArray(body.messages) && body.messages[0] ? String(body.messages[0].content) : "";
  const systemLen = Array.isArray(body.system)
    ? body.system.reduce((n, b) => n + String(b.text || "").length, 0)
    : String(body.system || "").length;
  const approxTokens = Math.max(1, Math.round(systemLen / 4));
  if (body.max_tokens === 0) {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(
      JSON.stringify({
        id: "msg_prewarm",
        type: "message",
        role: "assistant",
        model: body.model,
        content: [],
        stop_reason: "max_tokens",
        stop_sequence: null,
        usage: {
          input_tokens: 10,
          output_tokens: 0,
          cache_creation_input_tokens: approxTokens,
          cache_read_input_tokens: 0,
        },
      }),
    );
    return;
  }
  const text = answerFor(user);
  const events = [
    [
      "message_start",
      {
        type: "message_start",
        message: {
          id: "msg_1",
          type: "message",
          role: "assistant",
          model: body.model,
          content: [],
          stop_reason: null,
          stop_sequence: null,
          usage: {
            input_tokens: 20,
            output_tokens: 0,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: approxTokens,
          },
        },
      },
    ],
    [
      "content_block_start",
      { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } },
    ],
  ];
  for (const piece of text.match(/[\s\S]{1,6}/g) || []) {
    events.push([
      "content_block_delta",
      { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: piece } },
    ]);
  }
  events.push(
    ["content_block_stop", { type: "content_block_stop", index: 0 }],
    [
      "message_delta",
      {
        type: "message_delta",
        delta: { stop_reason: "end_turn", stop_sequence: null },
        usage: { output_tokens: 8 },
      },
    ],
    ["message_stop", { type: "message_stop" }],
  );
  sse(res, events);
}

function openai(_req, res, body) {
  const userMsg = (body.messages || []).find((m) => m.role === "user");
  const text = answerFor(userMsg ? String(userMsg.content) : "");
  const base = { id: "chatcmpl-1", object: "chat.completion.chunk", created: 0, model: body.model };
  const events = [];
  for (const piece of text.match(/[\s\S]{1,6}/g) || []) {
    events.push([
      null,
      { ...base, choices: [{ index: 0, delta: { content: piece }, finish_reason: null }] },
    ]);
  }
  events.push([null, { ...base, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] }]);
  events.push([
    null,
    {
      ...base,
      choices: [],
      usage: {
        prompt_tokens: 30,
        completion_tokens: 8,
        prompt_tokens_details: { cached_tokens: 20 },
      },
    },
  ]);
  events.push([null, "[DONE]"]);
  sse(res, events);
}

const server = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      res.writeHead(400);
      res.end("bad json");
      return;
    }
    const url = req.url || "";
    if (req.method === "POST" && url.endsWith("/v1/messages")) {
      logRequest("anthropic", body, {
        auth: req.headers["x-api-key"] || req.headers.authorization ? "present" : "missing",
      });
      anthropic(req, res, body);
    } else if (req.method === "POST" && url.endsWith("/chat/completions")) {
      logRequest("openai", body, {
        authorization: req.headers.authorization ? "present" : "missing",
      });
      openai(req, res, body);
    } else {
      res.writeHead(404);
      res.end("not found");
    }
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`fake llm server listening on http://127.0.0.1:${port}`);
});
