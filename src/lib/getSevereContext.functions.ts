import { createServerFn } from '@tanstack/react-start';
import { getActiveWarning } from './metDataFetcher';
import { fetchRotationSignatures } from './fetchers/fetchRotationSignatures';
import { fetchRadarTrend } from './fetchers/fetchRadarTrend';
import type { InterpreterAlert } from './severeWeatherInterpreter';

export interface SevereContextPayload {
  activeAlert: InterpreterAlert | null;
  rotationSignatures: string | null;
  radarTrend: string | null;
}

/**
 * Server-side gather for the severe-weather interpreter. Pulls the current
 * NWS warning at (lat, lon), the NCEI rotation/hail signature roll-up, and
 * the IEM short-term radar trend in parallel. Each piece soft-fails to
 * null/empty so the interpreter can always render a useful answer.
 */
export const getSevereContext = createServerFn({ method: 'POST' })
  .inputValidator((data: { lat: number; lon: number }) => data)
  .handler(async ({ data }): Promise<SevereContextPayload> => {
    const { lat, lon } = data;
    const [alertRes, rotRes, trendRes] = await Promise.allSettled([
      getActiveWarning(lat, lon),
      fetchRotationSignatures(lat, lon),
      fetchRadarTrend(lat, lon),
    ]);
    const alert = alertRes.status === 'fulfilled' ? alertRes.value : null;
    return {
      activeAlert: alert
        ? {
            event: alert.event,
            description: alert.description ?? null,
            expiresIso: alert.expiresIso ?? null,
            expiresLocal: null,
          }
        : null,
      rotationSignatures: rotRes.status === 'fulfilled' ? rotRes.value : null,
      radarTrend: trendRes.status === 'fulfilled' ? trendRes.value : null,
    };
  });