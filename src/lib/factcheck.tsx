/**
 * 事实核查引擎（从 App.tsx 抽离，供草稿流程与独立核查入口复用）
 *
 * 五件套：
 *   - extractFactCheckQueries   从标题+正文首段抽核查查询词（规则版）
 *   - buildFactCheckQueries     优先用 LLM 生成检索词，失败回落规则版
 *   - performAutoRetrieval      新浪 + DeepSeek 并行检索 → 去重 → 选 ≤5 独立信源 → 抓全文
 *   - fetchUserSourceContents   抓取用户手动指定的核查信源
 *   - buildFactCheckPrompt      构造事实核查 LLM 提示词
 *   - parseFactCheckReport      解析 LLM 报告为 ERR/WARN/OK 卡片 + 修正建议
 *
 * 说明：parseFactCheckReport 返回 ReactNode，故本文件为 .tsx。
 */
import React from 'react';
import { classifySource, maxAuthorityLevel } from '../config/sources';

export interface Correction {
  original: string;
  corrected: string;
  sourceLink: string;
  id: number;
}

export interface AutoSource {
  title: string;
  url: string;
  source: string;
  content: string;
  authorityLevel: string;
  /** 检索结果发布时间（原始口径，可能为空） */
  publishDate?: string;
  /** 独立信源分组号（1 起，同组=转载同一篇稿） */
  clusterGroup?: number;
  /** 该独立信源组内的稿件总数（含代表稿） */
  clusterSize?: number;
  /** 同组的其他媒体域名（转载方） */
  clusterPeers?: string[];
  /** 本次检索共得到多少个独立信源组 */
  independentTotal?: number;
}

export interface FactCheckReference {
  title: string;
  url: string;
  source: string;
  content?: string;
}

/** 阶段4：核实状态（与风险等级正交） */
export type FactStatus = 'VERIFIED' | 'CONTRADICTED' | 'UNVERIFIED' | 'DISPUTED';

export interface FactCheckCounts {
  verified: number;
  contradicted: number;
  unverified: number;
  disputed: number;
}

export interface FactFinding {
  status: FactStatus;
  risk: '' | '高' | '中' | '低';
  claimType: string;
  asOf: string;
  original: string;
  conclusion: string;
  evidence: string;
  sourcesRaw: string;
  /** 因果/归因断言：只给「事实部分属实，因果未获信源支持」 */
  inference: boolean;
  /** 数字容差比对触发的降级说明 */
  toleranceNote?: string;
}

// ── Auto-Retrieval: Extract search queries from draft ──────────────────────
// 核心问题：中文专名（人名/公司/机构）只在标题里抽，不填标题就退化成 CEO/GPU
// 这类泛词，检索结果自然跑偏。现在改为「标题 + 正文首段」抽专名与事件词，
// 正文其余部分再按「人名+动词 / 机构后缀 / 品牌+股价」补抽。

const EN_GENERIC = new Set([
  'CEO', 'CFO', 'COO', 'CTO', 'CIO', 'AI', 'AGI', 'LLM', 'GPU', 'CPU',
  'GDP', 'CPI', 'PPI', 'PMI', 'IPO', 'APP', 'API', 'EV', 'ETF', 'ESG', 'FAQ',
  'US', 'USA', 'UK', 'EU', 'TV', 'PC', 'OK', 'NEW', 'TOP', 'ONE', 'TWO', 'THE',
  'AND', 'FOR', 'WITH', 'VS', 'II', 'III', 'Q1', 'Q2', 'Q3', 'Q4',
]);

// 断词表：在这些词处切开，剩下的片段才可能是人名/机构/品牌/事件词。
// 比旧的「每句取前 7 个字」好：不会把「英伟达将受到什」这种半截词带进检索。
const TERM_BREAK_WORDS = [
  '近日', '日前', '昨日', '今天', '昨天', '今年', '去年', '明年', '当天', '本周', '上周', '周末',
  '目前', '此前', '当时', '截至', '未来', '最近', '近年', '过去', '多年前',
  '表示', '认为', '指出', '强调', '宣布', '承认', '回应', '透露', '坦言', '直言',
  '解释', '证实', '补充', '警告', '否认', '预计', '称', '说',
  '已经', '正在', '曾经', '曾有', '一直', '仍然', '依然', '可能', '将', '会', '已', '拟', '要',
  '由于', '因为', '所以', '如果', '虽然', '然而', '并且', '而且', '不过', '但是',
  '此外', '同时', '以及', '随着', '作为', '包括', '例如', '比如',
  '在', '与', '和', '对', '把', '被', '让', '给', '从', '向', '于', '到', '按', '据', '为',
  '是', '的', '了', '着', '过', '也', '还', '就', '都', '只', '更', '又', '才', '很',
  '一场', '一次', '一段', '一名', '一位', '一家', '一个', '一些', '这', '那', '该', '本', '其', '此',
  '各', '多', '两', '几', '三', '四', '五', '第', '至', '共', '约',
  '需要', '应该', '应当', '必须', '可以', '能够', '希望', '想要', '值得',
  '改变', '变化', '出现', '发生', '导致', '造成', '成为', '显得', '被认为',
  '继续', '履行', '负责', '拒绝', '同意', '决定', '要求', '获得', '拥有', '保持',
  '上涨', '下跌', '增加', '减少', '达到', '超过', '传出', '之后', '随后', '此后',
  '们', '等', '等等', '件事', '情况', '办法', '方式', '过程', '结果',
  '职责', '职务', '岗位', '职位', '计划', '方案', '目前', '当前', '现在', '更换', '替代',
  '没有', '不会', '不能', '并非', '并未', '是否', '能否', '要不要',
  '正在', '逐渐', '不断', '持续', '频繁', '词汇', '财经', '科技', '赛道',
  '发布', '公布', '披露', '通报', '列入', '涉及', '属于', '包括', '涵盖', '上调', '下调',
  '晚间', '凌晨', '上午', '下午', '当地时间', '同日', '当天', '近期', '本月', '上月',
  '季度', '财季', '同比', '环比', '财年', '上半年', '下半年', '前三季度', '全年', '增速',
  '实现', '亿元', '万元', '亿美元', '美元', '港元', '人民币', '百分点',
  '增长', '下滑', '萎缩', '超预期', '不及预期', '目标价', '资本开支', '估值',
  '领域', '软件', '模型', '业务', '收入', '利润', '业绩', '份额', '销量',
  '核心', '主要', '重要', '关键', '相关方', '各方', '双方', '多方',
  '自己', '他们', '我们', '你们', '他', '她', '它',
  '内部', '公开', '视频', '电话', '会议', '活动', '直播', '发布会', '现场', '会上', '期间', '过程',
  '什么', '哪些', '如何', '为什么', '影响', '受到', '相关', '有关', '方面', '情况', '问题',
  '公司', '集团', '组织', '机构', '媒体', '市场', '数据', '报告', '观点', '研究', '调查', '官方',
  '报道', '消息', '人士', '专家', '分析师', '发言人', '副董事长', '董事长', '董事', '高管', '员工', '投资者',
  '用户', '网友', '记者', '编辑', '平台',
  '股价', '市值', '营收', '净利润', '财报', '年报', '季报', '公告', '产品', '新车',
  '各行各业', '行业', '世界', '经济',
];

const CN_STOP_CHARS = /[的了着过是在与和或对把被让给因以能会可要也还就已才又更都只这那某每各]/;
const CN_STOP_HEAD = /^[的了着过是在与和或对把被让给因以能会可要也还就已才又更都只这那某每各]/;
const CN_STOP_WORDS = new RegExp(TERM_BREAK_WORDS.join('|'));

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const TERM_SPLIT_RE = new RegExp(
  `(?:${[...TERM_BREAK_WORDS].sort((a, b) => b.length - a.length).map(escapeRe).join('|')}|[A-Za-z0-9]+|\\s)+`,
  'g',
);

// 「12家中国实体」：量词跟在数字后面，把数字和量词一起当成分隔符，别让「家」粘到实体上
function stripQuantifiers(text: string): string {
  return text.replace(/\d+[家个名位只辆批次项种条]/g, ' ');
}

function stripTags(s: string): string {
  return (s || '').replace(/<[^>]*>/g, '').replace(/【.*?】/g, '').trim();
}

function isNoiseCn(s: string): boolean {
  if (s.length < 2 || s.length > 8) return true;
  if (!/[一-龥A-Za-z]/.test(s)) return true;
  // 2 字片段里出现虚词基本就是碎片；更长的词只看首字（「人工智能」的「能」是实词）
  if (s.length <= 2 && CN_STOP_CHARS.test(s)) return true;
  if (CN_STOP_HEAD.test(s)) return true;
  if (CN_STOP_WORDS.test(s)) return true;
  if (/^[A-Za-z]{1,2}$/.test(s)) return true;
  return false;
}

// 正文首段：取开头 2 句（最多 220 字），这是人名/公司最密集的地方
function firstSentences(text: string, maxChars: number): string {
  const sentences = text.split(/(?<=[。！？!?])|\n+/).filter(s => s.trim());
  let out = '';
  for (const s of sentences) {
    if (out && out.length + s.length > maxChars) break;
    out += s;
    if (out.length >= maxChars * 0.6) break;
  }
  return out.slice(0, maxChars);
}

// 职位词：切完还剩「公司名+职位+人名」这种长片段时，在职位词处断开，两边都留着
const TITLE_WORDS = [
  '联合创始人', '副董事长', '首席执行官', '董事长', '总经理', '创始人', '总裁', '主席', '董事',
  '发言人', '分析师', '经济学家', '总监', '负责人', 'CEO', 'CFO', 'COO', 'CTO', 'CMO',
];

// 按断词表切句 → 片段（人名/公司/事件词）
function clauseTerms(text: string): string[] {
  const out: string[] = [];
  if (!text) return out;
  const push = (raw: string) => {
    const s = (raw || '').trim();
    // 人名/品牌/事件词一般 2-5 字；更长的多半是没切干净的句子碎片
    if (s.length >= 2 && s.length <= 5 && !isNoiseCn(s)) out.push(s);
  };
  for (const clause of stripQuantifiers(text).split(/[，,。！!？?；;：:、\n\r]+/)) {
    if (!clause || /【|】|核心论点|核心观点|摘要|标题建议|字以内/.test(clause)) continue;
    for (const piece of clause.split(TERM_SPLIT_RE)) {
      let s = (piece || '').trim();
      if (s.length > 5) {
        const hit = TITLE_WORDS
          .map(t => [t, s.indexOf(t)] as [string, number])
          .filter(([, i]) => i > 0)
          .sort((a, b) => a[1] - b[1])[0];
        if (!hit) continue;
        push(s.slice(0, hit[1]));
        push(s.slice(hit[1] + hit[0].length));
        continue;
      }
      push(s);
    }
  }
  return out;
}

// 正文其余部分：只在明确的实体语境里抽（人名+动词、机构后缀、品牌+股价）
function contextTerms(text: string): string[] {
  const out: string[] = [];
  if (!text) return out;
  text = stripQuantifiers(text);
  const push = (t: string) => {
    const s = (t || '').trim();
    if (s.length >= 2 && s.length <= 8 && !isNoiseCn(s)) out.push(s);
  };
  const PERSON_VERBS = '表示|称|说|宣布|承认|回应|透露|指出|坦言|认为|强调|警告|否认|担任|出任|辞职|道歉|证实|表态|发声';
  const ORG_SUFFIX = '公司|集团|银行|大学|学院|研究院|研究所|委员会|协会|基金会|交易所|证券|法院|政府|央行|药监局|证监会|工信部|财政部|发改委';
  const BRAND_CTX = '的股价|股价|市值|营收|净利润|财报|年报|季报|公告|发布会';

  for (const m of text.matchAll(new RegExp(`([\\u4e00-\\u9fa5]{2,4})(?=${PERSON_VERBS})`, 'g'))) push(m[1]);
  for (const m of text.matchAll(new RegExp(`([\\u4e00-\\u9fa5A-Za-z0-9]{2,8})(?=${ORG_SUFFIX})`, 'g'))) push(m[1]);
  for (const m of text.matchAll(new RegExp(`([\\u4e00-\\u9fa5]{2,6})(?=${BRAND_CTX})`, 'g'))) push(m[1]);
  return out;
}

function extractEnglishNouns(text: string): string[] {
  const matches = (text || '').match(/[A-Z][a-zA-Z]{2,}(?:'s)?/g);
  if (!matches) return [];
  return [...new Set(matches.map(m => m.replace(/'s$/, '')).filter(m => !EN_GENERIC.has(m.toUpperCase())))];
}

/** 全文实体排序：标题 > 首段 > 全文重复度，返回中文实体与英文专名 */
function rankEntityTerms(title: string, body: string) {
  const cleanTitle = stripTags(title);
  const cleanBody = stripTags(body);

  const lead = firstSentences(cleanBody, 220);

  // 标题 > 首段 > 全文实体语境，三层加权；越靠前的词越像主语/主体，给位置加成
  // strong 标记：只有标题/首段切出来的词或全文重复出现的词才算真实体，避免后缀正则回溯出的碎片
  // head 标记：导语前 60 字是实体最密集区，这一区的词即便只出现一次也值得搜
  const score = new Map<string, { weight: number; first: number; strong: boolean; head: boolean }>();
  let offset = 0;
  const addAll = (text: string, terms: string[], weight: number, strong: boolean, isLead = false) => {
    for (const t of terms) {
      const idx = text.indexOf(t);
      const positionBonus = strong && idx >= 0 ? Math.max(0, 1 - idx / 60) * 1.4 : 0;
      const stat = score.get(t) || { weight: 0, first: Number.MAX_SAFE_INTEGER, strong: false, head: false };
      score.set(t, {
        weight: stat.weight + weight + positionBonus,
        first: Math.min(stat.first, idx >= 0 ? offset + idx : Number.MAX_SAFE_INTEGER),
        strong: stat.strong || strong,
        head: stat.head || (isLead && idx >= 0 && idx < 60),
      });
    }
    offset += text.length;
  };
  addAll(cleanTitle, clauseTerms(cleanTitle), 3, true);
  addAll(lead, clauseTerms(lead), 2, true, true);
  // 正文其余部分也扫，但只给低权重：真正的专名会靠下面的重复度自己冒上来
  addAll(cleanBody, contextTerms(cleanBody), 1, false);

  // 人名/公司名/机构名在全文会反复出现，切词碎片通常只出现一次。
  // 按「出现在几个句子里」算跨度（引语里重复不算），跨度越大越像真实体
  const segments = cleanBody.split(/[。！？!?\n]+/).filter(s => s.trim());
  for (const [t, stat] of score) {
    const spread = segments.reduce((n, seg) => (seg.includes(t) ? n + 1 : n), 0);
    if (spread >= 2) {
      score.set(t, { ...stat, weight: stat.weight + Math.min(4, spread - 1) * 1.0, strong: true });
    }
  }

  // 词频分与最高分差距过大的，多半是切词碎片，直接截掉；导语区的词例外（最多 4 个）
  const strongTerms = [...score.entries()].filter(([t, stat]) => stat.strong && /[一-龥]/.test(t));
  // n-gram 碎片：更长且同样强的词以它结尾时丢掉（「国商务部」→「美国商务部」，「商务部」也一并让位）
  const termSet = new Set(strongTerms.map(([t]) => t));
  const ranked = strongTerms
    .filter(([t]) => ![...termSet].some(u => u.length > t.length && u.endsWith(t)))
    .sort((a, b) => b[1].weight - a[1].weight || a[1].first - b[1].first);
  const minWeight = ranked.length ? Math.max(1.9, ranked[0][1].weight * 0.4) : 0;
  let headUsed = 0;
  const cn = ranked
    .filter(([, stat]) => (stat.head && headUsed++ < 4) || stat.weight >= minWeight)
    .map(([t]) => t)
    .slice(0, 6);

  const en = [...new Set([
    ...extractEnglishNouns(cleanTitle),
    ...extractEnglishNouns(lead),
    ...extractEnglishNouns(cleanBody.slice(0, 800)),
  ])].slice(0, 3);

  return { cleanTitle, cleanBody, lead, cn, en };
}

/** 规则版检索词抽取（无网络依赖，LLM 失败时的兜底） */
export function extractFactCheckQueries(title: string, body: string): string[] {
  const { cleanTitle, cleanBody, lead, cn, en } = rankEntityTerms(title, body);
  if (!cleanTitle && !cleanBody) return [];

  const queries: string[] = [];
  const tokensOf = (s: string) => s.split(/\s+/).filter(Boolean);
  const isCovered = (q: string) => {
    const qt = tokensOf(q);
    return queries.some(existing => {
      if (existing === q) return true;
      const et = tokensOf(existing);
      if (et.every(tok => q.includes(tok))) return true; // 新查询覆盖已有查询
      return qt.every(tok => existing.includes(tok));    // 新查询是已有查询的子集
    });
  };
  const push = (q: string) => {
    const v = q.trim();
    if (v.length >= 3 && !isCovered(v)) queries.push(v);
  };
  const buildQ = (parts: string[]) => [...new Set(parts.filter(Boolean))].join(' ').slice(0, 30).trim();

  // 主查询：核心人名/品牌 + 事件词（如「黄仁勋 英伟达 婚外情」）
  push(buildQ([cn[0], cn[1], cn[2]]));
  // 次查询：核心实体 + 第二梯队词 + 英文专名
  if (cn.length) push(buildQ([cn[0], cn[3] || cn[1], en[0]]));

  // 兜底：正文首句原文（语义检索通常能匹配同一事件），在标点处断开且必须含核心实体
  const rawSentence = (lead.split(/[。！？!?\n]/)[0] || '').trim();
  const leadSentence = rawSentence
    .split(/[，,；;：:]/)
    .reduce((acc, seg) => (acc.length + seg.length <= 20 ? acc + seg : acc), '');
  if (queries.length < 3 && leadSentence.length >= 8 && (!cn.length || leadSentence.includes(cn[0]))) push(leadSentence);
  if (queries.length < 3 && en.length) push(buildQ([en[0], en[1], cn[0]]));

  return queries.slice(0, 3);
}

// ── 断言级检索词 ──────────────────────────────────────────────────────────
// 事实核查要验的是具体断言（数字/日期/引文/机构表态）。整篇抽主题词，只能搜回
// 同一主题的报道；这里把正文拆句，挑最可核查的几条，每条生成「锚定强实体」的
// 定向查询：数字保留精度、日期保留原样、引文用原文片段。
const CLAIM_NUMBER_RE = /(\d+(?:\.\d+)?)\s*(万亿|亿|万|%|％|个百分点|家|名|位|个|项|条|批|艘|架|台)/;
const CLAIM_DATE_RE = /(\d{4}年\d{1,2}月|\d{1,2}月\d{1,2}日|第[一二三四]季度|Q[1-4]|前三季度|上半年|下半年|全年)/;
const CLAIM_QUOTE_RE = /[“"「『]([^”"」』\n]{4,30})[”"」』]/;

export function extractClaimQueries(title: string, body: string, coreTerms?: string[]): string[] {
  const cleanBody = stripTags(body);
  if (!cleanBody) return [];
  const cn = coreTerms && coreTerms.length ? coreTerms : rankEntityTerms(title, body).cn;
  // 强实体：长度≥3 且在全文出现≥2次（人名/公司/机构通常会反复出现）；
  // 只有泛实体（如「街道」「市场」）时才放宽，避免把泛词当锚点。
  const countIn = (hay: string, needle: string) => {
    let n = 0;
    let from = 0;
    while (needle && (from = hay.indexOf(needle, from)) >= 0) { n++; from += needle.length; }
    return n;
  };
  // 动作/描述性短语不能当锚点
  const NOT_ANCHOR_RE = /^(覆盖|涵盖|涉及|包括|实现|同比|环比|增长|下降|上涨|下跌|表示|认为|宣布|目前|本次|其中|以及|通过|进行|相关|坚决|强烈|正式|继续|进一步|持续|大幅|明显|首次|共同)/;
  const usable = cn.filter(t => !NOT_ANCHOR_RE.test(t));
  const repeated = usable.filter(t => countIn(cleanBody, t) >= 2);
  const strong = repeated.filter(t => t.length >= 3);
  const anchorPool = strong.length ? strong : (repeated.length ? repeated : usable);

  const sentences = cleanBody
    .split(/(?<=[。！？!?；;])|\n+/)
    .map(s => s.trim())
    .filter(s => s.length >= 8 && s.length <= 160);
  if (!sentences.length) return [];

  const scored = sentences.map((s, i) => {
    const num = s.match(CLAIM_NUMBER_RE);
    const date = s.match(CLAIM_DATE_RE);
    const quote = s.match(CLAIM_QUOTE_RE);
    // 锚点取离数字/日期/引文最近的实体，而不是全局排名第一的实体：
    // 「中芯国际跌4%」的锚点应是中芯国际，不是同句里的美国商务部。
    const hitPos = [num?.index, date?.index, quote?.index]
      .filter((p): p is number => typeof p === 'number')
      .reduce((m, p) => Math.min(m, p), Number.MAX_SAFE_INTEGER);
    const inSentence = anchorPool.filter(t => s.includes(t));
    const anchor = inSentence.sort((a, b) => {
      // 离数字/日期/引文最近的实体更像这句话的主语；距离相同再取更完整的词
      const da = Math.abs(s.indexOf(a) - (hitPos === Number.MAX_SAFE_INTEGER ? 0 : hitPos));
      const db = Math.abs(s.indexOf(b) - (hitPos === Number.MAX_SAFE_INTEGER ? 0 : hitPos));
      if (da !== db) return da - db;
      return b.length - a.length;
    })[0] || '';
    let score = anchor ? 2 : 0;
    if (num) score += 3;
    if (date) score += 1.5;
    if (quote) score += 3;
    // 表态/公告类句子通常有官方口径可查
    if (/表示|宣布|承认|回应|通报|公告|披露|决定/.test(s)) score += 1;
    return { s, i, score, anchor, num, date, quote };
  });

  // 纯观点句没有可检索的硬信息；没有数字/日期/引文、只剩一个实体的句子太宽泛，不单独成查询
  const candidates = scored
    .filter(c => c.score >= 3 && (c.num || c.date || c.quote))
    .sort((a, b) => b.score - a.score || a.i - b.i);

  const out: string[] = [];
  const seenKeys = new Set<string>();
  for (const c of candidates) {
    if (out.length >= 3) break;
    const anchor = c.anchor || anchorPool[0] || '';
    if (!anchor) continue;

    const parts: string[] = [anchor];
    let key = '';
    if (c.quote) {
      // 引文去前缀/尾标点，保留原话主体
      key = c.quote[1].trim()
        .replace(/^(本次|该|这|上述|所谓)/, '')
        .replace(/[，。、；;,.!?！？\s]+$/, '')
        .slice(0, 16);
    } else if (c.num) {
      const [full, value, unit] = c.num;
      if (/[%％]|个百分点/.test(unit)) {
        // 百分数只在修饰动词明确时带上（上涨/下跌…），否则只留数字
        const before = c.s.slice(Math.max(0, (c.num.index || 0) - 4), c.num.index).replace(/[^一-龥]/g, '');
        const verb = (before.match(/(上涨|下跌|增长|下降|提升|下滑|回升|收窄|扩大|超过|不足|约)$/) || [''])[0];
        key = `${verb}${full}`.trim();
      } else {
        // 绝对量只保留数字+单位，不让人简化精度（343.72亿元 不能变 343）
        key = `${value}${unit}`;
      }
    } else if (c.date) {
      key = c.date[1];
    }

    if (key && !seenKeys.has(key)) { parts.push(key); seenKeys.add(key); }
    if (c.date && key !== c.date[1]) parts.push(c.date[1]);
    // 再补一个同句内的其他实体（优先强实体），避免只搜数字
    const other = anchorPool.find(t => t !== anchor && t.length >= 3 && c.s.includes(t))
      || anchorPool.find(t => t !== anchor && c.s.includes(t));
    if (other) parts.push(other);

    const q = [...new Set(parts.map(p => p.trim()).filter(Boolean))].join(' ').slice(0, 30).trim();
    if (q.length >= 3 && !out.some(e => e.includes(q) || q.includes(e))) out.push(q);
  }
  return out;
}

/**
 * 检索词组装：LLM 整体视角 3 组 + 规则版整体查询 + 断言级查询（数字/日期/引文），
 * 去重后最多 6 组。LLM 失败时规则版+断言级照样能跑，不阻塞核查主流程。
 */
export async function buildFactCheckQueries(
  callAI: ((prompt: string, options?: { maxTokens?: number; temperature?: number }) => Promise<string>) | null | undefined,
  title: string,
  body: string,
  timeoutMs = 8000,
): Promise<string[]> {
  const ruleQueries = extractFactCheckQueries(title, body);
  const claimQueries = extractClaimQueries(title, body);
  const mergeQueries = (base: string[]) => {
    const merged: string[] = [];
    const norm = (q: string) => q.split(/\s+/).filter(Boolean).sort().join(' ');
    // 断言级查询优先级高于整体兜底查询：数字/日期/引文才是能证伪的点
    for (const q of [...base, ...claimQueries, ...ruleQueries]) {
      const v = (q || '').trim();
      if (v.length < 3) continue;
      // 只按词集去重：「英伟达 黄仁勋」不该把更具体的「英伟达 黄仁勋 婚外情」顶掉
      if (merged.some(m => norm(m) === norm(v))) continue;
      merged.push(v);
      if (merged.length >= 6) break;
    }
    return merged;
  };

  if (!callAI) return mergeQueries([]);

  const cleanBody = stripTags(body);
  const prompt = `你是新闻事实核查的检索词生成器。阅读下面的文章，输出 3 行检索词，用于在中文新闻站搜索「同一事件」的公开报道。

规则：
1. 每行一组，2-4 个词，空格分隔，总长不超过 20 个汉字；
2. 必须包含核心人名 / 公司 / 机构 / 产品名；正文里有具体数字、日期、引号内原话的，至少两行要带上它们（数字保留原有精度，不要四舍五入）；
3. 不要泛词（新闻、报道、最新、影响、分析、看法、关注），不要解释，不要编号；
4. 三行换不同角度：一行找同一事件的原始报道，一行找可证伪该数字/日期的官方或权威口径，一行用不同表述交叉检索。

${title ? `标题：${title.slice(0, 120)}\n` : ''}正文：
${cleanBody.slice(0, 1200)}

只输出 3 行检索词。`;

  try {
    const aiText = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('query-extract timeout')), timeoutMs);
      callAI(prompt, { maxTokens: 120, temperature: 0 }).then(
        (v) => { clearTimeout(timer); resolve(v); },
        (e) => { clearTimeout(timer); reject(e); },
      );
    });

    const aiQueries: string[] = [];
    for (const raw of (aiText || '').split(/\r?\n/)) {
      const line = raw.trim().replace(/^\d+\s*[.、)）:：]\s*/, '').replace(/^[-•*·]\s*/, '').trim();
      if (!line || line.length < 3 || line.length > 40) continue;
      if (/[：:]/.test(line)) continue; // 带解释的行丢掉
      const q = line.replace(/["“”'‘’]/g, '').replace(/[。；;]$/, '').trim();
      if (q.split(/\s+/).length > 5) continue;
      if (!aiQueries.includes(q)) aiQueries.push(q);
    }

    if (!aiQueries.length) return mergeQueries([]);
    return mergeQueries(aiQueries.slice(0, 3));
  } catch (e) {
    console.warn('LLM query extraction failed, falling back to rule-based queries', e);
    return mergeQueries([]);
  }
}

// ── 阶段5：独立性聚类工具 ─────────────────────────────────────────────────
// 目的：十家转载同一篇稿，不等于十方印证。先按域名去重，再按标题相似度
// （中文 bigram Jaccard ≥ 0.5）+ 发布时间窗归并成「独立信源组」。

/** 标题分词：英文按词，中文按二元组（bigram） */
export function titleTokens(title: string): Set<string> {
  const tokens = new Set<string>();
  const t = (title || '').toLowerCase().replace(/<[^>]+>/g, '');
  for (const w of (t.match(/[a-z0-9]{2,}/g) || [])) tokens.add(w);
  for (const run of (t.match(/[一-鿿]+/g) || [])) {
    if (run.length === 1) tokens.add(run);
    for (let i = 0; i + 2 <= run.length; i++) tokens.add(run.slice(i, i + 2));
  }
  return tokens;
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  a.forEach(t => { if (b.has(t)) inter++; });
  return inter / (a.size + b.size - inter);
}

/** 宽松解析中文/英文日期，失败返回 null */
export function parseLooseDate(raw: string | undefined): number | null {
  if (!raw) return null;
  const s = String(raw).trim();
  const m = s.match(/(\d{4})\s*[-\/年.]\s*(\d{1,2})\s*[-\/月.]\s*(\d{1,2})/);
  if (m) {
    const t = Date.parse(`${m[1]}-${m[2].padStart(2, '0')}-${m[3].padStart(2, '0')}`);
    return Number.isNaN(t) ? null : t;
  }
  const m2 = s.match(/^(\d{4})\s*[-\/年.]\s*(\d{1,2})/);
  if (m2) {
    const t = Date.parse(`${m2[1]}-${m2[2].padStart(2, '0')}-01`);
    return Number.isNaN(t) ? null : t;
  }
  return null;
}

export function domainOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '').toLowerCase();
  } catch {
    return '';
  }
}

const STORY_SIMILARITY = 0.5;      // 标题 Jaccard 阈值
const STORY_TIME_WINDOW_MS = 10 * 24 * 3600 * 1000; // 同稿发布时间窗 10 天

/** 两条结果是否可视为「同一篇稿的转载」 */
export function isSameStory(
  a: { title: string; date?: string },
  b: { title: string; date?: string }
): boolean {
  if (jaccardSimilarity(titleTokens(a.title), titleTokens(b.title)) < STORY_SIMILARITY) return false;
  const da = parseLooseDate(a.date);
  const db = parseLooseDate(b.date);
  if (da && db && Math.abs(da - db) > STORY_TIME_WINDOW_MS) return false;
  return true;
}

// ── Auto-Retrieval: Search + scrape authoritative independent sources ──────
export async function performAutoRetrieval(queries: string[]): Promise<AutoSource[]> {
  if (!queries.length) return [];

  // Step 1: Search Sina + DeepSeek (parallel, proxied through backend)
  const SEARCH_TIMEOUT = 7000;

  // Common result mapper for both engines
  const MEDIA_DOMAIN_MAP: Record<string, string> = {
    '界面新闻': 'jiemian.com', '澎湃新闻': 'thepaper.cn', '财新': 'caixin.com',
    '新华社': 'xinhuanet.com', '央视新闻': 'cctv.com', '中新网': 'chinanews.com',
    '第一财经': 'yicai.com', '经济观察报': 'eeo.com.cn', '21世纪经济报道': '21jingji.com',
    '每日经济新闻': 'nbd.com.cn', '证券时报': 'stcn.com', '36氪': '36kr.com',
    '虎嗅': 'huxiu.com', '钛媒体': 'tmtpost.com', '新浪科技': 'sina.com.cn',
  };
  const mapResult = (title: string, url: string, source: string, date = ''): RawResult => {
    const mappedDomain = MEDIA_DOMAIN_MAP[source] || '';
    return {
      title: (title || '').replace(/<[^>]+>/g, ''),
      url: url || '',
      source: source || '',
      date: date || '',
      authorityLevel: classifySource(mappedDomain || url),
      authorityScore: mappedDomain ? 4 : (source ? 3 : 2),
      relevanceScore: 3,
    };
  };

  const allSearches = queries.flatMap(query => [
    // Engine 1: Sina News (fast, no auth)
    (async () => {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT);
      try {
        const res = await fetch(`/api/sina-search?q=${encodeURIComponent(query)}`, {
          signal: ctrl.signal,
        });
        if (!res.ok) return [] as RawResult[];
        const data = await res.json();
        return ((data?.result?.list || []) as any[]).map((r: any) => {
          const dateStr = String(r.datetime || r.date || r.time || r.ctime || '');
          const r2 = mapResult(r.origin_title || r.title || '', r.url || '', r.media || '', dateStr);
          r2.snippet = (r.intro || '').replace(/<[^>]+>/g, '').trim();
          return r2;
        });
      } catch { return [] as RawResult[]; }
      finally { clearTimeout(tid); }
    })(),
    // Engine 2: DeepSeek Search (proxied through backend)
    (async () => {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), SEARCH_TIMEOUT);
      try {
        const res = await fetch('/api/deepseek-search', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query }),
          signal: ctrl.signal,
        });
        if (!res.ok) return [] as RawResult[];
        const data = await res.json();
        const results = data?.results || [];
        return (results as any[]).map((r: any) => {
          const authority = typeof r.authority === 'number' ? r.authority : -1;
          const rerank = typeof r.rerank_score === 'number' ? r.rerank_score : 0;
          const source = r.site_name || (r.url ? new URL(r.url).hostname : '');
          const r2 = mapResult(r.title || '', r.url || '', source, String(r.date || ''));
          const dsLevel: 'high' | 'medium' | 'unknown' = authority >= 3 ? 'high' : authority === 2 ? 'medium' : 'unknown';
          const whitelistLevel = classifySource(r.url || source);
          const merged = maxAuthorityLevel(dsLevel, whitelistLevel);
          r2.authorityLevel = merged;
          r2.authorityScore = merged === 'high' ? Math.max(authority >= 3 ? authority + 1 : 0, 4) : (authority >= 3 ? authority + 1 : 3);
          r2.relevanceScore = rerank >= 2.5 ? 5 : rerank >= 2.0 ? 4 : rerank >= 1.5 ? 3 : rerank >= 1.0 ? 2 : 1;
          (r2 as any).snippet = r.summary || r.snippet || '';
          return r2;
        });
      } catch { return [] as RawResult[]; }
      finally { clearTimeout(tid); }
    })(),
  ]);

  interface RawResult {
    title: string; url: string; source: string; authorityLevel: string;
    authorityScore: number; relevanceScore: number;
    date?: string; snippet?: string;
  }

  const settled = await Promise.allSettled(allSearches);
  const allRawResults: RawResult[] = [];
  for (const r of settled) {
    if (r.status === 'fulfilled') allRawResults.push(...r.value);
  }

  console.log(`[AutoRetrieval] ${queries.length} queries → ${allRawResults.length} raw results (Sina + DeepSeek)`);

  if (!allRawResults.length) return [];

  // Step 2a: 去重 —— 先精确 URL，再按域名（同站多篇只留分数最高的一篇代表）
  const levelOrder: Record<string, number> = { high: 3, medium: 2, unknown: 1 };
  const rank = (r: RawResult) => (levelOrder[r.authorityLevel] || 0) * 10 + (r.relevanceScore || 0);

  const byUrl = new Map<string, RawResult>();
  for (const r of allRawResults) {
    if (!r.url || byUrl.has(r.url)) continue;
    byUrl.set(r.url, r);
  }
  const byDomain = new Map<string, RawResult>();
  for (const r of byUrl.values()) {
    const d = domainOf(r.url) || r.source || r.url;
    const cur = byDomain.get(d);
    if (!cur || rank(r) > rank(cur)) byDomain.set(d, r);
  }
  const distinct = [...byDomain.values()].sort((a, b) => rank(b) - rank(a));

  // Step 2b: 独立性聚类 —— 标题相似 + 发布时窗内视为同一篇稿的转载
  const clusters: RawResult[][] = [];
  for (const r of distinct) {
    const hit = clusters.find(c => isSameStory(c[0], r));
    if (hit) hit.push(r); else clusters.push([r]);
  }
  clusters.sort((a, b) => rank(b[0]) - rank(a[0]));

  // 选：优先 high/medium 的独立信源组，不足 2 组再补 unknown。
  // 3 篇覆盖不了多断言，候选池放到 5 组；每组只取 1 篇代表，避免同稿转载刷独立性。
  const strongGroups = clusters.filter(c => c[0].authorityLevel === 'high' || c[0].authorityLevel === 'medium');
  const pickedClusters = (strongGroups.length >= 2
    ? strongGroups
    : [...strongGroups, ...clusters.filter(c => c[0].authorityLevel === 'unknown')]
  ).slice(0, 5);
  const picked = pickedClusters.map(c => c[0]);
  const independentTotal = pickedClusters.length;

  console.log(`[AutoRetrieval] ${distinct.length} distinct domains → ${clusters.length} independent groups, picked ${picked.length}: ${picked.map(p => p.source).join(', ')}`);

  if (!picked.length) return [];

  // Step 3: Try to scrape full text (best-effort, fast timeout since Jina may be down)
  const scraped = await Promise.allSettled(
    picked.map(async (r) => {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000);
      try {
        const res = await fetch(`/api/scrape?url=${encodeURIComponent(r.url)}`, { signal: controller.signal });
        if (!res.ok) return '';
        const text = await res.text();
        if (text.startsWith('{"error"') || text.startsWith('SCRAPE_BLOCKED')) return '';
        return text;
      } catch {
        return '';
      } finally {
        clearTimeout(timeoutId);
      }
    })
  );

  // Step 4: Assemble results — prefer scraped full text, fall back to search snippet
  return picked
    .map((r, i) => {
      const scrapedContent = scraped[i]?.status === 'fulfilled' ? (scraped[i].value || '') : '';
      const hasFullContent = scrapedContent.length > 100;
      const group = pickedClusters[i] || [];
      return {
        title: r.title,
        url: r.url,
        source: r.source,
        authorityLevel: r.authorityLevel,
        publishDate: r.date || '',
        clusterGroup: i + 1,
        clusterSize: group.length,
        clusterPeers: group.slice(1).map(p => domainOf(p.url) || p.source).filter(Boolean),
        independentTotal,
        content: hasFullContent
          ? scrapedContent.substring(0, 3000)
          : (r.snippet || '').substring(0, 500), // fall back to search snippet
      };
    })
    .filter(r => r.content && r.content.length > 30); // keep if any content available
}

// ── Fetch content from user-specified URLs (Phase B) ──────────────────────
export async function fetchUserSourceContents(
  urls: string[]
): Promise<{ extraSourceContent: string; scrapeCount: number; validCount: number }> {
  const validUrls = urls.filter(u => u && u.startsWith('http'));
  if (validUrls.length === 0) {
    return { extraSourceContent: '', scrapeCount: 0, validCount: 0 };
  }

  let scrapeCount = 0;
  const contents = await Promise.all(validUrls.map(async (url) => {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 35000); // Increased timeout to match backend
      const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`, { signal: controller.signal });
      clearTimeout(timeoutId);
      if (res.ok) {
        const text = await res.text();
        if (text && text.length > 100) {
          scrapeCount++;
          return text;
        }
      }
      return '';
    } catch (e) {
      console.warn(`Fetch timeout or error for ${url}`, e);
      return '';
    }
  }));

  const extraSourceContent = contents
    .filter(c => c)
    .map((c, i) => `【用户指定核查信源 ${i+1} 内容（最高优先级）】：\n${c.substring(0, 4000)}`)
    .join('\n\n');

  return { extraSourceContent, scrapeCount, validCount: validUrls.length };
}

// ── Build the fact-check LLM prompt ──────────────────────────────────────
export function buildFactCheckPrompt(params: {
  draftBody: string;
  draftReferences: FactCheckReference[];
  currentSourceContent: string;
  extraSourceContent: string;
  autoSources: AutoSource[];
  today?: string;
}): string {
  const {
    draftBody,
    draftReferences,
    currentSourceContent,
    extraSourceContent,
    autoSources,
  } = params;
  const today = params.today
    || new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

  // Build auto-retrieved sources section（附独立信源分组，避免把转载当成多方印证）
  const levelLabel = (l: string) =>
    l === 'high' ? '一级权威' : l === 'medium' ? '二级可信' : '来源存疑';

  const autoSourceContent = autoSources.length > 0
    ? autoSources.map((s, i) => {
        const group = s.clusterGroup || i + 1;
        const size = s.clusterSize || 1;
        const peers = (s.clusterPeers || []).filter(Boolean);
        const independence = size > 1
          ? `独立信源第 ${group} 组（组内 ${size} 篇转载：${peers.join('、') || '同源'}，只算 1 个独立信源）`
          : `独立信源第 ${group} 组（1 篇）`;
        return `【自动信源 ${i + 1}】（${levelLabel(s.authorityLevel)}；${independence}）：\n标题: ${s.title}\n来源: ${s.source}\n发布时间: ${s.publishDate || '未知'}\nURL: ${s.url}\n正文摘录: ${s.content || '抓取失败'}\n`;
      }).join('\n')
    : '';

  const sourceContext = (currentSourceContent || extraSourceContent || autoSourceContent)
    ? [
        `【多维参考信源清单】：\n${draftReferences.map((r, i) => `[来源${i+1}]：标题《${r.title}》, 链接: ${r.url}`).join('\n')}`,
        '',
        `【原始新闻参考素材】（写作时使用的素材，可能存在偏差）：\n${currentSourceContent || '无'}`,
        '',
        `【用户手动提供的"指定核查信源"】（最高优先级，若与正文冲突请务必指出）：\n${extraSourceContent || '无'}`,
        '',
        `【自动检索的独立核查信源】（AI 自动从互联网检索的权威媒体报道，完全独立于写作过程，提供第三方验证视角）：\n${autoSourceContent || '无'}`
      ].join('\n')
    : '【注意】：未提供任何素材，请完全依赖你的内部知识库，并对不确定的事实标注搜索建议。';

  return `你是一位职业事实核查员（Fact-Checker），只做取证与判断，不改写文章。
【重要基准时间】：${today}（注：请以此作为评估文章时效性的唯一基准，当前已是2026年）

【核查任务】：
对《待核查文章》逐句审计，对照【用户指定的核查信源】【自动检索的独立核查信源】【原始新闻参考素材】，对每一个可核查的断言给出一行结论。

**特别注意**：
- 【用户指定核查信源】优先级最高；若与文章不符，按 CONTRADICTED 处理并说明。
- 【自动检索信源】与写作过程完全独立；若与文章矛盾，是重要线索。但同一「独立信源组」内的多篇只是转载，不能当作多方印证。
- 原始参考素材与独立信源一致、但与文章不符时，同样按 CONTRADICTED 处理。
- 找不到信源支持就写 UNVERIFIED，不要用记忆冒充证据。

【核查基准】：
${sourceContext}

【输出格式】每条结论一行，严格用半角 | 分隔，固定 8 个字段：
状态|风险|断言类型|时间锚点|文章原句|结论或修正|依据|来源

字段说明：
- 状态：VERIFIED（核实一致）/ CONTRADICTED（与信源矛盾，必改）/ UNVERIFIED（未找到独立信源支持，删或改存疑）/ DISPUTED（独立信源之间说法冲突，需呈现多方）
- 风险：高（影响读者判断的硬伤、关键数字）/ 中（可能误导但非硬伤）/ 低（细节表述、措辞）
- 断言类型：事实 / 数字 / 引述 / 观点 / 因果
- 时间锚点：该断言所涉事实的时点或期间（如 2026-10、2026Q3、截至2026-11-09）；无法判断写 未知
- 文章原句：逐字摘录待核查文章中最能代表该问题的一句，不超过 60 字；不要改写，不要把多个断言合并成一条
- 结论或修正：VERIFIED 写「与信源一致」；CONTRADICTED 写正确表述；UNVERIFIED 写「未找到独立信源支持」；DISPUTED 必须写成 A方：… // B方：…
- 依据：必须引用信源中的命中原文，格式 信源原文：「…」；仅凭推理的写 推理：…
- 来源：URL 或 [自动信源N] 或 [核查信源N]，多个用「、」分隔；DISPUTED 需分别给出双方来源与时间，如 A方[自动信源1] 2026-10-02、B方[自动信源2] 2026-10-05

【判定规则】：
1. 逐句核查：粒度到句子/断言，一条一行，禁止把整段合并成一条。
2. 数字容差：先统一单位和口径（万/亿/万亿、百分点/% 、美元/人民币）再比较；因四舍五入、保留位数、统计口径造成的 ≤2% 差异不算矛盾，不得判 CONTRADICTED。
3. 因果与归因：出现「导致/因为/推动/受益于/将带来」等因果或预测性论断时，若事实部分有据但因果链无信源支持，状态一律 UNVERIFIED、断言类型写 因果、结论写「事实部分属实，因果关系未获信源支持」，不得判 VERIFIED 或 CONTRADICTED。
4. 冲突呈现：两个及以上独立信源就同一断言给出不同说法时用 DISPUTED，双方各配最强信源与发布时间，禁止多数投票或自行选边。
5. 推理不冒充证据：依据栏以「推理：」开头的条目，状态不得高于 UNVERIFIED。
6. 数量上限：最多 12 条，优先输出 CONTRADICTED / DISPUTED / UNVERIFIED；VERIFIED 只保留关键数字与核心事实。
7. 不要输出任何开场白、总结、表格表头或解释性文字。

待核查文章：
${draftBody}`;
}

// ── 阶段4：数字容差比对 ─────────────────────────────────────────────────
const UNIT_MULTIPLIER: Record<string, number> = {
  '万亿': 1e12,
  '亿': 1e8,
  '万': 1e4,
  '千': 1e3,
};

/** 抽取文本中的数量（统一换算为绝对值；百分数保留数值本身） */
export function extractQuantities(text: string): number[] {
  const out: number[] = [];
  const re = /(?<![\dQq])(\d+(?:,\d{3})*(?:\.\d+)?)\s*(万亿|亿|万|千|%|％)?(?![年月日季Qq\d])/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || ''))) {
    const n = parseFloat(m[1].replace(/,/g, ''));
    if (!Number.isFinite(n)) continue;
    const unit = m[2] || '';
    out.push(UNIT_MULTIPLIER[unit] ? n * UNIT_MULTIPLIER[unit] : n);
  }
  return out;
}

/** 两个数量是否在容差内（相对差 ≤2%，或绝对差 ≤0.05） */
export function quantitiesClose(a: number, b: number): boolean {
  if (a === b) return true;
  const diff = Math.abs(a - b);
  if (diff <= 0.05) return true;
  const base = Math.max(Math.abs(a), Math.abs(b));
  return base > 0 && diff / base <= 0.02;
}

/**
 * 数字容差守卫：模型容易把「四舍五入 / 统计口径」差异判成 CONTRADICTED。
 * 原句与修正句各只含一个数量且数值接近时，降级为 UNVERIFIED 并附人工确认提示。
 */
export function applyNumericTolerance(f: FactFinding): FactFinding {
  if (f.status !== 'CONTRADICTED' || f.claimType !== '数字') return f;
  const a = extractQuantities(f.original);
  const b = extractQuantities(f.conclusion);
  if (a.length === 1 && b.length === 1 && quantitiesClose(a[0], b[0])) {
    return {
      ...f,
      status: 'UNVERIFIED',
      toleranceNote: `原句与信源数值接近（${f.original.trim()} ↔ ${f.conclusion.trim()}），可能只是取整或统计口径差异，需人工确认后再改。`,
    };
  }
  return f;
}

function cleanField(raw: string): string {
  return (raw || '').replace(/^[\s*`'"“”]+|[\s*`'"“”]+$/g, '').trim();
}

function normalizeRisk(raw: string): '' | '高' | '中' | '低' {
  const s = cleanField(raw);
  if (!s) return '';
  if (/高|严重|high/i.test(s)) return '高';
  if (/低|轻微|low/i.test(s)) return '低';
  if (/中|medium/i.test(s)) return '中';
  return '';
}

/** 把 LLM 报告解析为结构化 findings（兼容旧的 ERROR / WARNING / OK 行） */
export function parseFactFindings(report: string): FactFinding[] {
  const normalized = (report || '').replace(/｜/g, '|');
  const lines = normalized
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.includes('|'));

  const findings: FactFinding[] = [];

  for (const line of lines) {
    // 去掉列表符号、序号、markdown 表格竖线残留
    const cleaned = line.replace(/^[-•*\d]+[.、)）]\s*/, '');
    const p = cleaned.split('|').map((s) => cleanField(s));
    const head = (p[0] || '').toUpperCase();

    // 旧格式兼容：ERROR|原文|修正|原因|来源
    if (/^ERROR\b/.test(head)) {
      findings.push({
        status: 'CONTRADICTED',
        risk: '高',
        claimType: '事实',
        asOf: '未知',
        original: p[1] || '',
        conclusion: p[2] || '',
        evidence: p[3] || '',
        sourcesRaw: p[4] || '',
        inference: false,
      });
      continue;
    }
    // WARNING|原文|建议|理由|来源
    if (/^WARNING\b/.test(head)) {
      findings.push({
        status: 'UNVERIFIED',
        risk: '中',
        claimType: '观点',
        asOf: '未知',
        original: p[1] || '',
        conclusion: p[2] || '',
        evidence: p[3] || '',
        sourcesRaw: p[4] || '',
        inference: false,
      });
      continue;
    }
    // OK|原文|来源
    if (/^OK\b/.test(head)) {
      findings.push({
        status: 'VERIFIED',
        risk: '低',
        claimType: '事实',
        asOf: '未知',
        original: p[1] || '',
        conclusion: '与信源一致',
        evidence: '',
        sourcesRaw: p[2] || '',
        inference: false,
      });
      continue;
    }

    // 新格式：状态|风险|断言类型|时间锚点|文章原句|结论或修正|依据|来源
    const m = head.match(/^(VERIFIED|CONTRADICTED|UNVERIFIED|DISPUTED)\b/);
    if (!m || p.length < 5) continue;

    const claimType = p[2] || '事实';
    const finding: FactFinding = {
      status: m[1] as FactStatus,
      risk: normalizeRisk(p[1] || ''),
      claimType,
      asOf: p[3] || '未知',
      original: p[4] || '',
      conclusion: p[5] || '',
      evidence: p[6] || '',
      sourcesRaw: p[7] || '',
      inference: /因果/.test(claimType),
    };
    if (!finding.original) continue;
    findings.push(applyNumericTolerance(finding));
  }

  return findings;
}

// ── Render the fact-check report into cards ──────────────────────────────
const STATUS_META: Record<
  FactStatus,
  { label: string; action: string; badge: string; text: string }
> = {
  CONTRADICTED: { label: '冲突', action: '必改', badge: 'bg-accent text-white', text: 'text-accent' },
  DISPUTED: { label: 'DISPUTED', action: '争议', badge: 'bg-gold text-white', text: 'text-gold' },
  UNVERIFIED: { label: '未核实', action: '存疑', badge: 'bg-blue text-white', text: 'text-blue' },
  VERIFIED: { label: '核实', action: '一致', badge: 'bg-green text-white', text: 'text-green' },
};

const RISK_CLASS: Record<string, string> = {
  高: 'text-accent border-accent/40',
  中: 'text-gold border-gold/40',
  低: 'text-muted border-border',
};

export function parseFactCheckReport(
  report: string,
  refs: FactCheckReference[],
  sUrl: string,
  sTitle: string,
  userFactUrls: string[] = [],
  autoSourceUrls: string[] = [],
  onLocate?: (original: string) => void
): { items: React.ReactNode[]; corrections: Correction[]; counts: FactCheckCounts; findings: FactFinding[] } {
  const findings = parseFactFindings(report);

  const counts: FactCheckCounts = { verified: 0, contradicted: 0, unverified: 0, disputed: 0 };
  for (const f of findings) {
    if (f.status === 'VERIFIED') counts.verified += 1;
    else if (f.status === 'CONTRADICTED') counts.contradicted += 1;
    else if (f.status === 'DISPUTED') counts.disputed += 1;
    else counts.unverified += 1;
  }

  if (findings.length === 0) {
    return {
      items: [
        <div key="error" className="text-muted italic">
          AI 未发现明显的硬性事实错误，或未能按规范生成报告。建议手动核对关键数据。
        </div>,
      ],
      corrections: [] as Correction[],
      counts,
      findings,
    };
  }

  const items: React.ReactNode[] = [];
  const corrections: Correction[] = [];

  // Extract clean domain from URL for display
  const domainLabel = (url: string): string => {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      return host.length > 30 ? host.substring(0, 28) + '…' : host;
    } catch {
      return '';
    }
  };

  // Parse combined source string: split by 、, ,, ; etc. into individual links
  const parseSourceLinks = (raw: string): { link: string; label: string }[] => {
    if (!raw || !raw.trim()) return [];
    const parts = raw.split(/[、,；;，\n]+/).map((s) => s.trim()).filter(Boolean);
    return parts.map((part) => {
      if (part.startsWith('http')) {
        const d = domainLabel(part);
        return { link: part, label: `🔗 ${d || '外部验证'}` };
      } else if (part.includes('[核查信源')) {
        const m2 = part.match(/\[核查信源\s*(\d+)\]/);
        const idx = m2 ? parseInt(m2[1]) - 1 : 0;
        const url = userFactUrls[idx] || sUrl || '';
        const d = domainLabel(url);
        return { link: url, label: `🔗 ${d || '指定核查信源'}` };
      } else if (part.includes('[自动信源')) {
        const m2 = part.match(/\[自动信源\s*(\d+)\]/);
        const idx = m2 ? parseInt(m2[1]) - 1 : 0;
        const url = autoSourceUrls[idx] || '';
        const d = domainLabel(url);
        return { link: url, label: `🤖 ${d || '自动检索信源'}` };
      } else if (part.includes('[来源')) {
        const m2 = part.match(/\[来源(\d+)\]/);
        const idx = m2 ? parseInt(m2[1]) - 1 : 0;
        const ref = refs[idx];
        const url = ref?.url || sUrl || '';
        const d = domainLabel(url);
        return { link: url, label: `🔗 ${d || ref?.source || '原始对照'}` };
      } else {
        const url = sUrl || (refs[0]?.url || `https://search.sina.com.cn/search?q=${encodeURIComponent(sTitle)}&tp=news`);
        const d = domainLabel(url);
        return { link: url, label: `🔗 ${d || '原始素材对照'}` };
      }
    });
  };

  findings.forEach((f, index) => {
    const meta = STATUS_META[f.status];
    const sourceLinks = parseSourceLinks(f.sourcesRaw);
    if (!sourceLinks.length) {
      sourceLinks.push({
        link: sUrl || (refs[0]?.url || `https://search.sina.com.cn/search?q=${encodeURIComponent(sTitle)}&tp=news`),
        label: '🔗 原始素材对照',
      });
    }
    // Deduplicate by URL, keeping the one with the more informative label
    const seenUrls = new Set<string>();
    const dedupedLinks: { link: string; label: string }[] = [];
    for (const sl of sourceLinks) {
      if (!sl.link || seenUrls.has(sl.link)) continue;
      seenUrls.add(sl.link);
      dedupedLinks.push(sl);
    }
    const hasSpecificUrl = dedupedLinks.some((l) => l.link.startsWith('http'));
    const primaryLink = dedupedLinks[0]?.link || '';

    if (f.status === 'CONTRADICTED') {
      corrections.push({ original: f.original, corrected: f.conclusion, sourceLink: primaryLink, id: index });
    }

    // DISPUTED：拆成 A方 / B方 两栏，不选边
    const disputedSides =
      f.status === 'DISPUTED'
        ? f.conclusion.split(/\s*\/\/\s*/).map((s) => s.trim()).filter(Boolean)
        : [];

    items.push(
      <div className="fact-item group" key={index}>
        <div className="flex items-start gap-2">
          <span className={`${meta.badge} text-[0.6rem] px-1.5 py-0.5 font-bold mt-1 whitespace-nowrap`}>
            {meta.label}
          </span>
          <div className="flex-1 min-w-0">
            {/* 元信息：风险 / 断言类型 / 时间锚点 / 因果 */}
            <div className="flex items-center gap-1.5 flex-wrap mb-1.5 text-[0.58rem] font-mono">
              <span className="text-muted">{meta.action}</span>
              {f.risk && (
                <span className={`border px-1 py-0.5 font-bold ${RISK_CLASS[f.risk] || RISK_CLASS['低']}`}>
                  风险{f.risk}
                </span>
              )}
              {f.claimType && <span className="text-muted border border-border px-1 py-0.5">{f.claimType}</span>}
              {f.asOf && f.asOf !== '未知' && (
                <span className="text-muted border border-border px-1 py-0.5">截至 {f.asOf}</span>
              )}
              {f.inference && (
                <span className="text-gold border border-gold/40 px-1 py-0.5 font-bold">因果未证</span>
              )}
            </div>
          </div>
        </div>

        {/* 原文 / 修正 / 证据 / 链接一律顶格左对齐，不随状态徽标缩进 */}
        <div
          className={`fact-original${
            onLocate ? ' cursor-pointer hover:bg-yellow-100/70 transition-colors' : ''
          }`}
          onClick={onLocate ? () => onLocate(f.original) : undefined}
          title={onLocate ? '点击在左侧正文中定位这句原话' : undefined}
        >
          原文: {f.original}
        </div>

        {f.status === 'DISPUTED' && disputedSides.length >= 2 ? (
          <div className="mt-1 space-y-0.5">
            {disputedSides.map((side, i) => (
              <div key={i} className="fact-corrected">⚖ {side}</div>
            ))}
          </div>
        ) : (
          <div className="fact-corrected">
            {f.status === 'VERIFIED' ? '核实一致：' : f.status === 'UNVERIFIED' ? '存疑：' : '修正: '}
            {f.conclusion}
          </div>
        )}

        {f.evidence && (
          <div className="text-[0.68rem] text-muted mt-1.5 leading-relaxed border-l-2 border-border pl-2">
            {f.evidence.startsWith('推理：') ? '🧠 ' : '📎 '}
            {f.evidence}
          </div>
        )}
        {f.toleranceNote && (
          <div className="text-[0.65rem] text-gold mt-1.5 bg-gold/5 border border-gold/30 px-2 py-1">
            ⚠ {f.toleranceNote}
          </div>
        )}

        <div className="flex gap-2 flex-wrap mt-2">
          {dedupedLinks.map((sl, i) => (
            <a key={i} className="fact-link" href={sl.link} target="_blank" rel="noreferrer">
              {sl.label}
            </a>
          ))}
          {!hasSpecificUrl && (
            <a
              className="fact-link"
              href={`https://search.sina.com.cn/search?q=${encodeURIComponent(f.original)}&tp=news`}
              target="_blank"
              rel="noreferrer"
            >
              🌐 联机检索
            </a>
          )}
        </div>
      </div>
    );
  });

  return { items, corrections, counts, findings };
}
