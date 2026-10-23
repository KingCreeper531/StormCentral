/**
 * The live stream's AI writers, best first: Gemini (GEMINI_API_KEY, which
 * has a free tier), any OpenAI-compatible API
 * (OPENAI_API_KEY with OPENAI_MODEL, and OPENAI_BASE_URL for Groq,
 * OpenRouter and the like), then the local model (OLLAMA_MODEL). Whatever
 * one writes must pass the caller's check against the facts; if it doesn't
 * (or the service is down), the next one tries, and with none left the
 * caller reads the facts as written. The AI words things; it never decides
 * what's urgent or adds facts.
 */

export interface Writer {
  name: string;
  write(system: string, prompt: string, maxTokens: number): Promise<string>;
}

const TIMEOUT = 45_000;
type Env = Record<string, string | undefined>;

async function post<T>(url: string, headers: Record<string, string>, body: unknown, timeout = TIMEOUT): Promise<T> {
  const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeout) });
  if (!res.ok) throw new Error(`${new URL(url).host} ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return (await res.json()) as T;
}

function gemini(key: string, model: string): Writer {
  return {
    name: `Gemini (${model})`,
    async write(system, prompt, maxTokens) {
      const r = await post<{ candidates?: { content?: { parts?: { text?: string }[] } }[] }>(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { "x-goog-api-key": key },
        // Room for a thinking model's reasoning on top of the answer.
        { systemInstruction: { parts: [{ text: system }] }, contents: [{ role: "user", parts: [{ text: prompt }] }], generationConfig: { temperature: 0.7, maxOutputTokens: maxTokens + 1024 } },
      );
      return (r.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
    },
  };
}

function openaiCompatible(key: string, model: string, base: string): Writer {
  return {
    name: `${new URL(base).host} (${model})`,
    async write(system, prompt, maxTokens) {
      const r = await post<{ choices?: { message?: { content?: string } }[] }>(
        `${base.replace(/\/$/, "")}/chat/completions`,
        { Authorization: `Bearer ${key}` },
        { model, max_tokens: maxTokens, temperature: 0.7, messages: [{ role: "system", content: system }, { role: "user", content: prompt }] },
      );
      return r.choices?.[0]?.message?.content ?? "";
    },
  };
}

function ollama(host: string, model: string): Writer {
  return {
    name: `local ${model}`,
    async write(system, prompt, maxTokens) {
      const r = await post<{ message?: { content?: string } }>(
        `${host.replace(/\/$/, "")}/api/chat`,
        {},
        {
          model,
          stream: false,
          // Reasoning models answer straight away on a live stream.
          ...(/^(qwen3|deepseek-r1)/.test(model) ? { think: false } : {}),
          options: { temperature: 0.7, num_predict: maxTokens },
          messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        },
        120_000,
      );
      return (r.message?.content ?? "").replace(/<think>[\s\S]*?<\/think>/g, "");
    },
  };
}

/** The writers configured in the environment, best first. */
export function writersFromEnv(env: Env = process.env): Writer[] {
  const out: Writer[] = [];
  if (env.GEMINI_API_KEY) out.push(gemini(env.GEMINI_API_KEY, env.GEMINI_MODEL || "gemini-flash-latest"));
  if (env.OPENAI_API_KEY && env.OPENAI_MODEL) out.push(openaiCompatible(env.OPENAI_API_KEY, env.OPENAI_MODEL, env.OPENAI_BASE_URL || "https://api.openai.com/v1"));
  if (env.OLLAMA_MODEL) out.push(ollama(env.OLLAMA_HOST || "http://127.0.0.1:11434", env.OLLAMA_MODEL));
  return out;
}

const clean = (s: string) =>
  s
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^["'“]+|["'”]+$/g, "");

/**
 * The first writer's text that `check` accepts (check returns the text to use,
 * or null to reject it), with who wrote it; null when none passes.
 */
export async function writeChecked(
  writers: Writer[],
  system: string,
  prompt: string,
  check: (text: string) => string | null,
  { maxTokens = 220, log }: { maxTokens?: number; log?: (msg: string) => void } = {},
): Promise<{ text: string; by: string } | null> {
  for (const w of writers) {
    try {
      const raw = clean(await w.write(system, prompt, maxTokens));
      const ok = check(raw);
      if (ok) return { text: ok, by: w.name };
      log?.(`${w.name}'s text didn't pass the fact check: ${JSON.stringify(raw.slice(0, 300))}`);
    } catch (err) {
      log?.(`${w.name} unavailable: ${err instanceof Error ? err.message : err}`);
    }
  }
  return null;
}
