import type { VercelRequest, VercelResponse } from '@vercel/node';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const { type } = req.query;
  if (!type) return res.status(400).json({ error: "Type is required" });

  // Mapping for different APIs
  const typeMap: Record<string, any> = {
    'toutiao': { vvhan: 'toutiao', reall: 'toutiao' },
    '36Kr': { vvhan: '36Kr', reall: '36kr' },
    'huXiu': { vvhan: 'huXiu', reall: 'huxiu' },
    'zhihuHot': { vvhan: 'zhihuHot', reall: 'zhihu' },
    'thePaper': { vvhan: 'thePaper', reall: 'thepaper' },
    'netease': { vvhan: 'netease', reall: 'netease' },
    'sina': { vvhan: 'sina', reall: 'sina' },
    'baidu': { vvhan: 'baidu', reall: 'baidu' },
    'weibo': { vvhan: 'weibo', reall: 'weibo' },
    'bilibili': { vvhan: 'bilibili', reall: 'bilibili' },
    'itHome': { vvhan: 'itHome', reall: 'ithome' },
    'juejin': { vvhan: 'juejin', reall: 'juejin' },
    'sspai': { vvhan: 'sspai', reall: 'sspai' }
  };

  const mapping = typeMap[type as string] || { vvhan: type, reall: type };

  const sources = [
    `https://api.vvhan.com/api/hotlist?type=${mapping.vvhan}`,
    `https://dailyhot.api.reall.me/get/${mapping.reall}`,
    `https://daily-hot-api-vercel-mu.vercel.app/${mapping.reall}`,
    `https://tenapi.cn/v2/resou?type=${mapping.reall}`,
    `https://api.it610.com/hot/${mapping.reall}`,
    `https://hot.api.swishly.xyz/get/${mapping.reall}`,
    `https://api.isoyu.com/api/news/hot?type=${mapping.reall}`,
    `https://api.pearktrue.cn/api/dailyhot/?type=${mapping.reall}`,
    `https://api.oick.cn/api/hotlist?type=${mapping.reall}`,
    `https://api.gumengya.com/api/hotlist?type=${mapping.reall}`,
    `https://api.uomg.com/api/rand.qinghua?format=json`,
    `https://v2.alapi.cn/api/tophub/get?type=${mapping.reall}&token=YOUR_TOKEN`
  ];

  // Vercel free tier has a 10s timeout for serverless functions.
  // We need to be careful with the total time.
  // We'll use a shorter timeout per source to ensure we try at least a few.
  const startTime = Date.now();
  for (const url of sources) {
    // If we've already spent 8 seconds, don't try more sources to avoid Vercel timeout
    if (Date.now() - startTime > 8000) break;

    try {
      const response = await fetch(url, { 
        signal: AbortSignal.timeout(2500), // 2.5s per source
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept': 'application/json',
          'Cache-Control': 'no-cache',
          'Pragma': 'no-cache'
        }
      });
      
      if (response.ok) {
        const data = await response.json();
        const items = data.data || data.list || data.items || data.results || [];
        if (Array.isArray(items) && items.length > 0) {
          return res.status(200).json({ data: items });
        }
      }
    } catch (error: any) {
      console.error(`[Vercel Hotlist] Error for ${url}:`, error.message);
    }
  }

  res.status(502).json({ error: "All hotlist sources failed" });
}
