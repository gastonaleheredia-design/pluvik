import { createFileRoute } from '@tanstack/react-router';
import { sendMorningBriefing } from '@/lib/sendMorningBriefing.functions';

function verifySecret(request: Request): boolean {
  const expected = process.env.MORNING_BRIEFING_SECRET ?? '';
  const got = request.headers.get('x-briefing-secret') ?? '';
  return expected.length > 0 && got === expected;
}

export const Route = createFileRoute('/api/public/morning-briefing')({
  server: {
    handlers: {
      POST: async ({ request }) => {
        if (!verifySecret(request)) {
          return new Response('Unauthorized', { status: 401 });
        }
        try {
          const result = await sendMorningBriefing();
          return Response.json(result);
        } catch (err) {
          console.error('[morning-briefing] failed', (err as Error).message);
          return new Response('Internal error', { status: 500 });
        }
      },
    },
  },
});