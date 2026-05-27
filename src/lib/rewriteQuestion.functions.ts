import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const SYSTEM_PROMPT =
  "You rewrite messy weather questions into clean concise event titles. " +
  "Maximum 8 words. Format: Activity · Location · Time. Remove filler words, " +
  "false starts, 'uh', 'I'm planning to', 'I just want to know'. " +
  "Return only the rewritten title, nothing else.";

function cleanTitle(raw: string): string {
  let t = (raw || '').trim();
  // strip surrounding quotes (straight or smart)
  t = t.replace(/^["“”'`]+|["“”'`]+$/g, '').trim();
  // collapse whitespace
  t = t.replace(/\s+/g, ' ');
  if (t.length > 80) t = t.slice(0, 80).trim();
  return t;
}

export const rewriteQuestionTitle = createServerFn({ method: 'POST' })
  .inputValidator((input) =>
    z.object({ question: z.string().min(1).max(2000) }).parse(input),
  )
  .handler(async ({ data }): Promise<{ title: string | null }> => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return { title: null };

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        signal: controller.signal,
        headers: {
          'content-type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 100,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: data.question }],
        }),
      });
      if (!res.ok) {
        console.error('[rewriteQuestionTitle] non-ok', res.status);
        return { title: null };
      }
      const body = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
      };
      const text = body.content?.find((c) => c.type === 'text')?.text
        ?? body.content?.[0]?.text
        ?? '';
      const title = cleanTitle(text);
      return { title: title.length > 0 ? title : null };
    } catch (err) {
      console.error('[rewriteQuestionTitle] failed', err);
      return { title: null };
    } finally {
      clearTimeout(timer);
    }
  });