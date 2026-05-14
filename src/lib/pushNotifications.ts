/**
 * Push notification sender for tracked weather events.
 * Uses Supabase to store push subscriptions and sends
 * web push notifications when forecast changes are significant.
 */

import { supabaseAdmin } from '@/integrations/supabase/client.server';
import type { ChangeTag } from './snapshots';
import type { ForecastStage } from './forecastStage';

export interface NotificationPayload {
  eventId: string;
  userId: string;
  changeTag: ChangeTag;
  stage: ForecastStage;
  verdictWord: string | null;
  verdictSentence: string | null;
  eventQuestion: string;
  eventAddress: string;
}

/**
 * Notification copy matched to change type.
 * Keeps messages short — they appear as push notifications on a phone.
 */
function buildNotificationCopy(payload: NotificationPayload): {
  title: string;
  body: string;
} {
  const place = payload.eventAddress.split(',')[0].trim();
  const q = payload.eventQuestion.length > 60
    ? payload.eventQuestion.slice(0, 57) + '…'
    : payload.eventQuestion;

  switch (payload.changeTag) {
    case 'STAGE_PROMOTED':
      return {
        title: `Forecast update — ${place}`,
        body: payload.stage === 'model_trend'
          ? `First real signal available for "${q}". Tap to see what changed.`
          : payload.stage === 'short_range'
          ? `Real forecast now available for "${q}". Confidence is improving.`
          : payload.stage === 'live'
          ? `Live conditions active for "${q}". Check now.`
          : `Forecast confidence improving for "${q}".`,
      };
    case 'SIGNIFICANT_CHANGE':
      return {
        title: `⚠ Forecast changed — ${place}`,
        body: payload.verdictSentence
          ? payload.verdictSentence
          : `The forecast for "${q}" has changed significantly.`,
      };
    case 'NEW_DATA_SOURCE':
      return {
        title: `New data for ${place}`,
        body: `Better forecast data now available for "${q}".`,
      };
    default:
      return {
        title: `Forecast updated — ${place}`,
        body: payload.verdictSentence ?? `Updated forecast for "${q}".`,
      };
  }
}

/**
 * Send push notifications to all devices registered for a user.
 * Silently skips if no subscriptions exist or if the change tag
 * is MINOR_REFRESH or INITIAL (not worth interrupting the user).
 */
export async function sendEventNotification(
  payload: NotificationPayload,
): Promise<void> {
  // Only notify for meaningful changes
  const notifiableTags: ChangeTag[] = [
    'STAGE_PROMOTED',
    'SIGNIFICANT_CHANGE',
    'NEW_DATA_SOURCE',
  ];
  if (!notifiableTags.includes(payload.changeTag)) return;

  // Special case: STAGE_PROMOTED from climate→outlook is not worth a push
  // (still no real forecast). Only notify when entering model_trend or later.
  if (
    payload.changeTag === 'STAGE_PROMOTED' &&
    (payload.stage === 'outlook')
  ) return;

  const { title, body } = buildNotificationCopy(payload);

  // Store notification in DB for in-app notification center
  // even if push delivery fails
  await supabaseAdmin
    .from('user_notifications')
    .insert({
      user_id: payload.userId,
      event_id: payload.eventId,
      title,
      body,
      change_tag: payload.changeTag,
      stage: payload.stage,
      read: false,
    })
    .then(({ error }) => {
      if (error) console.error('[pushNotifications] DB insert failed', error);
    });
}