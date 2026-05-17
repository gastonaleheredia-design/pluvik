/**
 * OneSignal REST API push for severe weather alerts.
 *
 * Posts to https://onesignal.com/api/v1/notifications using the
 * project's ONESIGNAL_REST_API_KEY + ONESIGNAL_APP_ID. Targeting:
 *   - If `userId` is provided, sends to that External User ID
 *     (`include_external_user_ids` / `include_aliases`).
 *   - Otherwise broadcasts to the "All" segment (location-based alerts
 *     when we don't have a specific subscription).
 *
 * This fires server-side via OneSignal so notifications arrive even when
 * the app is completely closed.
 */

import { createServerFn } from '@tanstack/react-start';
import { z } from 'zod';

const PayloadSchema = z.object({
  title: z.string().min(1).max(255),
  body: z.string().min(1).max(2000),
  userId: z.string().min(1).max(255).nullable().optional(),
  data: z.record(z.string().min(1).max(255), z.unknown()).optional(),
  priority: z.enum(['high', 'normal']).optional(),
  // Allow empty string (callers sometimes pass '') as well as a valid URL.
  url: z.union([z.string().url().max(2048), z.literal('')]).optional(),
});

export const sendSevereWeatherPush = createServerFn({ method: 'POST' })
  .inputValidator((input) => PayloadSchema.parse(input))
  .handler(async ({ data }) => {
    const apiKey = process.env.ONESIGNAL_REST_API_KEY;
    const appId = process.env.ONESIGNAL_APP_ID;
    if (!apiKey || !appId) {
      throw new Error('OneSignal not configured (missing app id or REST API key)');
    }

    const body: Record<string, unknown> = {
      app_id: appId,
      headings: { en: data.title },
      contents: { en: data.body },
      data: data.data ?? {},
      priority: data.priority === 'normal' ? 5 : 10,
    };
    if (data.url) body.url = data.url;

    if (data.userId) {
      // OneSignal v1: target by External User ID alias.
      body.include_aliases = { external_id: [data.userId] };
      body.target_channel = 'push';
    } else {
      body.included_segments = ['All'];
    }

    const res = await fetch('https://onesignal.com/api/v1/notifications', {
      method: 'POST',
      headers: {
        Authorization: `Key ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }

    if (!res.ok) {
      console.error('[sendSevereWeatherPush] OneSignal error', res.status, text.slice(0, 400));
      return { ok: false as const, status: res.status, error: json?.errors ?? text };
    }

    return {
      ok: true as const,
      id: (json?.id as string | undefined) ?? null,
      recipients: (json?.recipients as number | undefined) ?? null,
    };
  });
