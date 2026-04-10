const baseUrl = import.meta.env.VITE_API_BASE_URL || '';
const endpoint = baseUrl ? `${baseUrl}/api/extract-timeline` : '/api/extract-timeline';

export async function extractTimeline(text) {
  const response = await fetch(endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    const message = payload?.error || `Server returned ${response.status}`;
    throw new Error(message);
  }

  return response.json();
}
