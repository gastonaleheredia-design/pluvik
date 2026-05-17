/**
 * Severe weather push notifications.
 *
 * Triggers a local push notification (via the OneSignal-registered service
 * worker) when a *new* NWS warning appears at the user's saved location.
 * Dedup is keyed on the alert event + expiry — re-fetches for the same
 * warning never re-notify.
 *
 * Only fires for warnings (and Tornado Watch) covering the user's actual
 * coordinates, not nearby warnings.
 */

const LAST_ALERT_KEY = 'pluvik-last-alert-id';

export interface SevereAlertInput {
  event: string;
  expiresIso: string | null;
  expiresLocal: string | null;
}

import { sendSevereWeatherPush } from './sendSevereWeatherPush.functions';

type Copy = { title: string; body: string; priority: 'high' | 'normal' } | null;

function buildCopy(event: string, expiresLocal: string | null, place: string): Copy {
  const e = event.trim();
  const until = expiresLocal ? `until ${expiresLocal}` : 'in effect';
  if (/tornado warning/i.test(e)) {
    return {
      title: `TORNADO WARNING — ${place}`,
      body: `Active ${until}. Take shelter now.`,
      priority: 'high',
    };
  }
  if (/flash flood warning/i.test(e)) {
    return {
      title: `FLASH FLOOD WARNING — ${place}`,
      body: `Active ${until}. Move to higher ground now.`,
      priority: 'high',
    };
  }
  if (/severe thunderstorm warning/i.test(e)) {
    return {
      title: `Severe Thunderstorm Warning — ${place}`,
      body: `${expiresLocal ? `Until ${expiresLocal}.` : 'In effect.'} Seek shelter from lightning and damaging winds.`,
      priority: 'high',
    };
  }
  if (/tornado watch/i.test(e)) {
    return {
      title: `Tornado Watch — ${place}`,
      body: `In effect ${until}. Conditions favorable for tornadoes — stay weather aware.`,
      priority: 'normal',
    };
  }
  return null;
}

function alertIdOf(alert: SevereAlertInput): string {
  return `${alert.event.trim().toLowerCase()}|${alert.expiresIso ?? ''}`;
}

export function readLastAlertId(): string | null {
  try { return localStorage.getItem(LAST_ALERT_KEY); } catch { return null; }
}

export function writeLastAlertId(id: string | null): void {
  try {
    if (id) localStorage.setItem(LAST_ALERT_KEY, id);
    else localStorage.removeItem(LAST_ALERT_KEY);
  } catch { /* ignore */ }
}

/**
 * Show a notification for a newly-active warning. Returns true if a
 * notification was actually shown (i.e. it was new and copy was supported).
 */
export async function notifySevereWeather(
  alert: SevereAlertInput,
  placeLabel: string,
  userId?: string | null,
): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  const id = alertIdOf(alert);
  if (readLastAlertId() === id) return false;

  const copy = buildCopy(alert.event, alert.expiresLocal, placeLabel);
  if (!copy) {
    // Unsupported alert type — still mark seen so we don't spam-check.
    writeLastAlertId(id);
    return false;
  }

  // Mark as seen before await so concurrent calls don't double-fire.
  writeLastAlertId(id);

  // Fire the OneSignal REST push server-side so the notification arrives
  // even when the app is completely closed. Best-effort: failures are
  // logged but never block the in-app fallback below.
  sendSevereWeatherPush({
    data: {
      title: copy.title,
      body: copy.body,
      userId: userId ?? null,
      priority: copy.priority,
      url: '/?severe=1',
      data: { alertId: id, event: alert.event, expiresIso: alert.expiresIso },
    },
  }).catch((err) => {
    console.warn('[severeWeatherPush] OneSignal REST push failed', err);
  });

  if (!('Notification' in window)) return false;
  if (Notification.permission !== 'granted') return false;

  const data = {
    alertId: id,
    event: alert.event,
    url: '/?severe=1',
  };

  try {
    if ('serviceWorker' in navigator) {
      const reg = await navigator.serviceWorker.ready;
      await reg.showNotification(copy.title, {
        body: copy.body,
        tag: `pluvik-alert-${id}`,
        renotify: true,
        requireInteraction: copy.priority === 'high',
        data,
      } as NotificationOptions);
      return true;
    }
    new Notification(copy.title, { body: copy.body, data, tag: `pluvik-alert-${id}` });
    return true;
  } catch {
    return false;
  }
}
