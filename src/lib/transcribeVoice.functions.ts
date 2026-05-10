import { createServerFn } from '@tanstack/react-start';

/**
 * Transcribe a short audio recording using the Lovable AI Gateway
 * (Gemini 2.5 Flash). Accepts a base64-encoded audio blob and a language
 * hint, returns the transcript text.
 *
 * Why Gemini via Lovable AI: the Web Speech API on iOS Safari is unreliable
 * and forces users into the browser-permissions weeds. Lovable AI is already
 * available via LOVABLE_API_KEY (no extra subscription) and Gemini 2.5 Flash
 * accepts inline audio.
 */
export const transcribeVoice = createServerFn({ method: 'POST' })
  .inputValidator((data: { audioBase64: string; mimeType: string; language?: string }) => {
    if (!data || typeof data.audioBase64 !== 'string' || !data.audioBase64) {
      throw new Error('audioBase64 is required');
    }
    if (typeof data.mimeType !== 'string' || !data.mimeType) {
      throw new Error('mimeType is required');
    }
    return {
      audioBase64: data.audioBase64,
      mimeType: data.mimeType,
      language: data.language ?? 'en',
    };
  })
  .handler(async ({ data }) => {
    const apiKey = process.env.LOVABLE_API_KEY;
    if (!apiKey) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Map browser MIME → OpenAI-style audio format string. Gemini accepts
    // webm/opus, mp4, mpeg, wav. Default to webm because that's what
    // MediaRecorder produces on most browsers.
    const fmt =
      data.mimeType.includes('webm') ? 'webm' :
      data.mimeType.includes('mp4') ? 'mp4' :
      data.mimeType.includes('mpeg') ? 'mp3' :
      data.mimeType.includes('wav') ? 'wav' :
      'webm';

    const langName = data.language.startsWith('es') ? 'Spanish' : 'English';
    const systemPrompt =
      `You are a speech-to-text transcriber. The user will send a short audio clip in ${langName}. ` +
      `Return ONLY the literal transcript of what was said. No quotes, no labels, no explanation, ` +
      `no "Transcript:" prefix. If the audio is silent or unintelligible, return an empty string.`;

    const res = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          {
            role: 'user',
            content: [
              { type: 'text', text: 'Transcribe this audio.' },
              {
                type: 'input_audio',
                input_audio: { data: data.audioBase64, format: fmt },
              },
            ],
          },
        ],
      }),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.error('[transcribeVoice] gateway error', res.status, body.slice(0, 400));
      if (res.status === 429) throw new Error('Voice service is busy. Try again in a moment.');
      if (res.status === 402) throw new Error('Voice service unavailable. Please try typing.');
      throw new Error(`Voice transcription failed (${res.status}).`);
    }

    const json = await res.json().catch(() => null) as { choices?: Array<{ message?: { content?: string } }> } | null;
    const text = json?.choices?.[0]?.message?.content?.trim() ?? '';
    // Strip stray surrounding quotes if the model added them despite instructions.
    const cleaned = text.replace(/^["']|["']$/g, '').trim();
    return { text: cleaned };
  });