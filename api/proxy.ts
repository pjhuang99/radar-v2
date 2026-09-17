import type { VercelRequest, VercelResponse } from '@vercel/node';

// NOTE: this standalone function is shadowed by vercel.json's rewrite of
// /api/(.*) -> /api/index.ts, but kept in sync with the live proxy anyway.
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const apiKey = process.env.DEEPSEEK_API_KEY || '';
  const model = process.env.DEEPSEEK_MODEL || 'deepseek-flash';
  const baseUrl = process.env.DEEPSEEK_BASE_URL || 'https://api.deepseek.com/v1';
  // V4.1+ enables thinking by default. Left on, it burns the whole max_tokens
  // budget on reasoning_content and can return an EMPTY content (blank draft),
  // and the server silently ignores temperature. Off unless explicitly enabled.
  const thinking = process.env.DEEPSEEK_THINKING === 'enabled' ? 'enabled' : 'disabled';
  const { payload } = req.body;

  try {
    if (!apiKey) {
      return res.status(500).json({ error: { message: 'Server DEEPSEEK_API_KEY is not configured' } });
    }

    const url = baseUrl.includes('chat/completions')
      ? baseUrl
      : (baseUrl.endsWith('/') ? baseUrl + 'chat/completions' : baseUrl + '/chat/completions');

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({ ...payload, model, thinking: { type: thinking } }),
    });
    const data = await response.json();
    if (!response.ok) {
      return res.status(response.status).json(data);
    }
    return res.status(200).json(data);
  } catch (e: any) {
    return res.status(500).json({ error: { message: e.message } });
  }
}
