import React, { useEffect, useRef, useState } from 'react';
import { RefreshCw, X, Link2, FileText, ShieldCheck, History, ChevronDown } from 'lucide-react';
import {
  buildFactCheckQueries,
  performAutoRetrieval,
  fetchUserSourceContents,
  buildFactCheckPrompt,
  parseFactCheckReport,
  type AutoSource,
  type FactCheckCounts,
  type FactFinding,
} from '../lib/factcheck';
import { AUTHORITY_LABELS } from '../config/sources';

export interface FactCheckAuditEntry {
  title: string;
  draftMeta: string;
  refCount: number;
  wordCount: number;
  digest: string;
}

interface FactCheckPanelProps {
  onClose: () => void;
  callAI: (prompt: string, options?: { maxTokens?: number; temperature?: number }) => Promise<string>;
  onAuditLog?: (entry: FactCheckAuditEntry) => void;
}

interface SourceMeta {
  title: string;
  url: string;
  source: string;
  authorityLevel: string;
  publishDate?: string;
  clusterSize?: number;
  clusterPeers?: string[];
  independentTotal?: number;
}

// ── 核查记录（本机浏览器缓存，最多 10 条） ────────────────────────────────
const HISTORY_KEY = 'factcheck.history.v1';
const HISTORY_LIMIT = 10;
const HISTORY_TEXT_CAP = 30000;

interface HistoryEntry {
  id: string;
  title: string;
  excerpt: string;
  text: string;
  ts: number;
  counts: FactCheckCounts | null;
}

function readHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((e: any) => e && typeof e.text === 'string' && typeof e.ts === 'number')
      .slice(0, HISTORY_LIMIT) as HistoryEntry[];
  } catch {
    return [];
  }
}

function writeHistory(entries: HistoryEntry[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_LIMIT)));
  } catch {
    // 隐私模式 / 配额满时静默失败，不影响核查
  }
}

function formatTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getMonth() + 1}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// ── 审计日志：事实核查摘要（写入审计后台存档正文） ──────────────────────
const AUDIT_DIGEST_CAP = 6000;
const AUDIT_STATUS_LABELS: Record<string, string> = {
  VERIFIED: '相符',
  DISPUTED: '存在争议',
  CONTRADICTED: '不符',
  UNVERIFIED: '未能核实',
};

function buildAuditDigest(params: {
  title: string;
  articleText: string;
  queries: string[];
  autoSources: AutoSource[];
  manualLinks: number;
  scrapedCount: number;
  findings: FactFinding[];
  counts: FactCheckCounts;
}): string {
  const { title, articleText, queries, autoSources, manualLinks, scrapedCount, findings, counts } = params;
  const groups = new Set(autoSources.map((s) => s.clusterGroup ?? s.url)).size;
  const now = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())} ${p(now.getHours())}:${p(now.getMinutes())}`;

  const head = [
    '【事实核查记录】',
    `时间：${stamp}`,
    `标题：${title.trim() || '（未填标题）'}`,
    `正文：${articleText.replace(/\s+/g, '').length} 字`,
    `检索词：${queries.length ? queries.join(' / ') : '（未生成）'}`,
    `自动信源：${autoSources.length} 个${groups ? `（${groups} 组独立信源）` : ''}`,
    `手动链接：${manualLinks} 个（成功读取 ${scrapedCount} 个）`,
    '',
    `结论：共 ${findings.length} 条 —— 相符 ${counts.verified} / 争议 ${counts.disputed} / 不符 ${counts.contradicted} / 未核实 ${counts.unverified}`,
    '──────────',
  ].join('\n');

  const body = findings
    .map((f, i) =>
      [
        `${i + 1}. [${AUDIT_STATUS_LABELS[f.status] || f.status}${f.risk ? `·风险${f.risk}` : ''}] ${f.original}`,
        `   结论：${f.conclusion || '—'}`,
        f.evidence ? `   依据：${f.evidence}` : '',
        f.sourcesRaw ? `   来源：${f.sourcesRaw}` : '',
      ]
        .filter(Boolean)
        .join('\n')
    )
    .join('\n');

  const full = `${head}\n${body}`;
  return full.length > AUDIT_DIGEST_CAP ? `${full.slice(0, AUDIT_DIGEST_CAP)}\n…（摘要已截断）` : full;
}

// ── 原句定位 ────────────────────────────────────────────────────────────
/** 把「去掉空白后的下标」映射回原文范围 */
function mapCollapsedRange(
  text: string,
  start: number,
  length: number
): { start: number; end: number } | null {
  let seen = 0;
  let s = -1;
  let e = -1;
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    if (s < 0 && seen === start) s = i;
    if (seen === start + length - 1) {
      e = i + 1;
      break;
    }
    seen++;
  }
  return s >= 0 && e > s ? { start: s, end: e } : null;
}

/** 在正文中找 LLM 引用的原句：先精确匹配，再忽略空白匹配，最后用前 24 字兜底 */
export function findQuoteInText(
  text: string,
  quote: string
): { start: number; end: number } | null {
  const q = (quote || '').trim();
  if (!q || !text) return null;

  const direct = text.indexOf(q);
  if (direct >= 0) return { start: direct, end: direct + q.length };

  const collapse = (s: string) => s.replace(/\s+/g, '');
  const tc = collapse(text);
  const qc = collapse(q);
  const ci = qc ? tc.indexOf(qc) : -1;
  if (ci >= 0) return mapCollapsedRange(text, ci, qc.length);

  const head = qc.slice(0, 24);
  if (head.length >= 8) {
    const hi = tc.indexOf(head);
    if (hi >= 0) return mapCollapsedRange(text, hi, head.length);
  }
  return null;
}

/**
 * 独立事实核查入口：左栏粘贴待核查文章（必填）+ 可选标题/补充链接，
 * 右栏「事实核查」→ 自动检索独立信源 + LLM 交叉核查 → 四态卡片。
 * 引擎全部来自 src/lib/factcheck.tsx，与草稿内溯源核查共用同一份实现。
 */
export default function FactCheckPanel({ onClose, callAI, onAuditLog }: FactCheckPanelProps) {
  const [articleText, setArticleText] = useState('');
  const [title, setTitle] = useState('');
  const [linkText, setLinkText] = useState('');

  const [items, setItems] = useState<React.ReactNode[]>([]);
  const [sources, setSources] = useState<SourceMeta[]>([]);
  const [counts, setCounts] = useState<FactCheckCounts | null>(null);
  const [running, setRunning] = useState(false);
  const [phase, setPhase] = useState('');
  const [error, setError] = useState('');
  const [ranOnce, setRanOnce] = useState(false);

  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyReady, setHistoryReady] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  // 补充核查链接默认收起，点箭头才展开输入框
  const [linksOpen, setLinksOpen] = useState(false);

  // 原句高亮：镜像层 + 透明 textarea
  const [highlight, setHighlight] = useState<{ start: number; end: number } | null>(null);
  const [locateMsg, setLocateMsg] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const mirrorRef = useRef<HTMLDivElement>(null);
  const markRef = useRef<HTMLElement>(null);
  const locateTimer = useRef<number | null>(null);

  useEffect(() => {
    setHistory(readHistory());
    setHistoryReady(true);
  }, []);

  useEffect(() => {
    if (historyReady) writeHistory(history);
  }, [history, historyReady]);

  useEffect(() => {
    return () => {
      if (locateTimer.current) window.clearTimeout(locateTimer.current);
    };
  }, []);

  // 高亮渲染后把 textarea 滚到这句原话的位置
  useEffect(() => {
    if (!highlight) return;
    const ta = taRef.current;
    const mirror = mirrorRef.current;
    if (!ta) return;
    const top = markRef.current?.offsetTop || 0;
    ta.scrollTop = Math.max(0, top - ta.clientHeight / 2 + 20);
    if (mirror) mirror.scrollTop = ta.scrollTop;
  }, [highlight]);

  const locateOriginal = (original: string) => {
    const range = findQuoteInText(articleText, original);
    if (!range) {
      setLocateMsg('未在当前正文中找到这句原话（可能已改动正文）');
      if (locateTimer.current) window.clearTimeout(locateTimer.current);
      locateTimer.current = window.setTimeout(() => setLocateMsg(''), 3000);
      return;
    }
    setLocateMsg('');
    setHighlight(range);
    taRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  };

  const links = linkText
    .split(/[\s,，、]+/)
    .map((s) => s.trim())
    .filter((u) => /^https?:\/\//i.test(u));

  const addHistory = (parsedCounts: FactCheckCounts) => {
    const body = articleText.trim().replace(/\s+/g, ' ');
    const excerpt = body.length > 60 ? `${body.slice(0, 60)}…` : body;
    const entry: HistoryEntry = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      title: title.trim(),
      excerpt,
      text: articleText.slice(0, HISTORY_TEXT_CAP),
      ts: Date.now(),
      counts: parsedCounts,
    };
    setHistory((prev) =>
      [entry, ...prev.filter((e) => !(e.text === entry.text && e.title === entry.title))].slice(
        0,
        HISTORY_LIMIT
      )
    );
  };

  const restoreHistory = (h: HistoryEntry) => {
    setArticleText(h.text || '');
    setTitle(h.title || '');
    setItems([]);
    setSources([]);
    setCounts(null);
    setRanOnce(false);
    setError('');
    setHighlight(null);
    setLocateMsg('');
    setHistoryOpen(false);
  };

  const run = async () => {
    if (!articleText.trim()) {
      setError('请先粘贴需要核查的文章正文');
      return;
    }
    if (running) return;

    setError('');
    setRunning(true);
    setRanOnce(true);
    setItems([]);
    setSources([]);
    setCounts(null);
    setHighlight(null);
    setLocateMsg('');

    try {
      // ── Phase A: 自动检索独立信源 ──────────────────────────────
      setPhase('提取核查关键词并检索独立信源…');
      let autoSources: AutoSource[] = [];
      const queries = await buildFactCheckQueries(callAI, title, articleText);
      if (queries.length) {
        setPhase(`自动检索关键词：${queries.join(' / ')}`);
        try {
          autoSources = await performAutoRetrieval(queries);
        } catch (e) {
          console.warn('Auto-retrieval failed, continuing with manual sources only', e);
          autoSources = [];
        }
      }
      setSources(
        autoSources.map((s) => ({
          title: s.title,
          url: s.url,
          source: s.source,
          authorityLevel: s.authorityLevel,
          publishDate: s.publishDate,
          clusterSize: s.clusterSize,
          clusterPeers: s.clusterPeers,
          independentTotal: s.independentTotal,
        }))
      );

      // ── Phase B: 读取补充核查信源 ──────────────────────────────
      setPhase('读取补充核查信源…');
      const fetched = links.length
        ? await fetchUserSourceContents(links)
        : { extraSourceContent: '', scrapeCount: 0, validCount: 0 };
      if (fetched.validCount > 0 && fetched.scrapeCount === 0) {
        setError('补充核查链接抓取失败（超时或被拦截），本次仅使用自动检索信源与正文本身。');
      }

      // ── Phase C: LLM 交叉核查 ─────────────────────────────────
      setPhase('AI 交叉核查中（约 10–20 秒）…');
      const prompt = buildFactCheckPrompt({
        draftBody: articleText,
        draftReferences: [],
        currentSourceContent: '',
        extraSourceContent: fetched.extraSourceContent,
        autoSources,
      });
      const report = await callAI(prompt, { maxTokens: 3600, temperature: 0.1 });

      const parsed = parseFactCheckReport(
        report,
        [],
        '',
        title || articleText.slice(0, 40),
        links,
        autoSources.map((s) => s.url),
        locateOriginal
      );
      setItems(parsed.items);
      setCounts(parsed.counts);
      addHistory(parsed.counts);

      // ── 审计后台：事实核查日志 ──────────────────────────────
      try {
        const groups = new Set(autoSources.map((s) => s.clusterGroup ?? s.url)).size;
        onAuditLog?.({
          title: title.trim() || articleText.slice(0, 40),
          draftMeta: `[ 模型: DeepSeek | 自动检索 ${autoSources.length} 源/${groups} 组 | 手动链接 ${links.length} 个 | 结论 ${parsed.findings.length} 条 ]`,
          refCount: autoSources.length + (fetched.validCount || 0),
          wordCount: articleText.replace(/\s+/g, '').length,
          digest: buildAuditDigest({
            title,
            articleText,
            queries,
            autoSources,
            manualLinks: links.length,
            scrapedCount: fetched.scrapeCount || 0,
            findings: parsed.findings,
            counts: parsed.counts,
          }),
        });
      } catch (e) {
        console.warn('事实核查审计日志写入失败（不影响核查结果）', e);
      }
    } catch (e: any) {
      setError(`核查中断：${e.message || String(e)}`);
    } finally {
      setRunning(false);
      setPhase('');
    }
  };

  return (
    <div className="fixed inset-0 z-[400] bg-paper flex flex-col overflow-y-auto lg:overflow-hidden">
      <div className="max-w-6xl w-full mx-auto px-4 py-4 md:px-8 md:py-5 flex flex-col flex-1 min-h-0">
        {/* Header */}
        <div className="relative flex-shrink-0 flex items-center justify-between gap-3 mb-3 pb-2.5 border-b border-border flex-wrap">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <ShieldCheck size={18} className="text-accent" />
              <h2 className="font-serif text-[1.15rem] font-bold text-ink">事实核查</h2>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={() => setHistoryOpen((v) => !v)}
              className="cat-btn relative z-30 flex items-center gap-1.5"
              style={{ fontSize: '0.7rem', padding: '6px 12px' }}
              aria-expanded={historyOpen}
            >
              <History size={14} /> 核查记录{history.length > 0 ? ` (${history.length})` : ''}
            </button>
            {historyOpen && <div className="fixed inset-0 z-10" onClick={() => setHistoryOpen(false)} />}
            {historyOpen && (
              <div className="absolute right-0 top-full mt-3 z-20 w-[min(24rem,calc(100vw-2rem))] bg-paper border border-border shadow-lg">
                <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-border">
                  <span className="text-[0.58rem] font-bold uppercase tracking-wider text-muted">
                    最近核查 · 最多 {HISTORY_LIMIT} 条 · 仅存本机
                  </span>
                  {history.length > 0 && (
                    <button
                      className="text-[0.6rem] text-accent hover:underline flex-shrink-0"
                      onClick={() => setHistory([])}
                    >
                      清空
                    </button>
                  )}
                </div>
                {history.length === 0 ? (
                  <div className="px-3 py-5 text-[0.7rem] text-muted italic">
                    还没有核查记录，完成一次核查后会自动保存在这里。
                  </div>
                ) : (
                  <div className="max-h-[22rem] overflow-y-auto">
                    {history.map((h) => (
                      <button
                        key={h.id}
                        onClick={() => restoreHistory(h)}
                        className="block w-full text-left px-3 py-2 border-b border-border/60 last:border-b-0 hover:bg-ink/5 transition-colors"
                      >
                        <div className="flex items-center gap-2 flex-wrap text-[0.55rem] font-mono text-muted mb-0.5">
                          <span>{formatTs(h.ts)}</span>
                          {h.counts &&
                            h.counts.contradicted +
                              h.counts.disputed +
                              h.counts.unverified +
                              h.counts.verified >
                              0 && (
                              <span className="flex items-center gap-1.5">
                                {h.counts.contradicted > 0 && (
                                  <span className="text-accent">不符{h.counts.contradicted}</span>
                                )}
                                {h.counts.disputed > 0 && (
                                  <span className="text-gold">争议{h.counts.disputed}</span>
                                )}
                                {h.counts.unverified > 0 && (
                                  <span className="text-blue">存疑{h.counts.unverified}</span>
                                )}
                                {h.counts.verified > 0 && (
                                  <span className="text-green">核实{h.counts.verified}</span>
                                )}
                              </span>
                            )}
                        </div>
                        <div className="text-[0.72rem] font-serif text-ink leading-snug">
                          {h.title ? <span className="font-bold">{h.title} · </span> : null}
                          {h.excerpt || '（空正文）'}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            <button
              onClick={onClose}
              className="cat-btn flex items-center gap-1.5 flex-shrink-0"
              style={{ fontSize: '0.7rem', padding: '6px 12px' }}
            >
              <X size={14} /> 返回
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 lg:flex-1 lg:min-h-0">
          {/* ── 左栏：输入 ─────────────────────────────────────── */}
          <div className="flex flex-col gap-4 lg:overflow-y-auto lg:min-h-0 lg:pr-3 lg:pb-6">
            <div className="flex-shrink-0">
              <label className="text-[0.65rem] font-bold uppercase tracking-wider text-muted mb-1.5 block">
                文章标题（可选，有助于抽取检索关键词）
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                disabled={running}
                placeholder="例如：某地出台新规引发争议"
                className="w-full border border-ink/30 bg-paper px-3 py-2 text-[0.85rem] font-serif placeholder:text-muted/50 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink/10 transition-all"
              />
            </div>

            <div className="flex-shrink-0">
              <button
                type="button"
                onClick={() => setLinksOpen((v) => !v)}
                aria-expanded={linksOpen}
                className="w-full flex items-center justify-between gap-2 text-left text-[0.65rem] font-bold uppercase tracking-wider text-muted hover:text-ink transition-colors"
              >
                <span className="flex items-center gap-1.5 min-w-0">
                  <Link2 size={12} /> 补充核查链接（可选，每行一个）
                  {links.length > 0 && (
                    <span className="normal-case font-normal tracking-normal text-[0.6rem] text-gold">
                      已识别 {links.length} 个
                    </span>
                  )}
                </span>
                <ChevronDown
                  size={13}
                  className={`flex-shrink-0 transition-transform ${linksOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {linksOpen && (
                <textarea
                  value={linkText}
                  onChange={(e) => setLinkText(e.target.value)}
                  disabled={running}
                  rows={2}
                  placeholder="https://… （你手头掌握的权威来源，会设为最高优先级）"
                  className="mt-1.5 w-full border border-ink/30 bg-paper px-3 py-2 text-[0.75rem] font-mono placeholder:text-muted/50 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink/10 transition-all resize-y"
                />
              )}
            </div>

            <div className="flex flex-col lg:flex-1 lg:min-h-0">
              <label className="flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-muted mb-1.5 flex-shrink-0">
                <FileText size={12} /> 待核查文章正文 <span className="text-accent">*</span>
              </label>
              <div className="relative lg:flex-1 lg:min-h-0">
                {/* 镜像层：只负责画浅黄色高亮，文字透明，层级在 textarea 之下 */}
                <div
                  ref={mirrorRef}
                  aria-hidden="true"
                  className="absolute inset-0 overflow-y-auto [scrollbar-gutter:stable] border border-transparent px-3 py-2.5 text-[0.85rem] font-serif leading-relaxed whitespace-pre-wrap break-words text-transparent pointer-events-none select-none"
                >
                  {highlight ? (
                    <>
                      {articleText.slice(0, highlight.start)}
                      <mark ref={markRef} className="bg-yellow-200/80 text-transparent">
                        {articleText.slice(highlight.start, highlight.end)}
                      </mark>
                      {articleText.slice(highlight.end) + '\n'}
                    </>
                  ) : (
                    <>{articleText + '\n'}</>
                  )}
                </div>
                <textarea
                  ref={taRef}
                  value={articleText}
                  onChange={(e) => {
                    setArticleText(e.target.value);
                    setHighlight(null);
                    setLocateMsg('');
                  }}
                  onScroll={(e) => {
                    if (mirrorRef.current) mirrorRef.current.scrollTop = e.currentTarget.scrollTop;
                  }}
                  disabled={running}
                  rows={16}
                  placeholder="粘贴需要核查的文章正文（纯文本或带简单格式均可）"
                  className="relative w-full overflow-y-auto [scrollbar-gutter:stable] border border-ink/30 bg-transparent px-3 py-2.5 text-[0.85rem] text-ink font-serif leading-relaxed placeholder:text-muted/50 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink/10 transition-all resize-y lg:h-full lg:resize-none"
                />
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <span className="text-[0.6rem] text-gold font-mono">{locateMsg}</span>
                <span className="text-[0.6rem] text-muted font-mono text-right">{articleText.length} 字</span>
              </div>
            </div>

            <button
              onClick={run}
              disabled={running || !articleText.trim()}
              className="flex-shrink-0 bg-ink text-paper px-4 py-1.5 font-bold text-[0.72rem] uppercase tracking-wider hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center justify-center gap-1.5"
            >
              {running ? (
                <>
                  <RefreshCw size={13} className="animate-spin" /> 核查中
                </>
              ) : (
                <>
                  <ShieldCheck size={14} /> 事实核查
                </>
              )}
            </button>

            {running && phase && (
              <div className="flex items-center gap-2 text-[0.7rem] text-gold font-mono animate-pulse">
                <span className="w-2 h-2 bg-gold rounded-full" /> {phase}
              </div>
            )}
            {error && (
              <div className="text-[0.7rem] text-accent bg-accent/5 border border-accent/30 px-3 py-2">
                {error}
              </div>
            )}
          </div>

          {/* ── 右栏：结果 ─────────────────────────────────────── */}
          <div className="flex flex-col gap-4 lg:overflow-y-auto lg:min-h-0 lg:pr-3 lg:pb-6">
            {/* 自动检索信源列表（置顶，先看信源再看结论） */}
            {sources.length > 0 && (
              <div className="border border-border bg-ink/5 p-3">
                <div className="flex items-center gap-1.5 text-[0.65rem] font-bold uppercase tracking-wider text-muted mb-2 flex-wrap">
                  <span>🤖</span> 自动检索信源（{sources.length} 篇
                  {(() => {
                    const indep = sources.find((s) => s.independentTotal)?.independentTotal || 0;
                    return indep > 0 && indep < sources.length ? ` / 独立 ${indep} 组` : '';
                  })()}
                  ）
                </div>
                <div className="flex flex-col gap-1.5">
                  {sources.map((s, i) => {
                    const label = AUTHORITY_LABELS[s.authorityLevel] || AUTHORITY_LABELS.unknown;
                    return (
                      <div key={i} className="flex items-start gap-2 text-[0.7rem]">
                        <span className={`${label.bgClass} ${label.textClass} px-1.5 py-0.5 text-[0.55rem] font-bold flex-shrink-0 mt-0.5`}>
                          {label.label}
                        </span>
                        <div className="min-w-0">
                          <a
                            href={s.url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-blue hover:underline leading-snug"
                          >
                            {s.title || s.url}
                            {s.source ? <span className="text-muted"> · {s.source}</span> : null}
                          </a>
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5 text-[0.55rem] text-muted">
                            {s.publishDate ? (
                              <span>🗓 {s.publishDate.replace(/^(\d{4}[-/]\d{1,2}[-/]\d{1,2}).*$/, '$1')}</span>
                            ) : null}
                            {s.clusterSize && s.clusterSize > 1 ? (
                              <span
                                className="border border-gold/40 text-gold px-1 py-0.5"
                                title={s.clusterPeers?.length ? `同稿转载：${s.clusterPeers.join('、')}` : undefined}
                              >
                                {s.clusterSize} 篇同稿转载，只算 1 个独立信源
                              </span>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {ranOnce && !running && sources.length === 0 && !error && (
              <div className="text-[0.65rem] text-amber-600 bg-amber-50 border border-amber-200 px-3 py-2">
                ⚠️ 未检索到独立信源，本次结论主要依赖正文与模型知识库，请谨慎采信。
              </div>
            )}

            <div className="text-[0.65rem] font-bold uppercase tracking-wider text-muted">
              核查结果
            </div>

            {!ranOnce && (
              <div className="text-[0.75rem] text-muted italic border border-dashed border-border px-4 py-8 text-center">
                左侧粘贴文章后点「事实核查」，结果会显示在这里。点卡片里的原文可定位到左侧对应位置。
              </div>
            )}

            {ranOnce && !running && items.length === 0 && !error && (
              <div className="text-[0.75rem] text-muted italic border border-dashed border-border px-4 py-8 text-center">
                AI 未返回可解析的核查结论。建议补充核查链接后重试，或手动核对关键数据。
              </div>
            )}

            {counts && (counts.contradicted + counts.disputed + counts.unverified + counts.verified > 0) && (
              <div className="space-y-1.5">
                <div className="flex items-center gap-2 flex-wrap text-[0.65rem] font-mono">
                  {counts.contradicted > 0 && (
                    <span className="bg-accent text-white px-2 py-0.5 font-bold">不符 {counts.contradicted}</span>
                  )}
                  {counts.disputed > 0 && (
                    <span className="bg-gold text-white px-2 py-0.5 font-bold">争议 {counts.disputed}</span>
                  )}
                  {counts.unverified > 0 && (
                    <span className="bg-blue text-white px-2 py-0.5 font-bold">存疑 {counts.unverified}</span>
                  )}
                  {counts.verified > 0 && (
                    <span className="bg-green text-white px-2 py-0.5 font-bold">核实 {counts.verified}</span>
                  )}
                </div>
                <div className="text-[0.58rem] text-muted leading-relaxed">
                  不符＝与信源说法不一致（按修正稿改） · 争议＝独立信源说法冲突（呈现多方，不选边） · 存疑＝无独立信源支持 · 核实＝与信源一致
                </div>
              </div>
            )}

            <div className="space-y-4">{items}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
