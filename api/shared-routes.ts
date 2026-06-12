/**
 * Shared Express route handlers for server.ts (dev) and api/index.ts (Vercel).
 *
 * All route logic lives here once. The two entry points differ only in:
 *   - server.ts: starts a listener + Vite dev middleware
 *   - api/index.ts: exports the app for Vercel serverless
 */

import express from "express";
import Parser from "rss-parser";
import fs from "fs";
import path from "path";
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  setDoc,
  query,
  orderBy,
  limit,
  writeBatch,
} from "firebase/firestore";

// ── Types ────────────────────────────────────────────────────────────────────

interface HotlistItem {
  id: string;
  title: string;
  url: string;
  hot: string;
  desc: string;
}

interface SearchResultRaw {
  title: string;
  url: string;
  source: string;
  snippet: string;
  date: string;
}

interface SearchResultEnriched extends SearchResultRaw {
  index: number;
  authorityLevel: "high" | "medium" | "unknown";
  authorityScore: number;
  relevanceScore: number;
  summary: string;
}

// ── Authority whitelist (single source of truth) ─────────────────────────────

const AUTHORITY_HIGH = [
  "caixin.com", "yicai.com", "eeo.com.cn", "xinhuanet.com", "people.com.cn",
  "cctv.com", "chinanews.com", "inewsweek.cn", "caijing.com.cn",
  "nbd.com.cn", "21jingji.com", "jiemian.com",
  "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "nytimes.com",
  "economist.com", "washingtonpost.com", "bbc.com", "apnews.com", "npr.org",
];

const AUTHORITY_MEDIUM = [
  "36kr.com", "huxiu.com", "tmtpost.com", "latepost.com", "geekpark.net",
  "cls.cn", "stcn.com", "guancha.cn", "thepaper.cn",
  "techcrunch.com", "wired.com", "theverge.com", "arstechnica.com",
  "fortune.com", "cnbc.com", "businessinsider.com", "forbes.com",
  "fastcompany.com", "axios.com", "vox.com",
];

function classifySource(urlOrSource: string): "high" | "medium" | "unknown" {
  const n = urlOrSource.toLowerCase();
  if (AUTHORITY_HIGH.some((d) => n.includes(d))) return "high";
  if (AUTHORITY_MEDIUM.some((d) => n.includes(d))) return "medium";
  return "unknown";
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function stripHtml(s: string): string {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ── Hotlist config (unified source list) ─────────────────────────────────────

const HOTLIST_SOURCES: string[] = [
  "https://api.pearktrue.cn/api/dailyhot/?title={title}",
  "https://api.vvhan.com/api/hotlist?type={vvhan}",
  "https://dailyhot.api.reall.me/get/{reall}",
  "https://daily-hot-api-vercel-mu.vercel.app/{reall}",
  "https://tenapi.cn/v2/resou?type={reall}",
  "https://api.it610.com/hot/{reall}",
  "https://hot.api.swishly.xyz/get/{reall}",
  "https://api.isoyu.com/api/news/hot?type={reall}",
  "https://api.oick.cn/api/hotlist?type={reall}",
  "https://api.gumengya.com/api/hotlist?type={reall}",
];

const HOTLIST_TYPE_MAP: Record<string, { vvhan: string; reall: string; title: string }> = {
  toutiao: { vvhan: "toutiao", reall: "toutiao", title: "今日头条" },
  "36Kr": { vvhan: "36Kr", reall: "36kr", title: "36氪" },
  zhihuHot: { vvhan: "zhihuHot", reall: "zhihu", title: "知乎" },
  thePaper: { vvhan: "thePaper", reall: "thepaper", title: "澎湃新闻" },
  netease: { vvhan: "netease", reall: "netease", title: "网易" },
  sina: { vvhan: "sina", reall: "sina", title: "新浪新闻" },
  douyin: { vvhan: "douyin", reall: "douyin", title: "抖音" },
};

// ── Firebase helper ──────────────────────────────────────────────────────────

let _db: ReturnType<typeof getFirestore> | null = null;

function getDb(): ReturnType<typeof getFirestore> | null {
  if (_db) return _db;
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const firebaseConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      _db = getFirestore(initializeApp(firebaseConfig));
      return _db;
    }
  } catch (e) {
    console.error("[Firebase] Init failed:", e);
  }
  return null;
}

// ── Main export: register all routes on an Express app ───────────────────────

export function registerSharedRoutes(app: express.Express) {
  app.use(express.json());

  // ── RSS Proxy ────────────────────────────────────────────────────────────
  const rssParser = new Parser({
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    },
  });

  app.get("/api/rss", async (req, res) => {
    const { url } = req.query;
    if (!url || typeof url !== "string") {
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

  // ── Scrape Proxy ─────────────────────────────────────────────────────────
  app.get("/api/scrape", async (req, res) => {
    let { url } = req.query;
    if (!url || typeof url !== "string") {
      return res.status(400).json({ error: "URL is required" });
    }

    try {
      // Emergency resolve for Google News URLs
      if (url.includes("news.google.com/rss/articles/")) {
        console.log(`[Scrape] Emergency resolving Google URL: ${url}`);
        try {
          const parts = url.split("/articles/");
          if (parts.length > 1) {
            const decoded = Buffer.from(parts[1].split("?")[0], "base64").toString("utf-8");
            const match = decoded.match(/https?:\/\/[^\s\0\x01-\x1F]+/);
            if (match) url = match[0];
          }
        } catch {
          /* best-effort */
        }
      }

      console.log(`[Scrape] Proxying for: ${url}`);

      // WeChat: try direct fetch first (Jina is often blocked)
      if (url.includes("mp.weixin.qq.com")) {
        console.log(`[Scrape] Detected WeChat, using specialty headers...`);
        try {
          const wxRes = await fetch(url, {
            headers: {
              "User-Agent":
                "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 MicroMessenger/8.0.42(0x18002a2a) NetType/WIFI Language/zh_CN",
              "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
              "Accept-Language": "zh-CN,zh;q=0.9",
            },
            signal: AbortSignal.timeout(15000),
          });
          if (wxRes.ok) {
            const html = await wxRes.text();
            if (html.includes("js_content") || html.includes("rich_media_content")) {
              console.log(`[Scrape] WeChat Direct Success`);
              const cleanHtml = html
                .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
                .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
                .replace(/<[^>]+>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
              return res.send(cleanHtml.substring(0, 8000));
            }
          }
        } catch {
          console.warn(`[Scrape] WeChat Direct failed, falling back to Jina...`);
        }
      }

      // Default: Jina
      const response = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
        headers: {
          "User-Agent":
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
          "Accept": "text/plain, text/html, application/json",
          "X-With-Links-Summary": "true",
        },
        signal: AbortSignal.timeout(30000),
      });

      if (response.ok) {
        const text = await response.text();
        if (text.includes("环境异常") || text.includes("验证后继续访问")) {
          return res.status(403).send("SCRAPE_BLOCKED_BY_WAF");
        }
        return res.send(text);
      }
      throw new Error(`Scraper service returned ${response.status}`);
    } catch (error: any) {
      console.error(`[Scrape] Error for ${url}:`, error.message);
      res.status(500).json({ error: "Failed to scrape: " + error.message });
    }
  });

  // ── AI Proxy ─────────────────────────────────────────────────────────────
  app.post("/api/proxy", async (req, res) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(200).end();

    const { apiKey, payload, provider, baseUrl } = req.body;
    console.log(`[Proxy] Provider=${provider}, Model=${payload?.model}`);

    try {
      if (!apiKey) return res.status(400).json({ error: { message: "API Key is missing" } });

      if (provider === "deepseek" || provider === "moonshot") {
        const defaultUrl =
          provider === "deepseek"
            ? "https://api.deepseek.com/v1/chat/completions"
            : "https://api.moonshot.cn/v1/chat/completions";

        let apiUrl = defaultUrl;
        if (baseUrl) {
          apiUrl = baseUrl.includes("chat/completions")
            ? baseUrl
            : baseUrl.endsWith("/")
              ? baseUrl + "chat/completions"
              : baseUrl + "/chat/completions";
        }

        const response = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: "Bearer " + apiKey,
          },
          body: JSON.stringify({
            ...payload,
            model: payload.model || (provider === "deepseek" ? "deepseek-chat" : "moonshot-v1-8k"),
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          console.error(`[Proxy] ${provider} Error:`, response.status, data);
          return res.status(response.status).json(data);
        }
        return res.status(200).json(data);
      }
      return res.status(400).json({ error: { message: `Unsupported provider: ${provider}` } });
    } catch (e: any) {
      console.error("[Proxy] Error:", e);
      return res.status(500).json({ error: { message: e.message } });
    }
  });

  // ── Hotlist Proxy ────────────────────────────────────────────────────────
  app.get("/api/hotlist", async (req, res) => {
    const { type } = req.query;
    if (!type) return res.status(400).json({ error: "Type is required" });

    // Tencent has its own API
    if (type === "tencent") {
      try {
        const tencentRes = await fetch(
          "https://i.news.qq.com/web_backend/v2/getTagInfo?tagId=aEWqxLtdgmQ%3D",
          { headers: { Referer: "https://news.qq.com/" }, signal: AbortSignal.timeout(10000) },
        );
        if (tencentRes.ok) {
          const data = await tencentRes.json();
          const items = data.data.tabs[0].articleList.map(
            (item: any, index: number): HotlistItem => ({
              id: item.id || String(index + 1),
              title: item.title,
              url: item.link_info?.url || "",
              hot: "",
              desc: item.desc || "",
            }),
          );
          return res.json({ data: items });
        }
      } catch (e: any) {
        console.error(`[Hotlist] Tencent error:`, e.message);
      }
      return res.status(502).json({ error: "Tencent source failed" });
    }

    const mapping = HOTLIST_TYPE_MAP[type as string] || {
      vvhan: type,
      reall: type,
      title: type,
    };

    const urls = HOTLIST_SOURCES.map((tpl) =>
      tpl
        .replace("{title}", encodeURIComponent(mapping.title))
        .replace(/\{vvhan\}/g, mapping.vvhan)
        .replace(/\{reall\}/g, mapping.reall),
    );

    for (const url of urls) {
      try {
        console.log(`[Hotlist] Trying: ${url}`);
        const response = await fetch(url, {
          signal: AbortSignal.timeout(12000),
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            "Accept": "application/json",
          },
        });
        if (response.ok) {
          const data = await response.json();
          const items = data.data || data.list || data.items || data.results || [];
          if (Array.isArray(items) && items.length > 0) {
            console.log(`[Hotlist] Success: ${url} (${items.length} items)`);
            return res.json({ data: items });
          }
        }
      } catch (error: any) {
        console.error(`[Hotlist] Fetch error ${url}:`, error.message);
      }
    }

    res.status(502).json({ error: "All hotlist sources failed" });
  });

  // ── Finance Live ─────────────────────────────────────────────────────────
  app.get("/api/finance-live", async (_req, res) => {
    try {
      const response = await fetch(
        "https://api-prod.wallstreetcn.com/apiv1/content/lives?channel=global-live&cursor=&limit=20",
        {
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
            "Accept": "application/json",
          },
        },
      );
      if (!response.ok) throw new Error("WSCN API failed");
      const data = await response.json();
      const items = (data.data?.items || []).map((it: any) => ({
        title: (it.content_text?.substring(0, 100) || "") +
          (it.content_text?.length > 100 ? "..." : ""),
        fullContent: it.content_text,
        url: it.uri || "https://wallstreetcn.com/live/global",
        _sourceName: "华尔街见闻-快讯",
        createdAt: it.display_time * 1000,
      }));
      res.json({ data: items });
    } catch (error: any) {
      res.status(500).json({ error: error.message });
    }
  });

  // ── Topic Search (AnySearch / Sina / Jina) ───────────────────────────────
  app.post("/api/search-topic", async (req, res) => {
    const { topic, freshness = "month", engine = "anysearch" } = req.body;
    if (!topic || typeof topic !== "string" || topic.trim().length === 0) {
      return res.status(400).json({ error: "Topic is required" });
    }

    const ANYSEARCH_KEY = process.env.ANYSEARCH_API_KEY || "";
    const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";

    console.log(`[SearchTopic] Query: "${topic}" (freshness=${freshness}, engine=${engine})`);

    // ── Step 1: Search ────────────────────────────────────────────────────
    let rawResults: SearchResultRaw[] = [];
    let usedAnySearch = false;

    if (engine === "sina") {
      try {
        const sinaUrl = `https://interface.sina.cn/homepage/search.d.json?t=&q=${encodeURIComponent(topic)}&pf=0&ps=0&page=1&sort=time&num=12&ie=utf-8`;
        const sinaRes = await fetch(sinaUrl, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Referer": "https://search.sina.com.cn/",
          },
          signal: AbortSignal.timeout(12000),
        });
        if (sinaRes.ok) {
          const data = await sinaRes.json();
          rawResults = (data?.result?.list || []).map(
            (r: any): SearchResultRaw => ({
              title: (r.origin_title || r.title || "").replace(/<[^>]+>/g, ""),
              url: r.url || "",
              source: r.media || extractDomain(r.url || ""),
              snippet: stripHtml(r.intro || ""),
              date: r.datetime || "",
            }),
          );
          console.log(`[SearchTopic] Sina returned ${rawResults.length} results`);
        } else {
          const errText = await sinaRes.text().catch(() => "");
          console.warn(`[SearchTopic] Sina ${sinaRes.status}: ${errText.substring(0, 200)}`);
        }
      } catch (e: any) {
        console.warn("[SearchTopic] Sina search failed:", e.message);
      }
    } else if (ANYSEARCH_KEY) {
      try {
        const freshnessHints: Record<string, string> = {
          day: ' today OR "last 24 hours" OR 最新',
          week: " this week OR 本周 OR recent",
          month: ` ${new Date().getFullYear()} OR this month`,
        };
        const query = topic + (freshnessHints[freshness] || "");

        const searchRes = await fetch("https://api.anysearch.com/v1/search", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${ANYSEARCH_KEY}`,
          },
          body: JSON.stringify({ query, max_results: 12 }),
          signal: AbortSignal.timeout(15000),
        });

        if (searchRes.ok) {
          const data = await searchRes.json();
          rawResults = (data?.data?.results || data?.results || []).map(
            (r: any): SearchResultRaw => ({
              title: r.title || "",
              url: r.url || "",
              source: r.source || extractDomain(r.url || ""),
              snippet: r.snippet || r.content || r.description || "",
              date: r.date || r.published || r.metadata?.date || "",
            }),
          );
          usedAnySearch = true;
          console.log(`[SearchTopic] AnySearch returned ${rawResults.length} results`);
        }
      } catch (e: any) {
        console.warn("[SearchTopic] AnySearch failed:", e.message);
      }
    }

    // Jina fallback
    if (!usedAnySearch && engine !== "sina" && rawResults.length === 0) {
      try {
        const jinaRes = await fetch(`https://s.jina.ai/${encodeURIComponent(topic)}`, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
            "Accept": "text/plain",
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
              ? urlMatch
                  .map((u) => u.replace("URL:", "").trim())
                  .find((u) => u.startsWith("http")) || ""
              : "";
            if (titleMatch && url) {
              rawResults.push({
                title: titleMatch[1].trim(),
                url,
                source: extractDomain(url),
                snippet: block.substring(0, 300).replace(titleMatch[0], "").trim(),
                date: "",
              });
            }
          }
          console.log(`[SearchTopic] Jina fallback returned ${rawResults.length} results`);
        }
      } catch (e: any) {
        console.warn("[SearchTopic] Jina fallback failed:", e.message);
      }
    }

    if (rawResults.length === 0) {
      return res.json({
        results: [],
        warning: "当前选题暂无搜索结果。建议调整关键词或扩大搜索范围。",
        usedFallback: !usedAnySearch,
      });
    }

    // ── Step 2: DeepSeek scoring ──────────────────────────────────────────
    const enrichedResults: SearchResultEnriched[] = rawResults.map((r, i) => ({
      ...r,
      index: i + 1,
      authorityLevel: classifySource(r.url || r.source),
      authorityScore: 3,
      relevanceScore: 3,
      summary: r.snippet || "",
    }));

    if (DEEPSEEK_KEY) {
      try {
        const itemsForEval = rawResults
          .map(
            (r, i) =>
              `[${i + 1}] 标题: ${r.title}\n    来源: ${r.source}\n    URL: ${r.url}\n    片段: ${r.snippet?.substring(0, 200) || "无"}`,
          )
          .join("\n\n");

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

        const dsRes = await fetch("https://api.deepseek.com/v1/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${DEEPSEEK_KEY}`,
          },
          body: JSON.stringify({
            model: "deepseek-chat",
            messages: [{ role: "user", content: evalPrompt }],
            max_tokens: 4000,
            temperature: 0.1,
            response_format: { type: "json_object" },
          }),
          signal: AbortSignal.timeout(30000),
        });

        if (dsRes.ok) {
          const dsData = await dsRes.json();
          const content = dsData.choices?.[0]?.message?.content || "";
          const firstBrace = content.indexOf("{");
          const lastBrace = content.lastIndexOf("}");
          if (firstBrace !== -1 && lastBrace !== -1) {
            const parsed = JSON.parse(content.substring(firstBrace, lastBrace + 1));
            const scoreMap = new Map((parsed.items || []).map((s: any) => [s.index, s]));
            for (const r of enrichedResults) {
              const score = scoreMap.get(r.index);
              if (score) {
                r.authorityScore = score.authorityScore || r.authorityScore;
                r.relevanceScore = score.relevanceScore || r.relevanceScore;
                r.summary = score.summary || r.summary;
              }
            }
            console.log(`[SearchTopic] DeepSeek scored ${scoreMap.size} items`);
          }
        }
      } catch (e: any) {
        console.warn("[SearchTopic] DeepSeek scoring failed:", e.message);
      }
    }

    // ── Step 3: Sort + filter ─────────────────────────────────────────────
    enrichedResults.sort(
      (a, b) => b.authorityScore + b.relevanceScore - (a.authorityScore + a.relevanceScore),
    );
    const filtered = enrichedResults.filter((r) => r.authorityScore + r.relevanceScore >= 4);
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

  // ── Admin: Get logs ─────────────────────────────────────────────────────
  app.get("/api/admin/logs", async (_req, res) => {
    const firestoreDb = getDb();
    if (!firestoreDb) return res.json({ data: [] });
    try {
      const logsCol = collection(firestoreDb, "audit_logs");
      const q = query(logsCol, orderBy("epoch", "desc"), limit(200));
      const snapshot = await getDocs(q);
      const logs: any[] = [];
      snapshot.forEach((docSnap) => logs.push(docSnap.data()));
      res.json({ data: logs });
    } catch (error: any) {
      console.error("[Admin] Get audit logs failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });

  // ── Admin: Write audit log ──────────────────────────────────────────────
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
      operator: newLog.operator || "unknown",
      articleBody: newLog.articleBody || "",
    };

    const firestoreDb = getDb();
    if (firestoreDb) {
      try {
        await setDoc(doc(firestoreDb, "audit_logs", logEntry.id), logEntry);
      } catch (error: any) {
        console.error("[Admin] Save audit log failed:", error.message);
      }
    }

    res.json({ success: true, log: logEntry });
  });

  // ── Admin: Clear logs ───────────────────────────────────────────────────
  app.post("/api/admin/clear", async (_req, res) => {
    const firestoreDb = getDb();
    if (!firestoreDb) {
      return res.json({ success: true, warning: "Firestore not initialized" });
    }
    try {
      const logsCol = collection(firestoreDb, "audit_logs");
      const snapshot = await getDocs(query(logsCol, limit(500)));
      const batch = writeBatch(firestoreDb);
      snapshot.forEach((docSnap) => batch.delete(docSnap.ref));
      await batch.commit();
      res.json({ success: true });
    } catch (error: any) {
      console.error("[Admin] Clear logs failed:", error.message);
      res.status(500).json({ error: error.message });
    }
  });
}
