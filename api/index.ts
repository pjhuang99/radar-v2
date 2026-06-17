/**
 * Vercel serverless entry point.
 * Self-contained — no local-file imports, to avoid Vercel bundling quirks.
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

// ── Types ─────────────────────────────────────────────────────────────────

interface HotlistItem {
  id: string; title: string; url: string; hot: string; desc: string;
}
interface SearchResultRaw {
  title: string; url: string; source: string; snippet: string; date: string;
}
interface SearchResultEnriched extends SearchResultRaw {
  index: number;
  authorityLevel: "high" | "medium" | "unknown";
  authorityScore: number;
  relevanceScore: number;
  summary: string;
}

// ── Authority whitelist ───────────────────────────────────────────────────

const AUTHORITY_HIGH = [
  "caixin.com","yicai.com","eeo.com.cn","xinhuanet.com","people.com.cn",
  "cctv.com","chinanews.com","inewsweek.cn","caijing.com.cn",
  "nbd.com.cn","21jingji.com","jiemian.com",
  "reuters.com","bloomberg.com","ft.com","wsj.com","nytimes.com",
  "economist.com","washingtonpost.com","bbc.com","apnews.com","npr.org",
];
const AUTHORITY_MEDIUM = [
  "36kr.com","huxiu.com","tmtpost.com","latepost.com","geekpark.net",
  "cls.cn","stcn.com","guancha.cn","thepaper.cn",
  "techcrunch.com","wired.com","theverge.com","arstechnica.com",
  "fortune.com","cnbc.com","businessinsider.com","forbes.com",
  "fastcompany.com","axios.com","vox.com",
];

function classifySource(u: string) {
  const n = u.toLowerCase();
  if (AUTHORITY_HIGH.some(d => n.includes(d))) return "high";
  if (AUTHORITY_MEDIUM.some(d => n.includes(d))) return "medium";
  return "unknown";
}
function extractDomain(url: string) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return url; }
}
function stripHtml(s: string) {
  return s.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

// ── Hotlist config ────────────────────────────────────────────────────────

const HOTLIST_SOURCES = [
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

// ── Firebase helper ───────────────────────────────────────────────────────

let _db: ReturnType<typeof getFirestore> | null = null;
const _memoryLogs: any[] = [];
const MAX_MEMORY_LOGS = 500;

function getDb(): ReturnType<typeof getFirestore> | null {
  if (_db) return _db;
  try {
    const configPath = path.join(process.cwd(), "firebase-applet-config.json");
    if (fs.existsSync(configPath)) {
      const cfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      const dbId = cfg.firestoreDatabaseId || "(default)";
      delete cfg.firestoreDatabaseId;
      _db = getFirestore(initializeApp(cfg), dbId);
      console.log(`[Firebase] Init Firestore db=${dbId}`);
      return _db;
    }
  } catch (e) { console.error("[Firebase] Init failed:", e); }
  return null;
}

// ── Express app ───────────────────────────────────────────────────────────

const app = express();
app.use(express.json());

// Health
app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    env: {
      ANYSEARCH_API_KEY: process.env.ANYSEARCH_API_KEY ? `set (${process.env.ANYSEARCH_API_KEY.substring(0, 8)}...)` : "MISSING",
      DEEPSEEK_API_KEY: process.env.DEEPSEEK_API_KEY ? "set" : "MISSING",
      ADMIN_PIN: process.env.ADMIN_PIN ? "set" : "MISSING",
    },
    node: process.version,
    ts: new Date().toISOString(),
  });
});

// RSS
const rssParser = new Parser({ headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" } });
app.get("/api/rss", async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== "string") return res.status(400).json({ error: "URL is required" });
  try {
    const feed = await rssParser.parseURL(url);
    res.json({ data: feed });
  } catch (e: any) {
    res.status(500).json({ error: "Failed to fetch RSS: " + e.message });
  }
});

// Scrape
app.get("/api/scrape", async (req, res) => {
  let { url } = req.query;
  if (!url || typeof url !== "string") return res.status(400).json({ error: "URL is required" });
  try {
    if (url.includes("news.google.com/rss/articles/")) {
      try {
        const parts = url.split("/articles/");
        if (parts.length > 1) {
          const decoded = Buffer.from(parts[1].split("?")[0], "base64").toString("utf-8");
          const m = decoded.match(/https?:\/\/[^\s\0\x01-\x1F]+/);
          if (m) url = m[0];
        }
      } catch { /* best-effort */ }
    }
    if (url.includes("mp.weixin.qq.com")) {
      try {
        const wxRes = await fetch(url, {
          headers: { "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 MicroMessenger/8.0.42(0x18002a2a) NetType/WIFI Language/zh_CN", "Accept": "text/html,application/xhtml+xml", "Accept-Language": "zh-CN,zh;q=0.9" },
          signal: AbortSignal.timeout(15000),
        });
        if (wxRes.ok) {
          const html = await wxRes.text();
          if (html.includes("js_content") || html.includes("rich_media_content")) {
            return res.send(html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,"").replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi,"").replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim().substring(0,8000));
          }
        }
      } catch { /* fallthrough to Jina */ }
    }
    // Try Jina Reader first (reduced timeout)
    let jinaFailed = false;
    try {
      const resp = await fetch(`https://r.jina.ai/${encodeURIComponent(url)}`, {
        headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/plain", "X-With-Links-Summary": "true" },
        signal: AbortSignal.timeout(10000),
      });
      if (resp.ok) {
        const text = await resp.text();
        if (text.includes("环境异常") || text.includes("验证后继续访问")) return res.status(403).send("SCRAPE_BLOCKED_BY_WAF");
        return res.send(text);
      }
      console.warn(`[Scrape] Jina returned ${resp.status}, falling back to direct fetch`);
      jinaFailed = true;
    } catch (jinaErr: any) {
      console.warn(`[Scrape] Jina failed: ${jinaErr.message}, falling back to direct fetch`);
      jinaFailed = true;
    }
    // Fallback: direct fetch with browser UA + strip HTML
    if (jinaFailed) {
      try {
        const directRes = await fetch(url, {
          headers: {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
            "Accept-Language": "zh-CN,zh;q=0.9,en;q=0.8",
          },
          signal: AbortSignal.timeout(12000),
        });
        if (directRes.ok) {
          const html = await directRes.text();
          const plainText = html
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
            .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
            .replace(/<[^>]+>/g, "\n")
            .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
            .replace(/\n{3,}/g, "\n\n").replace(/[ \t]+/g, " ").trim();
          if (plainText.length > 100) {
            console.log(`[Scrape] Direct fallback success, ${plainText.length} chars`);
            return res.send(plainText.substring(0, 8000));
          }
        }
        console.warn(`[Scrape] Direct fallback returned ${directRes.status} or too-short content`);
      } catch (directErr: any) {
        console.warn(`[Scrape] Direct fallback also failed: ${directErr.message}`);
      }
      throw new Error("Both Jina and direct fetch failed for this URL");
    }
    throw new Error(`Scraper returned unexpected state`);
  } catch (e: any) {
    res.status(500).json({ error: "Failed to scrape: " + e.message });
  }
});

// AI Proxy
app.post("/api/proxy", async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  const { apiKey, payload, provider, baseUrl } = req.body;
  try {
    if (!apiKey) return res.status(400).json({ error: { message: "API Key missing" } });
    if (provider === "deepseek" || provider === "moonshot") {
      const defaultUrl = provider === "deepseek" ? "https://api.deepseek.com/v1/chat/completions" : "https://api.moonshot.cn/v1/chat/completions";
      let apiUrl = baseUrl ? (baseUrl.includes("chat/completions") ? baseUrl : baseUrl.replace(/\/$/, "") + "/chat/completions") : defaultUrl;
      const resp = await fetch(apiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: "Bearer " + apiKey },
        body: JSON.stringify({ ...payload, model: payload.model || (provider === "deepseek" ? "deepseek-chat" : "moonshot-v1-8k") }),
      });
      const data = await resp.json();
      return resp.ok ? res.json(data) : res.status(resp.status).json(data);
    }
    return res.status(400).json({ error: { message: `Unsupported provider: ${provider}` } });
  } catch (e: any) {
    res.status(500).json({ error: { message: e.message } });
  }
});

// Hotlist
app.get("/api/hotlist", async (req, res) => {
  const { type } = req.query;
  if (!type) return res.status(400).json({ error: "Type is required" });
  if (type === "tencent") {
    try {
      const r = await fetch("https://i.news.qq.com/web_backend/v2/getTagInfo?tagId=aEWqxLtdgmQ%3D", { headers: { Referer: "https://news.qq.com/" }, signal: AbortSignal.timeout(10000) });
      if (r.ok) {
        const d = await r.json();
        return res.json({ data: d.data.tabs[0].articleList.map((it: any, i: number): HotlistItem => ({ id: it.id || String(i+1), title: it.title, url: it.link_info?.url || "", hot: "", desc: it.desc || "" })) });
      }
    } catch (e: any) { console.error("[Hotlist] Tencent:", e.message); }
    return res.status(502).json({ error: "Tencent source failed" });
  }
  const m = HOTLIST_TYPE_MAP[type as string] || { vvhan: type as string, reall: type as string, title: type as string };
  for (const tpl of HOTLIST_SOURCES) {
    const url = tpl.replace("{title}", encodeURIComponent(m.title)).replace(/\{vvhan\}/g, m.vvhan).replace(/\{reall\}/g, m.reall);
    try {
      const r = await fetch(url, { signal: AbortSignal.timeout(12000), headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
      if (r.ok) {
        const d = await r.json();
        const items = d.data || d.list || d.items || d.results || [];
        if (Array.isArray(items) && items.length > 0) return res.json({ data: items });
      }
    } catch { /* try next */ }
  }
  res.status(502).json({ error: "All hotlist sources failed" });
});

// Finance Live
app.get("/api/finance-live", async (_req, res) => {
  try {
    const r = await fetch("https://api-prod.wallstreetcn.com/apiv1/content/lives?channel=global-live&cursor=&limit=20", { headers: { "User-Agent": "Mozilla/5.0", "Accept": "application/json" } });
    if (!r.ok) throw new Error("WSCN failed");
    const d = await r.json();
    res.json({ data: (d.data?.items || []).map((it: any) => ({ title: (it.content_text?.substring(0, 100) || "") + (it.content_text?.length > 100 ? "..." : ""), fullContent: it.content_text, url: it.uri || "https://wallstreetcn.com/live/global", _sourceName: "华尔街见闻-快讯", createdAt: it.display_time * 1000 })) });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

// Topic Search
const SEARCH_TIMEOUT = 7000;
app.post("/api/search-topic", async (req, res) => {
  try {
    const { topic, freshness = "month", engine = "anysearch" } = req.body;
    if (!topic || typeof topic !== "string" || !topic.trim()) return res.status(400).json({ error: "Topic is required" });
    const ANYSEARCH_KEY = process.env.ANYSEARCH_API_KEY || "";
    const DEEPSEEK_KEY = process.env.DEEPSEEK_API_KEY || "";
    console.log(`[SearchTopic] "${topic}" engine=${engine} anysearchKey=${ANYSEARCH_KEY ? "set" : "missing"}`);

    let rawResults: SearchResultRaw[] = [];
    let usedAnySearch = false;

    if (engine === "sina") {
      try {
        const r = await fetch(`https://interface.sina.cn/homepage/search.d.json?t=&q=${encodeURIComponent(topic)}&pf=0&ps=0&page=1&sort=time&num=12&ie=utf-8`, { headers: { "User-Agent": "Mozilla/5.0", "Referer": "https://search.sina.com.cn/" }, signal: AbortSignal.timeout(SEARCH_TIMEOUT) });
        if (r.ok) {
          const d = await r.json();
          rawResults = (d?.result?.list || []).map((r: any): SearchResultRaw => ({ title: (r.origin_title || r.title || "").replace(/<[^>]+>/g, ""), url: r.url || "", source: r.media || extractDomain(r.url || ""), snippet: stripHtml(r.intro || ""), date: r.datetime || "" }));
        }
      } catch (e: any) { console.warn("[SearchTopic] Sina:", e.message); }
    } else if (ANYSEARCH_KEY) {
      try {
        const hints: Record<string, string> = { day: ' today OR "last 24 hours"', week: " this week OR 本周", month: ` ${new Date().getFullYear()} OR this month` };
        const r = await fetch("https://api.anysearch.com/v1/search", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${ANYSEARCH_KEY}` }, body: JSON.stringify({ query: topic + (hints[freshness] || ""), max_results: 12 }), signal: AbortSignal.timeout(SEARCH_TIMEOUT) });
        if (r.ok) {
          const d = await r.json();
          rawResults = (d?.data?.results || d?.results || []).map((r: any): SearchResultRaw => ({ title: r.title || "", url: r.url || "", source: r.source || extractDomain(r.url || ""), snippet: r.snippet || r.content || "", date: r.date || r.published || "" }));
          usedAnySearch = true;
        }
      } catch (e: any) { console.warn("[SearchTopic] AnySearch:", e.message); }
    }

    if (!usedAnySearch && engine !== "sina" && rawResults.length === 0) {
      try {
        const r = await fetch(`https://s.jina.ai/${encodeURIComponent(topic)}`, { headers: { "User-Agent": "Mozilla/5.0", "Accept": "text/plain" }, signal: AbortSignal.timeout(SEARCH_TIMEOUT) });
        if (r.ok) {
          const md = await r.text();
          const blocks = md.split(/\n\n(?=Title:|\d+\.\s+|###\s)/);
          for (const b of blocks) {
            const tm = b.match(/(?:Title:|^#+\s*|^\d+\.\s*)\s*(.+?)(?:\n|$)/m);
            const um = b.match(/(?:URL:|https?:\/\/\S+)/g);
            const u = um ? um.map(x => x.replace("URL:", "").trim()).find(x => x.startsWith("http")) || "" : "";
            if (tm && u) rawResults.push({ title: tm[1].trim(), url: u, source: extractDomain(u), snippet: b.substring(0, 300).replace(tm[0], "").trim(), date: "" });
          }
        }
      } catch (e: any) { console.warn("[SearchTopic] Jina:", e.message); }
    }

    if (rawResults.length === 0) return res.json({ results: [], warning: "当前选题暂无搜索结果。建议调整关键词或扩大搜索范围。" });

    const enriched: SearchResultEnriched[] = rawResults.map((r, i) => ({ ...r, index: i + 1, authorityLevel: classifySource(r.url || r.source), authorityScore: 3, relevanceScore: 3, summary: r.snippet || "" }));

    if (DEEPSEEK_KEY) {
      try {
        const itemsForEval = rawResults.map((r, i) => `[${i + 1}] 标题: ${r.title}\n    来源: ${r.source}\n    URL: ${r.url}\n    片段: ${r.snippet?.substring(0, 200) || "无"}`).join("\n\n");
        const r = await fetch("https://api.deepseek.com/v1/chat/completions", { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${DEEPSEEK_KEY}` }, body: JSON.stringify({ model: "deepseek-chat", messages: [{ role: "user", content: `你是资深新闻编辑。评估以下${rawResults.length}篇搜索结果。\n\n${itemsForEval}\n\n对每篇输出 authorityScore(1-5), relevanceScore(1-5), summary(150-200字中文)。严格JSON: {"items":[{"index":1,"authorityScore":5,"relevanceScore":4,"summary":"..."}]}` }], max_tokens: 4000, temperature: 0.1, response_format: { type: "json_object" } }), signal: AbortSignal.timeout(SEARCH_TIMEOUT) });
        if (r.ok) {
          const d = await r.json();
          const c = d.choices?.[0]?.message?.content || "";
          const f = c.indexOf("{"), l = c.lastIndexOf("}");
          if (f !== -1 && l !== -1) {
            const p = JSON.parse(c.substring(f, l + 1));
            const m = new Map((p.items || []).map((s: any) => [s.index, s]));
            for (const e of enriched) { const s = m.get(e.index); if (s) { e.authorityScore = s.authorityScore || e.authorityScore; e.relevanceScore = s.relevanceScore || e.relevanceScore; e.summary = s.summary || e.summary; } }
          }
        }
      } catch (e: any) { console.warn("[SearchTopic] DeepSeek scoring:", e.message); }
    }

    enriched.sort((a, b) => b.authorityScore + b.relevanceScore - (a.authorityScore + a.relevanceScore));
    const final = enriched.filter(r => r.authorityScore + r.relevanceScore >= 4).slice(0, 10);
    res.json({ results: final, query: topic, engine, totalFound: rawResults.length, returned: final.length, usedAnySearch });
  } catch (err: any) {
    console.error("[SearchTopic] Crash:", err.message);
    res.status(500).json({ error: err.message || "Search failed" });
  }
});

// Admin: Get logs
app.get("/api/admin/logs", async (_req, res) => {
  const logs: any[] = []; const seen = new Set<string>();
  for (const e of _memoryLogs) { if (!seen.has(e.id)) { logs.push(e); seen.add(e.id); } }
  const db = getDb();
  if (db) {
    try {
      const snap = await getDocs(query(collection(db, "audit_logs"), orderBy("epoch", "desc"), limit(200)));
      snap.forEach(d => { const data = d.data(); if (!seen.has(data.id)) { logs.push(data); seen.add(data.id); } });
    } catch (e: any) { console.error("[Admin] Firestore read failed:", e.message); }
  }
  logs.sort((a, b) => (b.epoch || 0) - (a.epoch || 0));
  res.json({ data: logs.slice(0, MAX_MEMORY_LOGS) });
});

// Admin: Write log
app.post("/api/admin/audit", async (req, res) => {
  const nl = req.body;
  if (!nl?.action) return res.status(400).json({ error: "Invalid log entry" });
  const entry = {
    id: nl.id || Math.random().toString(36).substring(2, 11),
    timestamp: nl.timestamp || new Date().toISOString(), epoch: nl.epoch || Date.now(),
    action: nl.action, title: nl.title || "", draftMeta: nl.draftMeta || "",
    referencesCount: typeof nl.referencesCount === "number" ? nl.referencesCount : 0,
    wordCount: typeof nl.wordCount === "number" ? nl.wordCount : 0,
    operator: nl.operator || "unknown", articleBody: nl.articleBody || "",
  };
  _memoryLogs.unshift(entry); if (_memoryLogs.length > MAX_MEMORY_LOGS) _memoryLogs.length = MAX_MEMORY_LOGS;
  const db = getDb();
  if (db) { try { await setDoc(doc(db, "audit_logs", entry.id), entry); } catch (e: any) { console.error("[Admin] Write failed:", e.message); } }
  res.json({ success: true, log: entry });
});

// Admin: Clear
app.post("/api/admin/clear", async (_req, res) => {
  _memoryLogs.length = 0;
  const db = getDb();
  if (!db) return res.json({ success: true, warning: "Firestore not initialized (memory cleared)" });
  try {
    const snap = await getDocs(query(collection(db, "audit_logs"), limit(500)));
    const batch = writeBatch(db); snap.forEach(d => batch.delete(d.ref)); await batch.commit();
    res.json({ success: true });
  } catch (e: any) { res.status(500).json({ error: e.message }); }
});

export default app;
