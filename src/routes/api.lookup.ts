import { createFileRoute } from '@tanstack/react-router';
import { handleLookup } from '@/lib/omdb.server';

export const Route = createFileRoute('/api/lookup')({
  server: { handlers: { GET: ({ request }) => handleLookup(request) } },
});
