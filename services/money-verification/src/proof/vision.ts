import { z } from 'zod';
import type { Env } from '../env.js';
import { MoneyVerificationError } from '../errors.js';

export interface VisionInput {
  imageUrls: string[];
  mustShow: string[];
  instructions: string;
}

export interface VisionScore {
  confidence: number;
  mustShowFound: Record<string, boolean>;
  notes: string;
}

export interface VisionScorer {
  score(input: VisionInput): Promise<VisionScore>;
}

export class VisionError extends MoneyVerificationError {
  constructor(message: string) {
    super('vision', message);
  }
}

const SYSTEM_PROMPT =
  'You verify proof photos for a completed physical task. You will get the task instructions and a checklist of things that must be visible. ' +
  'Inspect the images and answer ONLY with JSON: {"confidence": number 0..1 (how confident you are the task was completed as described, based only on what is visible), ' +
  '"must_show_found": {"<checklist item>": true|false, ...} with one key per checklist item exactly as given, "notes": "one or two sentences"}. ' +
  'Be skeptical: screenshots, stock photos, heavy edits, mismatched lighting or duplicated frames lower confidence.';

const ResponseSchema = z.object({
  confidence: z.number().min(0).max(1),
  must_show_found: z.record(z.boolean()),
  notes: z.string().default(''),
});

const ChatSchema = z.object({
  choices: z.array(z.object({ message: z.object({ content: z.string() }) })).min(1),
});

/** Models often wrap JSON in ``` fences despite response_format; strip them before parsing. */
function stripFences(text: string): string {
  const m = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/i.exec(text);
  return (m ? (m[1] as string) : text).trim();
}

/**
 * Scorer for any OpenAI-compatible chat/completions endpoint with image input. Every failure becomes a
 * VisionError with a short reason; the API key is only ever placed in the request header.
 */
export function openAiCompatibleScorer(opts: {
  baseUrl: string;
  apiKey: string;
  model: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}): VisionScorer {
  const fetchImpl = opts.fetch ?? fetch;
  const url = `${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`;
  return {
    async score(input) {
      const checklist = input.mustShow.length ? input.mustShow.map((s) => `- ${s}`).join('\n') : '(none)';
      const body = {
        model: opts.model,
        temperature: 0,
        max_tokens: 400,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          {
            role: 'user',
            content: [
              { type: 'text', text: `Task instructions: ${input.instructions}\nChecklist (must be visible):\n${checklist}` },
              ...input.imageUrls.map((u) => ({ type: 'image_url', image_url: { url: u } })),
            ],
          },
        ],
      };
      let res: Response;
      try {
        res = await fetchImpl(url, {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
        });
      } catch (err) {
        throw new VisionError(`vision request failed: ${err instanceof Error ? err.name : 'error'}`);
      }
      if (!res.ok) throw new VisionError(`vision request failed: HTTP ${res.status}`);

      let parsed: z.infer<typeof ResponseSchema>;
      try {
        const chat = ChatSchema.parse(await res.json());
        const content = (chat.choices[0] as { message: { content: string } }).message.content;
        parsed = ResponseSchema.parse(JSON.parse(stripFences(content)));
      } catch {
        throw new VisionError('vision response was not valid scorer JSON');
      }
      const mustShowFound: Record<string, boolean> = {};
      for (const item of input.mustShow) mustShowFound[item] = parsed.must_show_found[item] === true;
      return { confidence: parsed.confidence, mustShowFound, notes: parsed.notes };
    },
  };
}

/** Build the scorer from env, or null when any of the three settings is missing. */
export function scorerFromEnv(
  env: Pick<Env, 'VERIFIER_BASE_URL' | 'VERIFIER_API_KEY' | 'VERIFIER_MODEL'>,
  fetchImpl?: typeof fetch,
): VisionScorer | null {
  const { VERIFIER_BASE_URL: baseUrl, VERIFIER_API_KEY: apiKey, VERIFIER_MODEL: model } = env;
  if (!baseUrl || !apiKey || !model) return null;
  return openAiCompatibleScorer({ baseUrl, apiKey, model, fetch: fetchImpl });
}
