import { createFileRoute } from '@tanstack/react-router';
import { fetchTomorrowIoBackup, tomorrowIoBudgetRemaining } from '@/lib/fetchers/fetchTomorrowIoBackup';

export const Route = createFileRoute('/api/public/test-tomorrow-io')({
  server: {
    handlers: {
      GET: async ({ request }) => {
        const url = new URL(request.url);
        const lat = parseFloat(url.searchParams.get('lat') ?? '29.7279');
        const lon = parseFloat(url.searchParams.get('lon') ?? '-95.4647');
        const hasKey = !!process.env.TOMORROW_IO_API_KEY;
        const keyLen = process.env.TOMORROW_IO_API_KEY?.length ?? 0;
        const text = await fetchTomorrowIoBackup(lat, lon, 12);
        return Response.json({
          hasKey,
          keyLen,
          budgetRemaining: tomorrowIoBudgetRemaining(),
          textLength: text.length,
          textPreview: text.slice(0, 1500),
        });
      },
    },
  },
});