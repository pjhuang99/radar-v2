import React, { useState } from 'react';
import { RefreshCw, Search, ExternalLink, Check, AlertTriangle, ChevronDown, ChevronRight } from 'lucide-react';
import { AUTHORITY_LABELS } from '../config/sources';

interface SearchResult {
  title: string;
  url: string;
  source: string;
  date: string;
  summary: string;
  authorityLevel: 'high' | 'medium' | 'unknown';
  authorityScore: number;
  relevanceScore: number;
}

interface ApiResponse {
  results: SearchResult[];
  query: string;
  totalFound: number;
  returned: number;
  usedAnySearch: boolean;
  warning?: string;
}

interface TopicSearchPanelProps {
  apiKey: string;
  onImport: (
    facts: string[],
    refs: { title: string; url: string; source: string; content?: string }[],
    title: string
  ) => void;
}

type TabKey = 'anysearch' | 'sina';

const TAB_LABELS: Record<TabKey, string> = {
  anysearch: 'AnySearch',
  sina: '新浪新闻',
};

export default function TopicSearchPanel({ apiKey, onImport }: TopicSearchPanelProps) {
  const [topic, setTopic] = useState('');
  const [freshness, setFreshness] = useState<string>('day');
  const [step, setStep] = useState<'input' | 'searching' | 'results'>('input');
  const [activeTab, setActiveTab] = useState<TabKey>('anysearch');

  // Dual result stores
  const [anyResults, setAnyResults] = useState<SearchResult[]>([]);
  const [sinaResults, setSinaResults] = useState<SearchResult[]>([]);
  const [anySelected, setAnySelected] = useState<Set<number>>(new Set());
  const [sinaSelected, setSinaSelected] = useState<Set<number>>(new Set());
  const [anyWarning, setAnyWarning] = useState('');
  const [sinaWarning, setSinaWarning] = useState('');
  const [error, setError] = useState('');
  const [expandedCards, setExpandedCards] = useState<Set<number>>(new Set());

  // Derived: active tab's data
  const results = activeTab === 'anysearch' ? anyResults : sinaResults;
  const selectedIndices = activeTab === 'anysearch' ? anySelected : sinaSelected;
  const warning = activeTab === 'anysearch' ? anyWarning : sinaWarning;

  const totalSelected = anySelected.size + sinaSelected.size;
  const totalResults = anyResults.length + sinaResults.length;

  // Smart default selection: pick up to 3 articles from different high-authority sources
  const applySmartDefaults = (items: SearchResult[]): Set<number> => {
    const selected = new Set<number>();
    const seenSources = new Set<string>();

    for (let i = 0; i < items.length; i++) {
      if (selected.size >= 3) break;
      if (items[i].authorityLevel === 'high' && !seenSources.has(items[i].source)) {
        selected.add(i);
        seenSources.add(items[i].source);
      }
    }
    if (selected.size < 3) {
      for (let i = 0; i < items.length; i++) {
        if (selected.size >= 3) break;
        if (!selected.has(i) && items[i].authorityLevel !== 'unknown') {
          selected.add(i);
        }
      }
    }
    if (selected.size < 2) {
      for (let i = 0; i < items.length; i++) {
        if (selected.size >= 3) break;
        if (!selected.has(i)) selected.add(i);
      }
    }
    return selected;
  };

  const handleSearch = async () => {
    if (!topic.trim()) return;
    setError('');
    setAnyWarning('');
    setSinaWarning('');
    setStep('searching');

    const searchBody = { topic: topic.trim(), freshness };

    // Fire both engines in parallel
    const [anyP, sinaP] = await Promise.allSettled([
      fetch('/api/search-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...searchBody, engine: 'anysearch' }),
      }).then(r => r.ok ? r.json() : Promise.reject(new Error(`AnySearch ${r.status}`))),
      fetch('/api/search-topic', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...searchBody, engine: 'sina' }),
      }).then(r => r.ok ? r.json() : Promise.reject(new Error(`Sina ${r.status}`))),
    ]);

    // Process AnySearch results
    if (anyP.status === 'fulfilled') {
      const data = anyP.value as ApiResponse;
      setAnyResults(data.results);
      setAnyWarning(data.results.length === 0 ? (data.warning || 'AnySearch 暂无结果') : '');
      setAnySelected(applySmartDefaults(data.results));
    } else {
      setAnyResults([]);
      const reason = anyP.reason?.message || String(anyP.reason);
      setAnyWarning(`AnySearch 搜索失败: ${reason}`);
      setAnySelected(new Set());
    }

    // Process Sina results
    if (sinaP.status === 'fulfilled') {
      const data = sinaP.value as ApiResponse;
      setSinaResults(data.results);
      setSinaWarning(data.results.length === 0 ? (data.warning || '新浪搜索暂无结果') : '');
      setSinaSelected(applySmartDefaults(data.results));
    } else {
      setSinaResults([]);
      const reason = sinaP.reason?.message || String(sinaP.reason);
      setSinaWarning(`新浪搜索失败: ${reason}`);
      setSinaSelected(new Set());
    }

    // Auto-switch to the tab with more results
    if (anyP.status === 'rejected' && sinaP.status === 'fulfilled') {
      setActiveTab('sina');
    }

    setExpandedCards(new Set());
    setStep('results');
  };

  const setSelectedForTab = (tab: TabKey, val: Set<number>) => {
    if (tab === 'anysearch') setAnySelected(val);
    else setSinaSelected(val);
  };

  const handleToggleResult = (idx: number) => {
    setSelectedForTab(activeTab, (() => {
      const prev = activeTab === 'anysearch' ? anySelected : sinaSelected;
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    })());
  };

  const handleSelectAll = () => {
    const current = activeTab === 'anysearch' ? anySelected : sinaSelected;
    if (current.size === results.length) {
      setSelectedForTab(activeTab, new Set());
    } else {
      setSelectedForTab(activeTab, new Set(results.map((_, i) => i)));
    }
  };

  const handleToggleExpand = (idx: number) => {
    setExpandedCards(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx);
      else next.add(idx);
      return next;
    });
  };

  const handleImport = () => {
    if (anySelected.size + sinaSelected.size === 0) return;

    const anyPicks = Array.from(anySelected)
      .sort((a, b) => a - b)
      .map(i => anyResults[i]);
    const sinaPicks = Array.from(sinaSelected)
      .sort((a, b) => a - b)
      .map(i => sinaResults[i]);
    const allPicked = [...anyPicks, ...sinaPicks];

    const facts = allPicked.map(
      (r, i) => `[信源${i + 1}: ${r.source}] ${r.summary}`
    );
    const refs = allPicked.map(r => ({
      title: r.title,
      url: r.url,
      source: r.source,
    }));

    onImport(facts, refs, topic.trim());
  };

  const handleReset = () => {
    setAnyResults([]);
    setSinaResults([]);
    setAnySelected(new Set());
    setSinaSelected(new Set());
    setExpandedCards(new Set());
    setAnyWarning('');
    setSinaWarning('');
    setError('');
    setActiveTab('anysearch');
    setStep('input');
  };

  const getAuthorityBadge = (level: string) => {
    const cfg = AUTHORITY_LABELS[level] || AUTHORITY_LABELS.unknown;
    return (
      <span className={`text-[0.55rem] font-bold px-1.5 py-0.5 rounded ${cfg.bgClass} ${cfg.textClass} border border-current/20`}>
        {cfg.label}
      </span>
    );
  };

  const getScoreColor = (score: number) => {
    if (score >= 8) return 'text-green-700';
    if (score >= 6) return 'text-blue-600';
    if (score >= 4) return 'text-amber-600';
    return 'text-red-500';
  };

  // Format date string to readable YYYY-MM-DD
  const fmtDate = (d: string): string => {
    const clean = d.replace(/[年月]/g, '-').replace(/日/, '').replace(/\s.*/, '').trim();
    const parsed = new Date(clean);
    if (!isNaN(parsed.getTime())) {
      return `${parsed.getFullYear()}-${String(parsed.getMonth() + 1).padStart(2, '0')}-${String(parsed.getDate()).padStart(2, '0')}`;
    }
    return clean.length >= 10 ? clean.substring(0, 10) : clean;
  };

  // Render a single result card (reusable across tabs)
  const renderCard = (r: SearchResult, i: number, selected: Set<number>, expanded: Set<number>) => {
    const isSelected = selected.has(i);
    const isExpanded = expanded.has(i);
    const combinedScore = r.authorityScore + r.relevanceScore;
    const isLowQuality = combinedScore < 4;

    return (
      <div
        key={i}
        className={`border transition-all group ${
          isSelected
            ? 'border-ink bg-cream/30 shadow-sm'
            : 'border-border bg-paper hover:border-ink/30'
        } ${isLowQuality ? 'opacity-50' : ''}`}
      >
        <div className="flex items-start gap-3 p-3">
          {/* Checkbox */}
          <button
            onClick={() => handleToggleResult(i)}
            className={`mt-1 w-4 h-4 border flex-shrink-0 flex items-center justify-center transition-colors ${
              isSelected
                ? 'bg-ink border-ink text-paper'
                : 'border-muted/50 hover:border-ink'
            }`}
          >
            {isSelected && <Check size={10} strokeWidth={3} />}
          </button>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1 flex-wrap">
              {getAuthorityBadge(r.authorityLevel)}
              <span className="text-[0.6rem] font-bold text-ink/70">
                {r.source}
              </span>
              {r.date && (
                <span className="text-[0.55rem] text-muted font-mono">{fmtDate(r.date)}</span>
              )}
              <span
                className={`text-[0.55rem] font-mono font-bold ml-auto ${getScoreColor(combinedScore)}`}
                title={`权威性:${r.authorityScore}/5 相关性:${r.relevanceScore}/5`}
              >
                ★{combinedScore}/10
              </span>
            </div>

            {/* Clickable title */}
            <a
              href={r.url}
              target="_blank"
              rel="noreferrer"
              onClick={(e) => e.stopPropagation()}
              className="font-bold text-[0.85rem] leading-snug mb-1.5 block text-ink hover:text-accent transition-colors"
              title="点击在新标签页打开原文"
            >
              {r.title}
            </a>

            {/* Summary - always visible, expand/collapse on click */}
            <div
              onClick={() => handleToggleExpand(i)}
              className="cursor-pointer"
            >
              <div
                className={`text-[0.72rem] leading-relaxed text-ink/70 overflow-hidden transition-all ${
                  isExpanded ? '' : 'line-clamp-3'
                }`}
              >
                {r.summary}
              </div>
              {r.summary && r.summary.length > 150 && (
                <button className="text-[0.6rem] text-muted hover:text-ink mt-1 font-mono uppercase flex items-center gap-1">
                  {isExpanded ? (
                    <>
                      <ChevronRight size={10} className="rotate-90" />
                      收起
                    </>
                  ) : (
                    <>
                      <ChevronRight size={10} />
                      展开全文
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {/* External link icon */}
          <a
            href={r.url}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            className="text-muted hover:text-accent flex-shrink-0 mt-1 p-1 transition-colors"
            title="查看原文"
          >
            <ExternalLink size={14} />
          </a>
        </div>
      </div>
    );
  };

  return (
    <div className="topic-search-panel">
      {/* Input Section */}
      <div className={`transition-all duration-300 ${step === 'results' ? 'mb-4 opacity-70' : ''}`}>
        <div className="flex flex-col gap-3">
          <div className="flex items-stretch gap-2">
            <div className="flex-1 relative">
              <input
                type="text"
                className="w-full border border-ink/30 bg-paper px-4 py-3 text-[0.95rem] font-serif placeholder:text-muted/50 focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink/10 transition-all"
                placeholder="输入简短关键词，不要输入长句子"
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && step !== 'searching') {
                    handleSearch();
                  }
                }}
                disabled={step === 'searching'}
                autoFocus
              />
              {step === 'searching' && (
                <div className="absolute right-3 top-1/2 -translate-y-1/2">
                  <RefreshCw size={18} className="animate-spin text-muted" />
                </div>
              )}
            </div>
            <button
              className="bg-ink text-paper px-5 py-3 font-bold text-[0.75rem] uppercase tracking-wider hover:bg-ink/90 disabled:opacity-40 disabled:cursor-not-allowed transition-all flex items-center gap-2 whitespace-nowrap"
              onClick={handleSearch}
              disabled={!topic.trim() || step === 'searching'}
            >
              {step === 'searching' ? (
                <>
                  <RefreshCw size={14} className="animate-spin" />
                  搜索中
                </>
              ) : (
                <>
                  <Search size={16} />
                  搜索
                </>
              )}
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-3 items-center text-[0.65rem] font-mono text-muted flex-wrap">
            <div className="flex items-center gap-1.5">
              <span className="uppercase tracking-wider font-bold">时间</span>
              <div className="flex border border-border rounded-sm overflow-hidden">
                {[
                  { value: 'day', label: '24小时' },
                  { value: 'week', label: '本周' },
                  { value: 'month', label: '本月' },
                ].map(({ value, label }) => (
                  <button
                    key={value}
                    disabled={step === 'searching'}
                    onClick={() => setFreshness(value)}
                    className={`px-2 py-1 text-[0.65rem] font-bold uppercase tracking-wider transition-all ${
                      freshness === value
                        ? 'bg-ink text-paper'
                        : 'bg-transparent text-muted hover:text-ink'
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 p-4 border border-red-200 bg-red-50/50 text-red-700 text-[0.75rem] flex items-start gap-2">
          <AlertTriangle size={16} className="flex-shrink-0 mt-0.5" />
          <div>
            <div className="font-bold mb-1">搜索异常</div>
            <div>{error}</div>
          </div>
        </div>
      )}

      {/* Results Section */}
      {step === 'results' && (
        <div className="border-t border-ink/10 pt-4">
          {/* Tabs + header */}
          <div className="flex justify-between items-center mb-4">
            <div className="flex items-center gap-1">
              {(Object.keys(TAB_LABELS) as TabKey[]).map(tab => (
                <button
                  key={tab}
                  onClick={() => setActiveTab(tab)}
                  className={`px-3 py-1.5 text-[0.75rem] font-bold transition-all border-b-2 ${
                    activeTab === tab
                      ? 'border-ink text-ink'
                      : 'border-transparent text-muted hover:text-ink/70'
                  }`}
                >
                  {TAB_LABELS[tab]}
                  <span className="ml-1.5 text-[0.65rem] font-mono text-muted">
                    ({tab === 'anysearch' ? anyResults.length : sinaResults.length}篇)
                  </span>
                </button>
              ))}
            </div>
            <div className="flex items-center gap-3">
              <span className="text-[0.65rem] text-muted font-mono">
                已选 {selectedIndices.size}/{results.length} 篇
                {totalSelected > selectedIndices.size && (
                  <span className="text-ink/50">（总计 {totalSelected} 篇）</span>
                )}
              </span>
              <button
                onClick={handleSelectAll}
                className="text-[0.6rem] text-muted hover:text-ink underline font-mono uppercase"
              >
                {selectedIndices.size === results.length ? '取消全选' : '全选'}
              </button>
              <button
                onClick={handleReset}
                className="text-[0.65rem] text-muted hover:text-accent underline font-mono uppercase flex items-center gap-1"
              >
                <RefreshCw size={12} />
                重新搜索
              </button>
            </div>
          </div>

          {/* Warning */}
          {warning && (
            <div className="mb-4 p-3 border border-amber-200 bg-amber-50/50 text-amber-700 text-[0.7rem] flex items-center gap-2">
              <AlertTriangle size={14} />
              {warning}
            </div>
          )}

          {/* Result cards */}
          {results.length === 0 ? (
            <div className="py-12 text-center text-muted italic text-[0.8rem]">
              暂无匹配的搜索结果
            </div>
          ) : (
            <div className="flex flex-col gap-2 max-h-[55vh] overflow-y-auto pr-1">
              {results.map((r, i) => renderCard(r, i, selectedIndices, expandedCards))}
            </div>
          )}

          {/* Import button */}
          {(anyResults.length > 0 || sinaResults.length > 0) && (
            <div className="mt-4 pt-4 border-t border-border flex justify-end">
              <button
                className="bg-ink text-paper px-8 py-3 font-bold text-[0.8rem] uppercase tracking-wider hover:bg-ink/90 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
                onClick={handleImport}
                disabled={totalSelected === 0}
              >
                ▶ 导入选中文章 ({totalSelected}篇)，进入事实提取与创作
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
