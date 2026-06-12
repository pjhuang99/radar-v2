import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();

  const { apiKey, payload, provider, baseUrl } = req.body;

  try {
    if (!apiKey) {
      return res.status(400).json({ error: { message: "API Key is missing" } });
    }

    if (provider === 'deepseek' || provider === 'moonshot') {
      const defaultUrl = provider === 'deepseek' 
        ? 'https://api.deepseek.com/v1/chat/completions'
        : 'https://api.moonshot.cn/v1/chat/completions';
      
      let url = defaultUrl;
      if (baseUrl) {
        url = baseUrl.includes('chat/completions') ? baseUrl : (baseUrl.endsWith('/') ? baseUrl + 'chat/completions' : baseUrl + '/chat/completions');
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json', 
          'Authorization': 'Bearer ' + apiKey 
        },
        body: JSON.stringify({
          ...payload,
          model: payload.model || (provider === 'deepseek' ? 'deepseek-chat' : 'moonshot-v1-8k')
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        return res.status(response.status).json(data);
      }
      return res.status(200).json(data);
    } else {
      return res.status(400).json({ error: { message: `Unsupported provider: ${provider}` } });
    }
  } catch (e: any) {
    return res.status(500).json({ error: { message: e.message } });
  }
}
