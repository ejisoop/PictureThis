// Thin wrapper over @google/genai with timing and JSON parsing.
import { GoogleGenAI } from '@google/genai';
import { env } from './env';

let client: GoogleGenAI | null = null;
export function ai() {
  if (!env.geminiKey) throw new Error('GEMINI_API_KEY is not set (server/.env)');
  client ??= new GoogleGenAI({ apiKey: env.geminiKey });
  return client;
}

export interface JsonCall {
  model: string;
  system?: string;
  parts: ({ text: string } | { inlineData: { mimeType: string; data: string } })[];
  schema: unknown;
  thinking: 'MINIMAL' | 'LOW' | 'MEDIUM' | 'HIGH';
  temperature?: number;
  timeoutMs?: number;
  maxOutputTokens?: number;
}

export async function generateJson<T = unknown>(c: JsonCall, retries = 1): Promise<{ data: T; ms: number; usage: unknown; raw: string; finish: string }> {
  try {
    return await once<T>(c);
  } catch (e) {
    if (retries > 0 && /empty|invalid JSON|MAX_TOKENS|503|500|UNAVAILABLE|overloaded/i.test(String((e as Error).message))) return generateJson<T>(c, retries - 1);
    throw e;
  }
}

async function once<T>(c: JsonCall): Promise<{ data: T; ms: number; usage: unknown; raw: string; finish: string }> {
  const t0 = performance.now();
  const res = await ai().models.generateContent({
    model: c.model,
    contents: [{ role: 'user', parts: c.parts }],
    config: {
      systemInstruction: c.system,
      responseMimeType: 'application/json',
      responseJsonSchema: c.schema,
      thinkingConfig: { thinkingLevel: c.thinking as any },
      temperature: c.temperature,
      maxOutputTokens: c.maxOutputTokens ?? 32768,
      abortSignal: AbortSignal.timeout(c.timeoutMs ?? 90_000),
    },
  });
  const raw = res.text ?? '';
  const finish = String(res.candidates?.[0]?.finishReason ?? res.promptFeedback?.blockReason ?? 'unknown');
  if (!raw.trim()) throw new Error(`Gemini returned an empty response (finishReason ${finish})`);
  let data: T;
  try {
    data = JSON.parse(raw) as T;
  } catch {
    throw new Error(`Gemini returned invalid JSON (finishReason ${finish}): ${raw.slice(0, 200)}`);
  }
  return { data, ms: performance.now() - t0, usage: res.usageMetadata, raw, finish };
}
