import express from "express";
import Parser from "rss-parser";
import fs from "fs";
import path from "path";
import { initializeApp } from "firebase/app";
import { getFirestore, collection, getDocs, doc, setDoc, query, orderBy, limit, writeBatch } from "firebase/firestore";

const app = express();
app.use(express.json());

const rssParser = new Parser({
  headers: {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36'
  }
});

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

// Hotlist Proxy Route
app.get("/api/hotlist", async (req, res) => {
  const { type } = req.query;
  if (!type) return res.status(400).json({ error: "Type is required" });

  const typeMap: Record<string, any> = {
    'toutiao': { vvhan: 'toutiao', reall: 'toutiao' },
    '36Kr': { vvhan: '36Kr', reall: '36kr' },
    'huXiu': { vvhan: 'huXiu', reall: 'huxiu' },
    'zhihuHot': { vvhan: 'zhihuHot', reall: 'zhihu' },
    'thePaper': { vvhan: 'thePaper', reall: 'thepaper' },
    'netease': { vvhan: 'netease', reall: 'netease' },
    'sina': { vvhan: 'sina', reall: 'sina' }
  };

  const mapping = typeMap[type as string] || { vvhan: type, reall: type };

  const sources = [
    `https://api.vvhan.com/api/hotlist?type=${mapping.vvhan}`,
    `https://dailyhot.api.reall.me/get/${mapping.reall}`,
    `https://daily-hot-api-vercel-mu.vercel.app/${mapping.reall}`,
    `https://tenapi.cn/v2/resou?type=${mapping.reall}`,
    `https://api.it610.com/hot/${mapping.reall}`,
    `https://api.pearktrue.cn/api/dailyhot/?type=${mapping.reall}`,
    `https://api.oick.cn/api/hotlist?type=${mapping.reall}`,
    `https://api.gumengya.com/api/hotlist?type=${mapping.reall}`
  ];

  for (const url of sources) {
    try {
      console.log(`[Proxy] Trying source: ${url}`);
      const response = await fetch(url, { 
        headers: { 
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        },
        signal: (AbortSignal as any).timeout ? (AbortSignal as any).timeout(10000) : undefined
      });
      if (response.ok) {
        const data = await response.json();
        const items = data.data || data.list || data.items || data.results || [];
        if (Array.isArray(items) && items.length > 0) {
          console.log(`[Proxy] Success from: ${url}`);
          return res.json({ data: items });
        }
      }
    } catch (e) {
      console.warn(`[Proxy] Source failed: ${url}`);
    }
  }
  res.status(502).json({ error: "All hotlist sources failed" });
});

// Scrape Proxy Route
app.get("/api/scrape", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== 'string') {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      const isWeChat = url.includes('mp.weixin.qq.com');
      if (isWeChat) {
        const wxRes = await fetch(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 MicroMessenger/8.0.42(0x18002a2a)',
            'Accept-Language': 'zh-CN,zh;q=0.9'
          }
        });
        if (wxRes.ok) {
           const html = await wxRes.text();
           const cleanHtml = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
           return res.send(cleanHtml.substring(0, 8000));
        }
      }

      const jinaUrl = `https://r.jina.ai/${encodeURIComponent(url)}`;
      const response = await fetch(jinaUrl, {
        headers: {
          'X-With-Links-Summary': 'true',
          'User-Agent': 'Mozilla/5.0'
        }
      });

      if (response.ok) {
        const text = await response.text();
        if (text.includes('环境异常') || text.includes('验证后继续访问')) {
           return res.status(403).send("SCRAPE_BLOCKED_BY_WAF");
        }
        return res.send(text);
      }
      res.status(500).send("Scrape failed: " + response.status);
    } catch (error: any) {
      res.status(500).send(error.message);
    }
});

// AI Proxy
app.post("/api/proxy", async (req, res) => {
    const { apiKey, payload, provider, baseUrl } = req.body;
    try {
      if (!apiKey) return res.status(400).json({ error: "Missing API Key" });
      const defaultUrl = provider === 'deepseek' 
        ? 'https://api.deepseek.com/v1/chat/completions'
        : 'https://api.moonshot.cn/v1/chat/completions';
      const url = baseUrl || defaultUrl;
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      res.status(response.status).json(data);
    } catch (e: any) {
      res.status(500).json({ error: e.message });
    }
});

// Financial Live
app.get("/api/finance-live", async (req, res) => {
    try {
      const url = 'https://api-prod.wallstreetcn.com/apiv1/content/lives?channel=global-live&cursor=&limit=20';
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' }
      });
      const data = await response.json();
      const items = (data.data?.items || []).map((it: any) => ({
        title: it.content_text?.substring(0, 100),
        url: it.uri || `https://wallstreetcn.com/live/global`,
        _sourceName: '华尔街见闻-快讯'
      }));
      res.json({ data: items });
    } catch (e: any) {
      res.status(500).json({ error: e.message });
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
    try { return new URL(url).hostname.replace(/^www\./, ''); }
    catch { return url; }
  }

  function stripHtml(s: string): string {
    return s.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
  }

  console.log(`[SearchTopic] Query: "${topic}" (freshness=${freshness}, zone=${zone}, engine=${engine})`);

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
        signal: AbortSignal.timeout(10000),
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
          title: r.title || '', url: r.url || '',
          source: r.source || extractDomain(r.url || ''),
          snippet: r.snippet || r.content || r.description || '',
          date: r.date || r.published || '',
        }));
        usedAnySearch = true;
      }
    } catch (e: any) {
      console.warn('[SearchTopic] AnySearch failed:', e.message);
    }
  }

  if (!usedAnySearch && engine !== 'sina' && rawResults.length === 0) {
    try {
      const jinaUrl = `https://s.jina.ai/${encodeURIComponent(topic)}`;
      const jinaRes = await fetch(jinaUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/plain' },
        signal: AbortSignal.timeout(8000),
      });
      if (jinaRes.ok) {
        const md = await jinaRes.text();
        const blocks = md.split(/\n\n(?=Title:|\d+\.\s+|###\s)/);
        for (const block of blocks) {
          const titleMatch = block.match(/(?:Title:|^#+\s*|^\d+\.\s*)\s*(.+?)(?:\n|$)/m);
          const urlMatch = block.match(/(?:URL:|https?:\/\/\S+)/g);
          const url = urlMatch ? urlMatch.map(u => u.replace('URL:', '').trim()).find(u => u.startsWith('http')) || '' : '';
          if (titleMatch && url) {
            rawResults.push({
              title: titleMatch[1].trim(), url,
              source: extractDomain(url),
              snippet: block.substring(0, 300).replace(titleMatch[0], '').trim(),
              date: '',
            });
          }
        }
      }
    } catch (e: any) {
      console.warn('[SearchTopic] Jina fallback failed:', e.message);
    }
  }

  if (rawResults.length === 0) {
    return res.json({ results: [], warning: '当前选题暂无搜索结果。建议调整关键词或扩大搜索范围。', usedFallback: !usedAnySearch });
  }

  const enrichedResults: any[] = rawResults.map((r, i) => ({
    ...r, index: i + 1,
    authorityLevel: classifySource(r.url || r.source),
    authorityScore: 3, relevanceScore: 3,
    summary: r.snippet || '',
  }));

  if (DEEPSEEK_KEY) {
    try {
      const itemsForEval = rawResults
        .map((r, i) => `[${i + 1}] 标题: ${r.title}\n    来源: ${r.source}\n    片段: ${r.snippet?.substring(0, 200) || '无'}`)
        .join('\n\n');

      const dsRes = await fetch('https://api.deepseek.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${DEEPSEEK_KEY}` },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages: [{ role: 'user', content: `你是资深新闻编辑。对以下 ${rawResults.length} 篇搜索结果评估质量。\n\n【待评估条目】：\n${itemsForEval}\n\n严格按 JSON 输出：\n{"items":[{"index":1,"authorityScore":5,"relevanceScore":4,"summary":"150-200字中文摘要"},...]}` }],
          max_tokens: 4000, temperature: 0.1,
          response_format: { type: 'json_object' },
        }),
        signal: AbortSignal.timeout(25000),
      });

      if (dsRes.ok) {
        const dsData = await dsRes.json();
        const content = dsData.choices?.[0]?.message?.content || '';
        const firstBrace = content.indexOf('{');
        const lastBrace = content.lastIndexOf('}');
        if (firstBrace !== -1 && lastBrace !== -1) {
          const parsed = JSON.parse(content.substring(firstBrace, lastBrace + 1));
          const scoreMap = new Map((parsed.items || []).map((s: any) => [s.index, s]));
          for (const r of enrichedResults as any[]) {
            const score: any = scoreMap.get(r.index);
            if (score) {
              r.authorityScore = score.authorityScore || r.authorityScore;
              r.relevanceScore = score.relevanceScore || r.relevanceScore;
              r.summary = score.summary || r.summary;
            }
          }
        }
      }
    } catch (e: any) {
      console.warn('[SearchTopic] DeepSeek scoring failed:', e.message);
    }
  }

  enrichedResults.sort((a, b) => (b.authorityScore + b.relevanceScore) - (a.authorityScore + a.relevanceScore));
  const filtered = enrichedResults.filter(r => r.authorityScore + r.relevanceScore >= 4);
  const finalResults = filtered.slice(0, 10);

  res.json({
    results: finalResults, query: topic, engine,
    totalFound: rawResults.length, returned: finalResults.length,
    usedAnySearch,
  });
});

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

// Admin audit logs routes
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

  const logEntry = {
    id: newLog.id || Math.random().toString(36).substring(2, 11),
    timestamp: newLog.timestamp || new Date().toISOString(),
    epoch: newLog.epoch || Date.now(),
    action: newLog.action,
    title: newLog.title || "",
    draftMeta: newLog.draftMeta || "",
    referencesCount: typeof newLog.referencesCount === "number" ? newLog.referencesCount : 0,
    wordCount: typeof newLog.wordCount === "number" ? newLog.wordCount : 0,
    operator: newLog.operator || "guest",
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

export default app;
