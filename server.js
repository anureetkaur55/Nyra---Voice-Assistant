import { createServer } from "node:http";
import { readFileSync, existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = fileURLToPath(new URL(".", import.meta.url));
const publicDir = resolve(__dirname, "public");

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || "";
const HF_TOKEN = process.env.HF_TOKEN || "";
const HF_MODEL = process.env.HF_MODEL || "deepseek-ai/DeepSeek-V3.2:novita";

const mimeTypes = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url || "/", `http://${req.headers.host}`);

    if (req.method === "GET" && url.pathname === "/api/health") {
      return sendJson(res, 200, {
        ok: true,
        openaiConfigured: Boolean(OPENAI_API_KEY),
        huggingFaceConfigured: Boolean(HF_TOKEN)
      });
    }

    if (req.method === "GET" && url.pathname === "/api/contacts") {
      return sendJson(res, 200, getContacts());
    }

    if (req.method === "POST" && url.pathname === "/api/ask") {
      const body = await readJson(req);
      const question = String(body.question || "").trim();
      const provider = String(body.provider || "openai").toLowerCase();

      if (!question) return sendJson(res, 400, { error: "Please enter a question." });

      const answer = provider === "huggingface"
        ? await askHuggingFace(question)
        : await askOpenAI(question);

      return sendJson(res, 200, { answer });
    }

    if (req.method === "GET" && url.pathname === "/api/wikipedia") {
      const topic = String(url.searchParams.get("topic") || "").trim();
      if (!topic) return sendJson(res, 400, { error: "Please enter a topic." });

      const summary = await getWikipediaSummary(topic);
      return sendJson(res, 200, { summary });
    }

    if (req.method === "GET") return serveStatic(url.pathname, res);

    sendJson(res, 405, { error: "Method not allowed." });
  } catch (error) {
    sendJson(res, 500, { error: error.message || "Something went wrong." });
  }
});

server.listen(PORT, () => {
  console.log(`Voice Assistant running at http://localhost:${PORT}`);
});

function loadEnv() {
  const envPath = join(__dirname, ".env");
  if (!existsSync(envPath)) return;

  const lines = readFileSync(envPath, "utf8").split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const index = trimmed.indexOf("=");
    if (index === -1) continue;

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^["']|["']$/g, "");

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

async function askOpenAI(question) {
  if (!OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY in .env");
  }

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      input: [
        {
          role: "system",
          content: "You are a helpful voice assistant. Keep answers short and easy to speak aloud."
        },
        {
          role: "user",
          content: question
        }
      ]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || "OpenAI request failed.");
  }

  return data.output_text || "I did not receive an answer.";
}

async function askHuggingFace(question) {
  if (!HF_TOKEN) {
    throw new Error("Missing HF_TOKEN in .env");
  }

  const response = await fetch("https://router.huggingface.co/v1/chat/completions", {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${HF_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: HF_MODEL,
      messages: [{ role: "user", content: question }]
    })
  });

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error?.message || data.message || "Hugging Face request failed.");
  }

  return data.choices?.[0]?.message?.content || "I did not receive an answer.";
}

async function getWikipediaSummary(topic) {
  const response = await fetch(
    `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(topic)}`
  );

  const data = await response.json();

  if (!response.ok || data.type === "disambiguation") {
    throw new Error("I could not find a clear Wikipedia result.");
  }

  return data.extract || "I could not find a summary.";
}

function getContacts() {
  const contactsPath = join(__dirname, "contacts.json");
  if (!existsSync(contactsPath)) return {};

  try {
    return JSON.parse(readFileSync(contactsPath, "utf8"));
  } catch {
    return {};
  }
}

async function serveStatic(pathname, res) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const filePath = normalize(resolve(publicDir, `.${decodeURIComponent(requestedPath)}`));

  if (!filePath.startsWith(publicDir)) {
    return sendText(res, 403, "Forbidden");
  }

  try {
    const content = await readFile(filePath);
    const type = mimeTypes[extname(filePath).toLowerCase()] || "application/octet-stream";
    res.writeHead(200, { "Content-Type": type });
    res.end(content);
  } catch {
    sendText(res, 404, "Not found");
  }
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const text = Buffer.concat(chunks).toString("utf8");
  return text ? JSON.parse(text) : {};
}

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(data));
}

function sendText(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}