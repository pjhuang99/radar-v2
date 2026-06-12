import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";
import Parser from "rss-parser";
import fs from "fs";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc, query, orderBy, limit, writeBatch } from "firebase/firestore";

dotenv.config();

const rssParser = new Parser();

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json());

  // RSS Proxy Route
  app.get("/api/rss", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      console.log(`[RSS] Fetching: ${url}`);
      const feed = await rssParser.parseURL(url);
      res.json({ data: feed });
    } catch (error: any) {
      console.error(`[RSS] Error fetching ${url}:`, error.message);
      res.status(500).json({ error: "Failed to fetch RSS feed: " + error.message });
    }
  });

  // Scrape Proxy Route
  app.get("/api/scrape", async (req, res) => {
    let { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      // Emergency Resolve for Google News URLs if they reached here
      if (url.includes('news.google.com/rss/articles/')) {
        console.log(`[Scrape] Emergency resolving Google URL: ${url}`);
        try {
          const parts = url.split('/articles/');
          if (parts.length > 1) {
             const decoded = Buffer.from(parts[1].split('?')[0], 'base64').toString('utf-8');
             const match = decoded.match(/https?:\/\/[^\s\0\x01-\x1F]+/);
             if (match) url = match[0];
          }
        } catch(e) {}
      }

      console.log(`[Scrape] Proxying for: ${url}`);
      
      const isWeChat = url.includes('mp.weixin.qq.com');
      
      // For WeChat, try a specific Direct Fetch first because Jina is often blocked
      if (isWeChat) {
        console.log(`[Scrape] Detected WeChat, using specialty headers...`);
        try {
          const wxRes = await fetch(url, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 MicroMessenger/8.0.42(0x18002a2a) NetType/WIFI Language/zh_CN',
              'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
              'Accept-Language': 'zh-CN,zh;q=0.9,en-US;q=0.8,en;q=0.7',
              'Cache-Control': 'no-cache',
              'Pragma': 'no-cache'
            },
            signal: AbortSignal.timeout(15000)
          });
          
          if (wxRes.ok) {
            const html = await wxRes.ok ? await wxRes.text() : '';
            if (html.includes('js_content') || html.includes('rich_media_content')) {
              console.log(`[Scrape] WeChat Direct Success`);
              // Basic cleaning of WeChat HTML to reduce token usage
              const cleanHtml = html
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\s+/g, ' ')
                .trim();
              return res.send(cleanHtml.substring(0, 8000));
            }
          }
        } catch (e) {
          console.warn(`[Scrape] WeChat Direct failed, falling back to Jina...`, e);
        }
      }

      // Default: Use Jina
      const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
      const response = await fetch(jinaUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept': 'text/plain, text/html, application/json',
          'X-With-Links-Summary': 'true'
        },
        signal: AbortSignal.timeout(30000)
      });

      if (response.ok) {
        const text = await response.text();
        // Check for common error messages in the fetched content
        if (text.includes('环境异常') || text.includes('验证后继续访问')) {
           return res.status(403).send("SCRAPE_BLOCKED_BY_WAF");
        }
        return res.send(text);
      } else {
        throw new Error(`Scraper service returned ${response.status}`);
      }
    } catch (error: any) {
      console.error(`[Scrape] Error for ${url}:`, error.message);
      res.status(500).json({ error: "Failed to scrape: " + error.message });
    }
  });

  // API Proxy Route
  app.post("/api/proxy", async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') return res.status(200).end();

    const { apiKey, payload, provider, baseUrl } = req.body;
    console.log(`Proxy Request: Provider=${provider}, Model=${payload?.model}, BaseUrl=${baseUrl || 'Default'}`);

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
          console.error(`${provider} Error Status:`, response.status, data);
          return res.status(response.status).json(data);
        }
        return res.status(200).json(data);
      } else {
        return res.status(400).json({ error: { message: `Unsupported provider: ${provider}` } });
      }
    } catch (e: any) {
      console.error("Proxy Error:", e);
      return res.status(500).json({ error: { message: e.message } });
    }
  });

  // Hotlist Proxy Route
  app.get("/api/hotlist", async (req, res) => {
    const { type } = req.query;
    if (!type) return res.status(400).json({ error: "Type is required" });

    if (type === 'tencent') {
      try {
        const url = "https://i.news.qq.com/web_backend/v2/getTagInfo?tagId=aEWqxLtdgmQ%3D";
        const tencentRes = await fetch(url, {
          headers: {
            Referer: "https://news.qq.com/"
          },
          signal: AbortSignal.timeout(10000)
        });
        if (tencentRes.ok) {
          const data = await tencentRes.json();
          const items = data.data.tabs[0].articleList.map((item: any, index: number) => ({
            id: item.id || String(index + 1),
            title: item.title,
            url: item.link_info?.url || '',
            hot: '',
            desc: item.desc || ''
          }));
          return res.json({ data: items });
        }
      } catch (e: any) {
        console.error(`[Proxy] Tencent Fetch Error:`, e.message);
      }
      return res.status(502).json({ error: "Tencent source failed" });
    }

    // Mapping for different APIs
    const typeMap: Record<string, any> = {
      'toutiao': { vvhan: 'toutiao', reall: 'toutiao', pearkTitle: '今日头条' },
      '36Kr': { vvhan: '36Kr', reall: '36kr', pearkTitle: '36氪' },
      'zhihuHot': { vvhan: 'zhihuHot', reall: 'zhihu', pearkTitle: '知乎' },
      'thePaper': { vvhan: 'thePaper', reall: 'thepaper', pearkTitle: '澎湃新闻' },
      'netease': { vvhan: 'netease', reall: 'netease', pearkTitle: '网易' },
      'sina': { vvhan: 'sina', reall: 'sina', pearkTitle: '新浪新闻' },
      'douyin': { vvhan: 'douyin', reall: 'douyin', pearkTitle: '抖音' }
    };

    const mapping = typeMap[type as string] || { vvhan: type, reall: type, pearkTitle: type };

    const sources = [
      `https://api.pearktrue.cn/api/dailyhot/?title=${encodeURIComponent(mapping.pearkTitle)}`,
      `https://api.vvhan.com/api/hotlist?type=${mapping.vvhan}`,
      `https://dailyhot.api.reall.me/get/${mapping.reall}`,
      `https://daily-hot-api-vercel-mu.vercel.app/${mapping.reall}`,
      `https://tenapi.cn/v2/resou?type=${mapping.reall}`,
      `https://api.it610.com/hot/${mapping.reall}`,
      `https://hot.api.swishly.xyz/get/${mapping.reall}`,
      `https://api.isoyu.com/api/news/hot?type=${mapping.reall}`,
      `https://api.oick.cn/api/hotlist?type=${mapping.reall}`,
      `https://api.gumengya.com/api/hotlist?type=${mapping.reall}`
    ];

    for (const url of sources) {
      try {
        console.log(`[Proxy] Trying source: ${url}`);
        const response = await fetch(url, { 
          signal: AbortSignal.timeout(12000),
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
            'Accept': 'application/json',
            'Cache-Control': 'no-cache',
            'Pragma': 'no-cache'
          }
        });
        
        if (response.ok) {
          const data = await response.json();
          // Normalize data structure
          const items = data.data || data.list || data.items || data.results || [];
          if (Array.isArray(items) && items.length > 0) {
            console.log(`[Proxy] Success from: ${url} (${items.length} items)`);
            return res.json({ data: items });
          }
        }
        console.warn(`[Proxy] Source failed or returned empty: ${url} (Status: ${response.status})`);
      } catch (error: any) {
        console.error(`[Proxy] Fetch Error for ${url}:`, error.message);
      }
    }

    res.status(502).json({ error: "All hotlist sources failed" });
  });

  // Financial Live Feed Proxy (Wallstreetcn)
  app.get("/api/finance-live", async (req, res) => {
    try {
      const url = 'https://api-prod.wallstreetcn.com/apiv1/content/lives?channel=global-live&cursor=&limit=20';
      const response = await fetch(url, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      });
      if (!response.ok) throw new Error('WSCN API failed');
      const data = await response.json();
      
      // Normalize to RawItem format
      const items = (data.data?.items || []).map((it: any) => ({
        title: it.content_text?.substring(0, 100) + (it.content_text?.length > 100 ? '...' : ''),
        fullContent: it.content_text,
        url: it.uri || `https://wallstreetcn.com/live/global`,
        _sourceName: '华尔街见闻-快讯',
        createdAt: it.display_time * 1000
      }));
      
      res.json({ data: items });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // Topic Search Route - AI-powered news discovery for writing workflow
  app.post("/api/search-topic", async (req, res) => {
    const { topic, freshness = "month", zone = "cn", engine = "anysearch" } = req.body;
    if (!topic || typeof topic !== 'string' || topic.trim().length === 0) {
      return res.status(400).json({ error: "Topic is required" });
    }

    const ANYSEARCH_KEY = process.env.ANYSEARCH_API_KEY || '';
    const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || '';

    // Authority whitelist (mirrored from src/config/sources.ts)
    const AUTHORITY_HIGH = [
      'caixin.com','yicai.com','eeo.com.cn','xinhuanet.com','people.com.cn',
      'thepaper.cn','cctv.com','chinanews.com','inewsweek.cn','caijing.com.cn',
      'nbd.com.cn','21jingji.com','jiemian.com',
      'reuters.com','bloomberg.com','ft.com','wsj.com','nytimes.com',
      'economist.com','washingtonpost.com','bbc.com','apnews.com','npr.org',
    ];
    const AUTHORITY_MEDIUM = [
      '36kr.com','huxiu.com','tmtpost.com','latepost.com','geekpark.net',
      'cls.cn','stcn.com','guancha.cn',
      'techcrunch.com','wired.com','theverge.com','arstechnica.com',
      'fortune.com','cnbc.com','businessinsider.com','forbes.com',
      'fastcompany.com','axios.com','vox.com',
    ];

    function classifySource(urlOrSource: string): 'high' | 'medium' | 'unknown' {
      const n = urlOrSource.toLowerCase();
      if (AUTHORITY_HIGH.some(d => n.includes(d))) return 'high';
      if (AUTHORITY_MEDIUM.some(d => n.includes(d))) return 'medium';
      return 'unknown';
    }

    function extractDomain(url: string): string {
      try {
        return new URL(url).hostname.replace(/^www\./, '');
      } catch {
        return url;
      }
    }

    function stripHtml(s: string): string {
      return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
    }

    console.log(`[SearchTopic] Query: "${topic}" (freshness=${freshness}, zone=${zone}, engine=${engine})`);

    // --- Step 1: Search (AnySearch, Sina, or Jina fallback) ---
    let rawResults: any[] = [];
    let usedAnySearch = false;

    if (engine === 'sina') {
      // --- Sina Search (direct API) ---
      try {
        const sinaUrl = `https://interface.sina.cn/homepage/search.d.json?t=&q=${encodeURIComponent(topic)}&pf=0&ps=0&page=1&sort=time&num=12&ie=utf-8`;
        const sinaRes = await fetch(sinaUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Referer': 'https://search.sina.com.cn/',
          },
          signal: AbortSignal.timeout(12000),
        });
        if (sinaRes.ok) {
          const data = await sinaRes.json();
          const list = data?.result?.list || [];
          rawResults = list.map((r: any) => ({
            title: (r.origin_title || r.title || '').replace(/<[^>]+>/g, ''),
            url: r.url || '',
            source: r.media || extractDomain(r.url || ''),
            snippet: stripHtml(r.intro || ''),
            date: r.datetime || '',
          }));
          console.log(`[SearchTopic] Sina returned ${rawResults.length} results`);
        } else {
          const errText = await sinaRes.text().catch(() => '');
          console.warn(`[SearchTopic] Sina responded with ${sinaRes.status}: ${errText.substring(0, 200)}`);
        }
      } catch (e: any) {
        console.warn('[SearchTopic] Sina search failed:', e.message);
      }
    } else if (ANYSEARCH_KEY) {
      // --- AnySearch ---
      try {
        const freshnessHints: Record<string, string> = {
          day: ' today OR "last 24 hours" OR 最新',
          week: ' this week OR 本周 OR recent',
          month: ' 2026 OR this month',
        };
        const enhancedQuery = topic + (freshnessHints[freshness] || '');

        const searchRes = await fetch('https://api.anysearch.com/v1/search', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${ANYSEARCH_KEY}`,
          },
          body: JSON.stringify({
            query: enhancedQuery,
            max_results: 12,
          }),
          signal: AbortSignal.timeout(15000),
        });

        if (searchRes.ok) {
          const data = await searchRes.json();
          const results = data?.data?.results || data?.results || [];
          rawResults = results.map((r: any) => ({
            title: r.title || '',
            url: r.url || '',
            source: r.source || extractDomain(r.url || ''),
            snippet: r.snippet || r.content || r.description || '',
            date: r.date || r.published || r.metadata?.date || '',
          }));
          usedAnySearch = true;
          console.log(`[SearchTopic] AnySearch returned ${rawResults.length} results`);
        }
      } catch (e: any) {
        console.warn('[SearchTopic] AnySearch failed:', e.message);
      }
    }

    // --- Step 1b: Fallback to Jina Search ---
    if (!usedAnySearch && engine !== 'sina' && rawResults.length === 0) {
      try {
        const jinaUrl = `https://s.jina.ai/${encodeURIComponent(topic)}`;
        const jinaRes = await fetch(jinaUrl, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'text/plain',
          },
          signal: AbortSignal.timeout(10000),
        });
        if (jinaRes.ok) {
          const md = await jinaRes.text();
          const blocks = md.split(/\n\n(?=Title:|\d+\.\s+|###\s)/);
          for (const block of blocks) {
            const titleMatch = block.match(/(?:Title:|^#+\s*|^\d+\.\s*)\s*(.+?)(?:\n|$)/m);
            const urlMatch = block.match(/(?:URL:|https?:\/\/\S+)/g);
            const url = urlMatch
              ? urlMatch.map(u => u.replace('URL:', '').trim()).find(u => u.startsWith('http')) || ''
              : '';
            if (titleMatch && url) {
              rawResults.push({
                title: titleMatch[1].trim(),
                url,
                source: extractDomain(url),
                snippet: block.substring(0, 300).replace(titleMatch[0], '').trim(),
                date: '',
              });
            }
          }
          console.log(`[SearchTopic] Jina fallback returned ${rawResults.length} results`);
        }
      } catch (e: any) {
        console.warn('[SearchTopic] Jina fallback failed:', e.message);
      }
    }

    if (rawResults.length === 0) {
      return res.json({
        results: [],
        warning: '当前选题暂无搜索结果。建议调整关键词或扩大搜索范围。',
        usedFallback: !usedAnySearch,
      });
    }

    // --- Step 2: DeepSeek quality scoring + summarization (single call) ---
    const enrichedResults: any[] = rawResults.map((r, i) => ({
      ...r,
      index: i + 1,
      authorityLevel: classifySource(r.url || r.source),
      authorityScore: 3,
      relevanceScore: 3,
      summary: r.snippet || '',
    }));

    if (DEEPSEEK_KEY) {
      try {
        const itemsForEval = rawResults
          .map((r, i) => `[${i + 1}] 标题: ${r.title}\n    来源: ${r.source}\n    URL: ${r.url}\n    片段: ${r.snippet?.substring(0, 200) || '无'}`)
          .join('\n\n');

        const evalPrompt = `你是资深新闻编辑。对以下 ${rawResults.length} 篇搜索结果进行质量评估。

【待评估条目】：
${itemsForEval}

【任务】：对每篇进行三项评估：
1. authorityScore (1-5): 来源权威性。5=顶级权威媒体(如Reuters/财新/新华社), 4=知名媒体(如36氪/虎嗅), 3=一般媒体, 2=自媒体/个人博客, 1=不可靠来源
2. relevanceScore (1-5): 与选题"${topic}"的直接相关性。5=完全直接相关, 3=部分相关, 1=几乎无关
3. summary: 150-200字的高信息密度摘要。包含具体数据、核心论点、关键人物/机构。用中文撰写。如果原文片段信息不足，写"信息不足，建议直接阅读原文"。

严格按 JSON 格式输出，不要包含 Markdown 标记：
{
  "items": [
    {"index": 1, "authorityScore": 5, "relevanceScore": 4, "summary": "..."},
    ...
  ]
}`;

        const dsRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${DEEPSEEK_KEY}`,
          },
          body: JSON.stringify({
            model: 'deepseek-chat',
            messages: [{ role: 'user', content: evalPrompt }],
            max_tokens: 4000,
            temperature: 0.1,
            response_format: { type: 'json_object' },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (dsRes.ok) {
          const dsData = await dsRes.json();
          const content = dsData.choices?.[0]?.message?.content || '';
          const firstBrace = content.indexOf('{');
          const lastBrace = content.lastIndexOf('}');
          if (firstBrace !== -1 && lastBrace !== -1) {
            const parsed = JSON.parse(content.substring(firstBrace, lastBrace + 1));
            const scored = parsed.items || [];
            const scoreMap = new Map(scored.map((s: any) => [s.index, s]));

            let updated = 0;
            for (const r of enrichedResults as any[]) {
              const score: any = scoreMap.get(r.index);
              if (score) {
                r.authorityScore = score.authorityScore || r.authorityScore;
                r.relevanceScore = score.relevanceScore || r.relevanceScore;
                r.summary = score.summary || r.summary;
                updated++;
              }
            }
            console.log(`[SearchTopic] DeepSeek scored ${updated} items`);
          }
        }
      } catch (e: any) {
        console.warn('[SearchTopic] DeepSeek scoring failed, using unranked results:', e.message);
      }
    }

    // --- Step 3: Sort by combined score, filter low-quality ---
    enrichedResults.sort(
      (a, b) => (b.authorityScore + b.relevanceScore) - (a.authorityScore + a.relevanceScore)
    );

    const filtered = enrichedResults.filter(r => r.authorityScore + r.relevanceScore >= 4);
    const finalResults = filtered.slice(0, 10);

    res.json({
      results: finalResults,
      query: topic,
      engine,
      totalFound: rawResults.length,
      returned: finalResults.length,
      usedAnySearch,
    });
  });

  // Store audit logs in-memory + write to file
  let devAuditLogs: any[] = [];
  const logFilePath = path.join(process.cwd(), "audit_logs.json");

  const INITIAL_MOCK_AUDIT_LOGS = [
    {
      id: "mock-log-1",
      timestamp: "2026-05-26T01:45:00Z",
      epoch: Date.now() - 3600000 * 1,
      action: "开始排版写作",
      title: "DeepSeek企业级私有化落地全景观察：高性价比替代方案的得与失",
      draftMeta: "[ 模型: deepseek-chat | 模式: 事实优先 | 立场: 平衡派 ]",
      referencesCount: 3,
      wordCount: 1150,
      operator: "peijian@gmail.com",
      articleBody: `### 核心判断：大模型本地化落地的普惠账本与隐形成本\n\n近期关于企业私有化部署大模型的调研显示，绝大多数中等规模研发团队已转向具有极致性价比的开源基座架构（如 DeepSeek-V3/R1 架构）。然而，低采购价是否等同于低落地成本，正在成为全行业热议的分水岭性议题。这是一个由财务红利与技术路径变迁共同决定的行业阵痛期。\n\n#### 一、性能与能耗的非线性博弈\n评估私有化可行性时，企业往往陷入“算力即正义”的片面考量。以某核电设备研发中心的知识库升级为例，其采用私有化本地集群运行模型。尽管采购硬件一次性付清，但其配套的精密高密度制冷机房、全天候机架能耗、专用双路不间断电源等隐藏维护开销，在三年折旧期内折合年度成本，几乎是直接调用公有云极低 API 代价的 3.4 倍。这印证了私有部署中不可忽略的运行费效比黑洞。\n\n#### 二、安全红线之下的价值归置\n当然，私有化部署绝非一无是处。对于核心科技知识产权、高保密规格设计图纸以及战略决策会谈紀要等“极度敏感数据”，任何基于公有云的防泄漏防线都存在概率级漏洞陷阱。将生产力算法限制在物理网闸隔离的局域网内部服务器上，提供绝对物理安全级别的知识资产隔离，是大型央国企在当前大航海时代唯一的合规出路。\n\n#### 结论\n中小微创新团队建议坚守 API 廉价调用策略，敏捷迭代；核心涉密国资企业则需坦然承受维护溢价，坚定推进私有底座部署。`
    },
    {
      id: "mock-log-2",
      timestamp: "2026-05-25T19:30:00Z",
      epoch: Date.now() - 3600000 * 7,
      action: "自由创作写作",
      title: "星舰第六次试飞：重现多发动机故障模拟与未来星际港湾的工程狂想",
      draftMeta: "[ 模型: deepseek-chat | 模式: 理念主导 | 立场: 犀利批判 ]",
      referencesCount: 2,
      wordCount: 1220,
      operator: "peijian@gmail.com",
      articleBody: `### 核心解析：重载飞行的工程阵痛与航天探索的狂欢叙事\n\n本周SpaceX星舰（Starship）迎来了举世瞩目的第六次轨道级试飞。尽管超重型助推器按照预设安全程序最终在墨西哥湾海域实施了“水上软着陆”，未能重现第五次试飞中令人屏息的“发射塔筷子夹火箭”壮举，但这绝非研发倒退，而是SpaceX对系统临界状态进行的极限抗压施测。它暴露了高频重复发射在工程实践中的硬性短板，是对极尽理想主义的商业民营航天叙事的一记清醒警钟。\n\n#### 一、主动受控复燃与冗余度的非线性博弈\n从技术回放细节来看，助推器在降回高度约8公里时，控制中心临时取消了捕捉指令。主因由于测控遥感数据判定助推器的两台猛禽发动机在二次点火段发生了推力不对称的微小偏移。在保障极度复杂的发射塔台地基设施免受物理损毁，与强行回收试错之间，智力判断做出了完全理性的工程择决。这印证了我们的核心论点：多发动机并联方案具有极高的运载余裕，但也呈几何级数增加了阀门组件与管路协调的概率系统风险。单纯宣扬“大步快跑、以炸代修”的技术神格，恰恰是在掩盖制造业工程高不确定性本身的阵痛。\n\n#### 二、防热盾瓦的系统重构与临界突围\n更加引人瞩目的是上级飞船在重返大气层阶段的表现。此次飞船特意拆除了两侧部分高风险防热瓷砖，用新型极耐高温钢制板替代，并尝试在极端侧滑角下实施大攻角偏航。这为未来的快速重复使用收集到了极其难得的手动极限偏航操控模型。如果一艘号称要承载百吨级载荷的星际飞船依旧像传统宇航系统那样，在每次飞行后都需要高昂的工时去手工修补、检验防热覆膜，那么其所谓的“极低边际成本”终将沦为纸面逻辑的又一次游戏。我们必须紧盯的是，它能否在接下来的第七次星际飞行中，完成全钢外廊下无烧蚀重返——这才是星际运输港真正开闸的唯一衡量红线。`
    },
    {
      id: "mock-log-3",
      timestamp: "2026-05-25T11:22:00Z",
      epoch: Date.now() - 3600000 * 15,
      action: "开始排版写作",
      title: "中国新能源汽车出海欧洲的贸易关税博弈分析：寻找非摩擦突破口",
      draftMeta: "[ 模型: deepseek-chat | 模式: 事实优先 | 立场: 逻辑因果 ]",
      referencesCount: 2,
      wordCount: 1530,
      operator: "peijian@gmail.com",
      articleBody: `#### 引言：关税大棒下的贸易反思\n\n今年欧洲对华新能源汽车加征额外平均关税落地，标志着仅依靠传统物理出口的低溢价扩张模式宣告阶段性结束。然而，国内一些乐观叙事对此企图蔑视，认为通过第三国转运、中亚渠道即可消解摩擦。我们必须冷眼指出：这种战术机巧，正在掩盖我们在底层法律合规和本土化研发合作上的战略懒惰。\n\n#### 一、第三国重包装的合规红线漏洞\n依靠在北非或东南亚建立简易散件拼装（KD）工厂，试图通过“洗产地”避开原产地溯源，这是完全小看欧盟反规避调查部门的专业度。从电芯原产地到车机控制软件的编译所属权，当下的穿透性合规审计已经可以追溯至二级、三级零配件供应商极其源头。在欧盟数字电池护照（Digital Battery Passport）与相关法规层层盘查下，任何不具备真实本土采购、本地员工吸纳、本地产值比例小于40%的投机工厂，最终都将在2027年之前的过渡期遭遇更具毁灭性的二次定向清算。\n\n#### 二、以“产研出海”替代“产力外流”的重塑之路\n真正的出海是从单纯的产品出口，转变为本土化的研发深度融合。例如部分优秀厂商已经开始在匈牙利、德国建立全谱系工程研发中心，让国内的软硬件技术优势与西欧本地的供应链及汽车安全标准体系深度嵌套。不仅是转移过剩产能，更是通过本地税收贡献与高质量工程师工岗位的创设，把对抗升级为共同利益绑定。这是从“外来颠覆者”向“本地共建者”身份演进的华丽折返。`
    }
  ];

  // Load initial logs if file exists
  try {
    if (fs.existsSync(logFilePath)) {
      const fileData = fs.readFileSync(logFilePath, "utf-8");
      devAuditLogs = JSON.parse(fileData);
      console.log(`[Admin] Loaded ${devAuditLogs.length} audit logs from file.`);
    } else {
      devAuditLogs = [...INITIAL_MOCK_AUDIT_LOGS];
      fs.writeFileSync(logFilePath, JSON.stringify(devAuditLogs, null, 2), "utf-8");
      console.log("[Admin] Seeded initial mock audit logs to file.");
    }
  } catch (error: any) {
    console.error("[Admin] Failed to load/seed audit logs file:", error.message);
    devAuditLogs = [...INITIAL_MOCK_AUDIT_LOGS];
  }

  // Firebase Initialize Helper
  let db: any = null;
  function getDb() {
    if (db) return db;
    try {
      const configPath = path.join(process.cwd(), "firebase-applet-config.json");
      if (fs.existsSync(configPath)) {
        const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
        const firebaseApp = initializeApp(firebaseConfig);
        db = getFirestore(firebaseApp);
        return db;
      }
    } catch (e) {
      console.error("[Firebase] Init failed:", e);
    }
    return null;
  }

  app.get("/api/admin/logs", async (req, res) => {
    const firestoreDb = getDb();
    if (!firestoreDb) {
      return res.json({ data: [] });
    }
    try {
      const logsCol = collection(firestoreDb, "audit_logs");
      const q = query(logsCol, orderBy("epoch", "desc"), limit(200));
      const snapshot = await getDocs(q);
      const logs: any[] = [];
      snapshot.forEach((docSnap) => {
        logs.push(docSnap.data());
      });
      res.json({ data: logs });
    } catch (error: any) {
      console.error("[Firebase] Get audit logs failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  app.post("/api/admin/audit", async (req, res) => {
    const newLog = req.body;
    if (!newLog || !newLog.action) {
      return res.status(400).json({ error: "Invalid log entry" });
    }
    
    // Ensure standard fields
    const logEntry = {
      id: newLog.id || Math.random().toString(36).substring(2, 11),
      timestamp: newLog.timestamp || new Date().toISOString(),
      epoch: newLog.epoch || Date.now(),
      action: newLog.action,
      title: newLog.title || "",
      draftMeta: newLog.draftMeta || "",
      referencesCount: typeof newLog.referencesCount === "number" ? newLog.referencesCount : 0,
      wordCount: typeof newLog.wordCount === "number" ? newLog.wordCount : 0,
      operator: newLog.operator || "peijian@gmail.com",
      articleBody: newLog.articleBody || ""
    };

    const firestoreDb = getDb();
    if (firestoreDb) {
      try {
        const docRef = doc(firestoreDb, "audit_logs", logEntry.id);
        await setDoc(docRef, logEntry);
      } catch (error: any) {
        console.error("[Firebase] Save audit log failed:", error.message);
      }
    }

    res.json({ success: true, log: logEntry });
  });

  app.post("/api/admin/clear", async (req, res) => {
    const firestoreDb = getDb();
    if (!firestoreDb) {
      return res.json({ success: true, warning: "Firestore not initialized" });
    }
    try {
      const logsCol = collection(firestoreDb, "audit_logs");
      const snapshot = await getDocs(logsCol);
      const batch = writeBatch(firestoreDb);
      snapshot.forEach((docSnap) => {
        batch.delete(docSnap.ref);
      });
      await batch.commit();
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Firebase] Clear audit logs failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
