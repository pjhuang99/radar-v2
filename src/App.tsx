import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { motion, AnimatePresence } from "motion/react";
import { Rss, Plus, Trash2, Settings, RefreshCw, ExternalLink, Volume2, SquarePen } from "lucide-react";
import TopicSearchPanel from './components/TopicSearchPanel';

interface Topic {
  title: string;
  angles: string[];
  url: string;
  sourceName: string;
}

interface RawItem {
  title: string;
  url: string;
  _sourceName: string;
  pubDate?: string;
}

interface Correction {
  original: string;
  corrected: string;
  sourceLink: string;
  id: number;
}

interface Draft {
  id: string;
  title: string;
  body: string;
  metaInfo: string;
  updatedAt: number;
  references: {title: string, url: string, source: string, content?: string}[];
  factCheckReport?: string;
  factCheckUrls?: string[];
  sourceContent?: string;
  sourceUrl?: string;
  sourceName?: string;
}

// Global error handler to suppress noisy extension errors
if (typeof window !== 'undefined') {
  const isExtensionError = (err: any) => {
    if (!err) return false;
    // Handle objects, strings, and potential circular refs or null properties
    let msg = '';
    try {
      msg = (typeof err === 'string' ? err : (err?.message || err?.reason?.message || JSON.stringify(err) || '')).toLowerCase();
    } catch (e) {
      msg = String(err).toLowerCase();
    }
    const stack = (err?.stack || '').toLowerCase();
    
    const keywords = [
      'talisman',
      'extension',
      'onboarding',
      'wallet',
      'metamask',
      'phantom',
      'brave',
      'chrome-extension',
      'moz-extension',
      'polkadot',
      'ethereum',
      'provider',
      'inpage'
    ];
    
    return keywords.some(kw => msg.includes(kw) || stack.includes(kw));
  };

  const originalError = console.error;
  console.error = (...args) => {
    if (args.some(arg => isExtensionError(arg))) return;
    originalError.apply(console, args);
  };

  const originalWarn = console.warn;
  console.warn = (...args) => {
    if (args.some(arg => isExtensionError(arg))) return;
    originalWarn.apply(console, args);
  };

  window.addEventListener('unhandledrejection', (event) => {
    if (isExtensionError(event.reason)) {
      event.preventDefault();
      event.stopPropagation();
    }
  }, true);

  window.onerror = (msg, url, line, col, error) => {
    if (isExtensionError(msg) || isExtensionError(error)) return true;
    return false;
  };
}

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
    articleBody: "### 核心判断：大模型本地化落地的普惠账本与隐形成本\n\n近期关于企业私有化部署大模型的调研显示，绝大多数中等规模研发团队已转向具有极致性价比的开源基座架构（如 DeepSeek-V3/R1 架构）。然而，低采购价是否等同于低落地成本，正在成为全行业热议的分水岭性议题。这是一个由财务红利与技术路径变迁共同决定的行业阵痛期。\n\n#### 一、性能与能耗的非线性博弈\n评估私有化可行性时，企业往往陷入“算力即正义”的片面考量。以某核电设备研发中心的知识库升级为例，其采用私有化本地集群运行模型。尽管采购硬件一次性付清，但其配套的精密高密度制冷机房、全天候机架能耗、专用双路不间断电源等隐藏维护开销，在三年折旧期内折合年度成本，几乎是直接调用公有云极低 API 代价的 3.4 倍。这印证了私有部署中不可忽略的运行费效比黑洞。\n\n#### 二、安全红线之下的价值归置\n当然，私有化部署绝非一无是处。对于核心科技知识产权、高保密规格设计图纸以及战略决策会谈紀要等“极度敏感数据”，任何基于公有云的防泄漏防线都存在概率级漏洞陷阱。将生产力算法限制在物理网闸隔离的局域网内部服务器上，提供绝对物理安全级别的知识资产隔离，是大型央国企在当前大航海时代唯一的合规出路。\n\n#### 结论\n中小微创新团队建议坚守 API 廉价调用策略，敏捷迭代；核心涉密国资企业则需坦然承受维护溢价，坚定推进私有底座部署。"
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
    articleBody: "### 核心解析：重载飞行的工程阵痛与航天探索的狂欢叙事\n\n本周SpaceX星舰（Starship）迎来了举世瞩目的第六次轨道级试飞。尽管超重型助推器按照预设安全程序最终在墨西哥湾海域实施了“水上软着陆”，未能重现第五次试飞中令人屏息 of “发射塔筷子夹火箭”壮举，但这绝非研发倒退，而是SpaceX对系统临界状态进行的极限抗压施测。它暴露了高频重复发射在工程实践中的硬性短板，是对极尽理想主义的商业民营航天叙事的一记清醒警钟。\n\n#### 一、主动受控复燃与冗余度的非线性博弈\n从技术回放细节来看，助推器在降回高度约8公里时，控制中心临时取消了捕捉指令。主因由于测控遥感数据判定助推器的两台猛禽发动机在二次点火段发生了推力不对称的微小偏移。在保障极度复杂的发射塔台地基设施免受物理损毁，与强行回收试错之间，智力判断做出了完全理性的工程择决。这印证了我们的核心论点：多发动机并联方案具有极高的运载余裕，但也呈几何级数增加了阀门组件与管路协调的概率系统风险。单纯宣扬“大步快跑、以炸代修”的技术神格，恰恰是在掩盖制造业工程高不确定性本身的阵痛。\n\n#### 二、防热盾瓦的系统重构与临界突围\n更加引人瞩目的是上级飞船在重返大气层阶段的表现。此次飞船特意拆除了两侧部分高风险防热瓷砖，用新型极耐高温钢制板替代，并尝试在极端侧滑角下实施大攻角偏航。这为未来的快速重复使用收集到了极其难得的手动极限偏航操控模型。如果一艘号称要承载百吨级载荷的星际飞船依旧像传统宇航系统那样，在每次飞行后都需要高昂的工时去手工修补、检验防热覆膜，那么其所谓的“极低边际成本”终将沦为纸面逻辑的又一次游戏。我们必须紧盯的是，它能否在接下来的第七次星际飞行中，完成全钢外廊下无烧蚀重返——这才是星际运输港真正开闸的唯一衡量红线。"
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
    articleBody: "#### 引言：关税大棒下的贸易反思\n\n今年欧洲对华新能源汽车加征额外平均关税落地，标志着仅依靠传统物理出口的低溢价扩张模式宣告阶段性结束。然而，国内一些乐观叙事对此企图蔑视，认为通过第三国转运、中亚渠道即可消解摩擦。我们必须冷眼指出：这种战术机巧，正在掩盖我们在底层法律合规和本土化研发合作上的战略懒惰。\n\n#### 一、第三国重包装的合规红线漏洞\n依靠在北非或东南亚建立简易散件拼装（KD）工厂，试图通过“洗产地”避开原产地溯源，这是完全小看欧盟反规避调查部门的专业度。从电芯原产地到车机控制软件的编译所属权，当下的穿透性合规审计已经可以追溯至二级、三级零配件供应商极其源头。在欧盟数字电池护照（Digital Battery Passport）与相关法规层层盘查下，任何不具备真实本土采购、本地员工吸纳、本地产值比例小于40%的投机工厂，最终都将在2027年之前的过渡期遭遇更具毁灭性的二次定向清算。\n\n#### 二、以“产研出海”替代“产力外流”的重塑之路\n真正的出海是从单纯的产品出口，转变为本土化的研发深度融合。例如部分优秀厂商已经开始在匈牙利、德国建立全谱系工程研发中心，让国内的软硬件技术优势与西欧本地的供应链及汽车安全标准体系深度嵌套。不仅是转移过剩产能，更是通过本地税收贡献与高质量工程师工岗位的创设，把对抗升级为共同利益绑定。这是从“外来颠覆者”向“本地共建者”身份演进的华丽折返。"
  }
];

export default function App() {
  const [provider] = useState<string>('deepseek');
  const [apiKey, setApiKey] = useState<string>(localStorage.getItem('deepseek_key') || '');
  const [activeOperator, setActiveOperator] = useState<string>(() => {
    const saved = localStorage.getItem('commentary_radar_operator_id');
    if (saved && saved.trim() && saved.trim() !== 'guest') return saved.trim();
    
    // Generate a unique browser/device UID using browser attributes & entropy
    const userAgent = navigator.userAgent || '';
    let hash = 0;
    for (let i = 0; i < userAgent.length; i++) {
      const char = userAgent.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash | 0; // Convert to 32bit integer
    }
    const part1 = Math.abs(hash).toString(36);
    const part2 = Math.random().toString(36).substring(2, 8);
    const generatedUid = `uid_${part1}_${part2}`;
    
    // Persist this generated UID immediately so it remains constant for this device/browser
    localStorage.setItem('commentary_radar_operator_id', generatedUid);
    return generatedUid;
  });
  const [statusBar, setStatusBar] = useState<string>('就绪');
  const [rawItems, setRawItems] = useState<RawItem[]>([]);
  const [topicData, setTopicData] = useState<Topic[]>([]);
  const [statTotal, setStatTotal] = useState<string>('');
  const [clock, setClock] = useState<string>('');
  const audioCtxRef = useRef<AudioContext | null>(null);

  const [showAudioToast, setShowAudioToast] = useState(false);
  const [showToolbarSettings, setShowToolbarSettings] = useState(false);
  const [showAdminConsole, setShowAdminConsole] = useState(false);
  const [showAdminPasswordModal, setShowAdminPasswordModal] = useState(false);
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminPasswordError, setAdminPasswordError] = useState('');

  const logoTapCountRef = useRef(0);
  const logoTapTimeoutRef = useRef<any>(null);

  const [adminLogs, setAdminLogs] = useState<any[]>(() => {
    const saved = localStorage.getItem('commentary_radar_audit_logs');
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      } catch (e) {}
    }
    return INITIAL_MOCK_AUDIT_LOGS;
  });
  const [selectedLogCache, setSelectedLogCache] = useState<any | null>(null);
  const [adminSearchTerm, setAdminSearchTerm] = useState('');

  const playNotification = async () => {
    console.log('🔔 Notification triggered');
    setShowAudioToast(true);
    setTimeout(() => setShowAudioToast(false), 2000);
    try {
      if (!audioCtxRef.current) {
        const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
        if (AudioContextClass) {
          audioCtxRef.current = new AudioContextClass();
        }
      }
      
      const ctx = audioCtxRef.current;
      if (!ctx) return;
      
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      
      const playTone = (freq: number, start: number, duration: number, vol: number) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        // 使用 triangle 波形，比 sine 更容易听到但依然优雅
        osc.type = 'triangle';
        osc.frequency.setValueAtTime(freq, start);
        
        gain.gain.setValueAtTime(0, start);
        gain.gain.linearRampToValueAtTime(vol, start + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.001, start + duration);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start(start);
        osc.stop(start + duration);
      };

      const now = ctx.currentTime;
      // 稍微调大音量 (0.15)，并增加一个中频音阶让声音更厚实
      playTone(880, now, 0.6, 0.15); // A5
      playTone(1318.51, now + 0.1, 0.5, 0.12); // E6
      playTone(1760, now + 0.2, 0.4, 0.1); // A6
    } catch (e) {
      console.log('Audio play blocked or failed', e);
    }
  };
  
  const [factCheckUrls, setFactCheckUrls] = useState<string[]>(['', '']);
  
  // Free Write State
  const [freeTitle, setFreeTitle] = useState('');
  const [freeUrls, setFreeUrls] = useState<string[]>(['']);
  const [freeAngle, setFreeAngle] = useState('');
  const [freeStyle, setFreeStyle] = useState('fact_first');
  const [freePersona, setFreePersona] = useState('editor');
  const [freeWordcount, setFreeWordcount] = useState(1000);
  const [freePastedContent, setFreePastedContent] = useState('');
  const [freePastedContent2, setFreePastedContent2] = useState('');
  const [showExtraInputs, setShowExtraInputs] = useState(false);
  const [freeStep, setFreeStep] = useState(1);
  const [isAnalyzingFree, setIsAnalyzingFree] = useState(false);
  const [freeRecommendedAngles, setFreeRecommendedAngles] = useState<string[]>([]);
  const [freeSharedFacts, setFreeSharedFacts] = useState<string[]>([]);
  const [freeDiffFacts, setFreeDiffFacts] = useState<string[]>([]);

  // Dialog State
  const [showWriteDialog, setShowWriteDialog] = useState(false);
  const [currentIdx, setCurrentIdx] = useState<number | null>(null);
  const [selectedAngles, setSelectedAngles] = useState<number[]>([]);
  const [customAngleToggle, setCustomAngleToggle] = useState(false);
  const [customAngleInput, setCustomAngleInput] = useState('');
  const [diagStyle, setDiagStyle] = useState('fact_first');
  const [diagPersona, setDiagPersona] = useState('editor');
  const [diagWordcount, setDiagWordcount] = useState(1000);

  // Draft State
  const [showDraft, setShowDraft] = useState(false);
  const [draftTitle, setDraftTitle] = useState('');
  const [draftBody, setDraftBody] = useState('');
  const [draftTab, setDraftTab] = useState<'content' | 'sources'>('content');
  const [draftMetaInfo, setDraftMetaInfo] = useState('');
  const [wordCount, setWordCount] = useState(0);
  const [showFactcheck, setShowFactcheck] = useState(false);
  const [factcheckItems, setFactcheckItems] = useState<React.ReactNode[]>([]);
  const [factCheckReport, setFactCheckReport] = useState('');
  const [pendingCorrections, setPendingCorrections] = useState<Correction[]>([]);
  const [isFactcheckDisabled, setIsFactcheckDisabled] = useState(true);
  const [isFactchecking, setIsFactchecking] = useState(false);
  const [saveBtnText, setSaveBtnText] = useState('💾 保存到草稿箱');
  const [copyBtnText, setCopyBtnText] = useState('复制纯文本正文');
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [customModel, setCustomModel] = useState<string>(localStorage.getItem('deepseek_model') || 'deepseek-chat');
  const [deepThinking, setDeepThinking] = useState<boolean>(localStorage.getItem('deep_thinking') === 'true');

  const [currentSourceContent, setCurrentSourceContent] = useState('');
  const [currentSourceUrl, setCurrentSourceUrl] = useState('');
  const [currentSourceName, setCurrentSourceName] = useState('');
  const [draftReferences, setDraftReferences] = useState<{title: string, url: string, source: string, content?: string}[]>([]);
  const [selectedMaterial, setSelectedMaterial] = useState<{title: string, content: string} | null>(null);

  // RSS State
  const [rssFeeds, setRssFeeds] = useState<{ name: string, url: string }[]>(() => {
    const saved = localStorage.getItem('commentary_radar_rss_feeds_v4');
    return saved ? JSON.parse(saved) : [
      { name: '钛媒体', url: 'http://www.tmtpost.com/feed' },
      { name: '华尔街见闻', url: 'https://dedicated.wallstreetcn.com/rss.xml' },
      { name: '经济观察网', url: 'http://www.eeo.com.cn/rss.xml' }
    ];
  });
  const [rssItems, setRssItems] = useState<any[]>([]);
  const [financeLiveItems, setFinanceLiveItems] = useState<any[]>([]);
  const [showRssManager, setShowRssManager] = useState(false);
  const [rssUrlInput, setRssUrlInput] = useState('');
  const [rssNameInput, setRssNameInput] = useState('');
  const [isFetchingRss, setIsFetchingRss] = useState(false);
  const [isFetchingFinance, setIsFetchingFinance] = useState(false);
  const [isDiscovering, setIsDiscovering] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [activeTab, setActiveTab] = useState<'hotlist' | 'rss' | 'discovery'>('hotlist');
  const [writeMode, setWriteMode] = useState<'direct' | 'search'>('direct');
  const [discoveryItems, setDiscoveryItems] = useState<RawItem[]>([]);
  const [searchEngine, setSearchEngine] = useState<string>(localStorage.getItem('search_engine') || 'bing');

  // Drafts List State
  const [drafts, setDrafts] = useState<Draft[]>(() => {
    const saved = localStorage.getItem('commentary_radar_drafts');
    return saved ? JSON.parse(saved) : [];
  });
  const [showDraftsList, setShowDraftsList] = useState(false);

  useEffect(() => {
    const timer = setInterval(() => {
      setClock(new Date().toLocaleString('zh-CN', { hour12: false }));
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    localStorage.setItem('commentary_radar_drafts', JSON.stringify(drafts));
  }, [drafts]);

  useEffect(() => {
    localStorage.setItem('commentary_radar_rss_feeds_v4', JSON.stringify(rssFeeds));
  }, [rssFeeds]);

  // Auto-save current draft
  useEffect(() => {
    if (showDraft && draftBody) {
      const timer = setTimeout(() => {
        const currentDraft: Draft = {
          id: 'autosave',
          title: draftTitle || '未命名草稿',
          body: draftBody,
          metaInfo: draftMetaInfo,
          updatedAt: Date.now(),
          references: draftReferences,
          factCheckReport: factCheckReport,
          factCheckUrls: factCheckUrls,
          sourceContent: currentSourceContent,
          sourceUrl: currentSourceUrl,
          sourceName: currentSourceName
        };
        localStorage.setItem('commentary_radar_autosave', JSON.stringify(currentDraft));
      }, 2000);
      return () => clearTimeout(timer);
    }
  }, [draftBody, draftTitle, draftMetaInfo, showDraft, draftReferences, factCheckReport, factCheckUrls, currentSourceContent, currentSourceUrl, currentSourceName]);

  useEffect(() => {
    const savedAutosave = localStorage.getItem('commentary_radar_autosave');
    if (savedAutosave) {
      const draft = JSON.parse(savedAutosave);
      if (window.confirm(`发现上次未保存的草稿："${draft.title}"，是否恢复？`)) {
        loadDraft(draft);
      }
      localStorage.removeItem('commentary_radar_autosave');
    }
  }, []);

  const handleLogoTap = () => {
    const nextCount = logoTapCountRef.current + 1;
    logoTapCountRef.current = nextCount;
    
    if (logoTapTimeoutRef.current) {
      clearTimeout(logoTapTimeoutRef.current);
    }
    
    if (nextCount >= 5) {
      logoTapCountRef.current = 0;
      setAdminPasswordInput('');
      setAdminPasswordError('');
      setShowAdminPasswordModal(true);
      setStatusBar('就绪');
    } else {
      setStatusBar(`⚙️ [后台授权] 还需连续点击 ${5 - nextCount} 次...`);
      logoTapTimeoutRef.current = setTimeout(() => {
        logoTapCountRef.current = 0;
        setStatusBar('就绪');
      }, 2000);
    }
  };

  const handleAdminPasswordSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const pin = adminPasswordInput.trim();
    // Admin PIN read from build-time env var (Vite define), with fallback
    const validPin = (typeof process !== 'undefined' && (process as any).env?.ADMIN_PIN) || 'radar_admin_2026';
    if (pin === validPin) {
      setShowAdminPasswordModal(false);
      setAdminPasswordInput('');
      setAdminPasswordError('');
      fetchAdminLogs();
      setShowAdminConsole(true);
      setStatusBar('✓ 审计后台受权访问');
      setTimeout(() => setStatusBar('就绪'), 2000);
    } else {
      setAdminPasswordError('🚫 通行密码错误，拒绝进入');
    }
  };

  const fetchAdminLogs = async () => {
    // 1. 获取当前浏览器本地已存储的日志
    const saved = localStorage.getItem('commentary_radar_audit_logs');
    let localLogs: any[] = [];
    if (saved) {
      try {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed)) {
          localLogs = parsed;
        }
      } catch (e) {}
    }
    if (localLogs.length === 0) {
      localLogs = INITIAL_MOCK_AUDIT_LOGS;
    }

    try {
      // 2. 获取一次后端临时存储的最新日志
      const res = await fetch('/api/admin/logs');
      if (res.ok) {
        const json = await res.json();
        const serverLogs = (json.data && Array.isArray(json.data)) ? json.data : [];
        
        // 3. 按唯一安全 ID 去重并合并，防止 Vercel 冷启动或不同实例导致的历史丢失
        const logMap = new Map<string, any>();
        
        // 先放入后端返回的日志
        serverLogs.forEach((item: any) => {
          if (item && item.id) {
            logMap.set(item.id, item);
          }
        });
        
        // 再合并本地存储的日志（若有相同 ID，保留本地或最新的状态）
        localLogs.forEach((item: any) => {
          if (item && item.id) {
            logMap.set(item.id, item);
          }
        });
        
        const merged = Array.from(logMap.values());
        
        // 4. 按时间戳从新到旧（epoch DESC）重新排序
        merged.sort((a, b) => (b.epoch || 0) - (a.epoch || 0));
        
        // 限制最大缓存数量为 500 条防爆
        const finalLogs = merged.slice(0, 500);
        
        setAdminLogs(finalLogs);
        localStorage.setItem('commentary_radar_audit_logs', JSON.stringify(finalLogs));
        return;
      }
    } catch (err) {
      console.warn("Failed to fetch backend audit logs, using local state:", err);
    }

    // 5. 降级备用，如果请求失败直接呈现本地日志
    setAdminLogs(localLogs);
  };

  const logAdminBehavior = async (
    action: string, 
    title: string = '', 
    draftMeta: string = '', 
    refCount: number = 0, 
    wordCount: number = 0,
    articleBody: string = '',
    operator: string = activeOperator || 'unknown'
  ) => {
    // 统一并过滤非"生成文章"的操作
    let finalAction = action;
    if (action === '自由创作写作' || action === '自由写作') {
      finalAction = '自由写作';
    } else if (action === '开始排版写作' || action === '开始创作') {
      finalAction = '开始创作';
    } else {
      // 忽略此日志（不记录事实核查、AI选题分析、草稿保存等行为）
      return;
    }

    // If the operator is not the automated system-bot, use the configured activeOperator
    const finalOperator = (operator === 'system_cron_bot') ? 'system_cron_bot' : (activeOperator || 'guest');

    const logEntry = {
      id: Math.random().toString(36).substring(2, 11),
      timestamp: new Date().toISOString(),
      epoch: Date.now(),
      action: finalAction,
      title: title || '',
      draftMeta: draftMeta || '',
      referencesCount: refCount,
      wordCount: wordCount,
      operator: finalOperator,
      articleBody: articleBody || ''
    };

    setAdminLogs(prev => [logEntry, ...prev]);

    try {
      const saved = localStorage.getItem('commentary_radar_audit_logs');
      const parsed = saved ? JSON.parse(saved) : [];
      let combined = [logEntry, ...parsed];
      
      // Limit to 50 active article cached bodies to prevent LocalStorage bloat
      let bodyCounts = 0;
      combined = combined.map(item => {
        if (item.articleBody) {
          bodyCounts++;
          if (bodyCounts > 50) {
            return { ...item, articleBody: "" };
          }
        }
        return item;
      });

      localStorage.setItem('commentary_radar_audit_logs', JSON.stringify(combined.slice(0, 500)));
    } catch (e) {
      console.error("LocalStorage save failed", e);
    }

    try {
      await fetch('/api/admin/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(logEntry)
      });
    } catch (err) {
      console.error("Backend logging failed, saved to local fallback", err);
    }
  };

  const clearAdminLogs = async () => {
    if (window.confirm("确定要永久清空所有审计行为日志吗？该操作不可逆。")) {
      try {
        const res = await fetch('/api/admin/clear', { method: 'POST' });
        if (res.ok) {
          setAdminLogs([]);
          localStorage.removeItem('commentary_radar_audit_logs');
          setStatusBar('✓ 审计日志已清空');
          setTimeout(() => setStatusBar('就绪'), 2000);
        } else {
          throw new Error("Backend clear failed");
        }
      } catch (err) {
        setAdminLogs([]);
        localStorage.removeItem('commentary_radar_audit_logs');
        setStatusBar('✓ 本地审计日志已清空（后端同步失败）');
        setTimeout(() => setStatusBar('就绪'), 2000);
      }
    }
  };

  const exportAdminLogs = () => {
    try {
      const dataStr = JSON.stringify(adminLogs, null, 2);
      const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
      const exportFileDefaultName = `radar_audit_logs_${new Date().toISOString().split('T')[0]}.json`;
      const linkElement = document.createElement('a');
      linkElement.setAttribute('href', dataUri);
      linkElement.setAttribute('download', exportFileDefaultName);
      linkElement.click();
      setStatusBar('✓ 审计日志导出成功');
      setTimeout(() => setStatusBar('就绪'), 2000);
    } catch (e: any) {
      alert("导出失败：" + e.message);
    }
  };

  const getAuditStats = () => {
    const counts = { analysis: 0, writing: 0, factcheck: 0, drafts: 0 };
    const stances: Record<string, number> = {};
    const styles: Record<string, number> = {};
    
    adminLogs.forEach(log => {
      if (log.action === 'AI选题分析') counts.analysis++;
      else if (log.action === '开始排版写作' || log.action === '自由创作写作') counts.writing++;
      else if (log.action === '事实核查') counts.factcheck++;
      else if (log.action === '保存到草稿箱') counts.drafts++;

      if (log.draftMeta) {
        const stanceNames = [
          { key: 'editor', name: '主流情绪' },
          { key: 'balance', name: '平衡派' },
          { key: 'radical', name: '犀利批判' },
          { key: 'cause_effect', name: '逻辑因果' },
          { key: 'investor', name: '投资者' }
        ];
        stanceNames.forEach(st => {
          if (log.draftMeta.toLowerCase().includes(st.key) || log.draftMeta.includes(st.name)) {
            stances[st.name] = (stances[st.name] || 0) + 1;
          }
        });

        const styleNames = [
          { key: 'fact_first', name: '事实优先' },
          { key: 'oped', name: '理念主导' }
        ];
        styleNames.forEach(sty => {
          if (log.draftMeta.toLowerCase().includes(sty.key) || log.draftMeta.includes(sty.name)) {
            styles[sty.name] = (styles[sty.name] || 0) + 1;
          }
        });
      }
    });

    return { counts, stances, styles };
  };

  useEffect(() => {
    fetchHotlist();
    fetchGoogleNews();
    fetchAdminLogs();
  }, []);

  const handleDeepThinkingChange = (checked: boolean) => {
    setDeepThinking(checked);
    localStorage.setItem('deep_thinking', String(checked));
  };

  const handleKeyChange = (v: string) => {
    const trimmed = v.trim();
    setApiKey(trimmed);
    localStorage.setItem('deepseek_key', trimmed);
  };

  const handleOperatorChange = (v: string) => {
    const trimmed = v.trim();
    setActiveOperator(trimmed);
    localStorage.setItem('commentary_radar_operator_id', trimmed);
  };

  const handleModelChange = (v: string) => {
    setCustomModel(v);
    localStorage.setItem('deepseek_model', v);
  };

  const handleSearchEngineChange = (v: string) => {
    setSearchEngine(v);
    localStorage.setItem('search_engine', v);
  };

  const handleReset = () => {
    if (window.confirm('确定要重置所有 AI 配置（Key、模型）吗？')) {
      // Only clear AI config keys, not drafts/RSS/audit logs
      ['deepseek_key', 'deepseek_model', 'deep_thinking', 'search_engine'].forEach(k => localStorage.removeItem(k));
      window.location.reload();
    }
  };

  const saveToDrafts = () => {
    if (!draftBody) return;
    const newDraft: Draft = {
      id: Date.now().toString(),
      title: draftTitle || '未命名草稿',
      body: draftBody,
      metaInfo: draftMetaInfo,
      updatedAt: Date.now(),
      references: draftReferences,
      factCheckReport: factCheckReport,
      factCheckUrls: factCheckUrls,
      sourceContent: currentSourceContent,
      sourceUrl: currentSourceUrl,
      sourceName: currentSourceName
    };
    setDrafts(prev => [newDraft, ...prev]);
    playNotification();
    
    // Direct feedback on the button
    setSaveBtnText('✓ 已保存');
    setStatusBar('✓ 已保存到草稿箱');

    // Behavior audit logging
    logAdminBehavior('保存到草稿箱', newDraft.title, `字数: ${newDraft.body.length} | ${newDraft.metaInfo}`, newDraft.references?.length || 0, newDraft.body.length, newDraft.body, activeOperator);

    setTimeout(() => {
      setSaveBtnText('💾 保存到草稿箱');
      setStatusBar('就绪');
    }, 3000);
  };

  const loadDraft = (d: Draft) => {
    setDraftTitle(d.title);
    setDraftBody(d.body);
    setDraftMetaInfo(d.metaInfo);
    setDraftReferences(d.references || []);
    setFactCheckReport(d.factCheckReport || '');
    setFactCheckUrls(d.factCheckUrls || ['', '']);
    setCurrentSourceContent(d.sourceContent || '');
    setCurrentSourceUrl(d.sourceUrl || '');
    setCurrentSourceName(d.sourceName || '');
    
    if (d.factCheckReport) {
      const { items, corrections } = parseFactCheckReport(d.factCheckReport, d.references || [], d.sourceUrl || '', d.title, d.factCheckUrls || []);
      setFactcheckItems(items);
      setPendingCorrections(corrections);
      setShowFactcheck(true);
    } else {
      setFactcheckItems([]);
      setPendingCorrections([]);
      setShowFactcheck(false);
    }

    setShowDraft(true);
    setShowDraftsList(false);
    setIsFactcheckDisabled(false);
    setStatusBar('草稿已加载');
    setTimeout(() => setStatusBar('就绪'), 2000);
  };

  const deleteDraft = (id: string) => {
    setDrafts(prev => prev.filter(d => d.id !== id));
    setDeletingId(null);
    setStatusBar('✓ 草稿已删除');
    setTimeout(() => setStatusBar('就绪'), 2000);
  };

  const fetchRssItems = async () => {
    if (rssFeeds.length === 0) return;
    setIsFetchingRss(true);
    setStatusBar('正在抓取 RSS 订阅源...');
    try {
      const allItems: any[] = [];
      await Promise.all(rssFeeds.map(async (feed) => {
        try {
          const res = await fetch(`/api/rss?url=${encodeURIComponent(feed.url)}`);
          if (!res.ok) return;
          const json = await res.json();
          const items = (json.data?.items || []).map((item: any) => ({
            ...item,
            _sourceName: feed.name,
            _feedUrl: feed.url
          }));
          allItems.push(...items);
        } catch (err) {
          console.error(`Failed to fetch RSS: ${feed.name}`, err);
        }
      }));

      // Sort by date if available
      allItems.sort((a, b) => {
        const dateA = new Date(a.pubDate || a.isoDate || 0).getTime();
        const dateB = new Date(b.pubDate || b.isoDate || 0).getTime();
        return dateB - dateA;
      });

      setRssItems(allItems);
      setStatusBar(`RSS 抓取成功: ${allItems.length} 条新内容`);
      playNotification();
      setTimeout(() => setStatusBar('就绪'), 3000);
    } catch (err) {
      setStatusBar('RSS 抓取失败');
    } finally {
      setIsFetchingRss(false);
    }
  };

  const addRssFeed = () => {
    if (!rssUrlInput || !rssNameInput) return alert('请填写名称和 URL');
    if (rssFeeds.length >= 6) return alert('最多只能添加 6 个订阅源');
    if (rssFeeds.some(f => f.url === rssUrlInput)) return alert('该订阅源已存在');
    setRssFeeds([...rssFeeds, { name: rssNameInput, url: rssUrlInput }]);
    setRssUrlInput('');
    setRssNameInput('');
  };

  const removeRssFeed = (url: string) => {
    setRssFeeds(rssFeeds.filter(f => f.url !== url));
  };

  const fetchFinanceLive = async () => {
    setIsFetchingFinance(true);
    setStatusBar('正在抓取华尔街见闻 7x24 快讯...');
    try {
      const res = await fetch('/api/finance-live');
      if (!res.ok) throw new Error('Fetch failed');
      const json = await res.json();
      setFinanceLiveItems(json.data || []);
      setStatusBar(`财经快讯抓取成功: ${json.data?.length || 0} 条`);
      setTimeout(() => setStatusBar('就绪'), 3000);
    } catch (err) {
      setStatusBar('财经快讯抓取失败');
    } finally {
      setIsFetchingFinance(false);
    }
  };

  const fetchGoogleNews = async () => {
    setIsDiscovering(true);
    setStatusBar('正在抓取界面新闻精选 (商业 & 财经)...');
    try {
      const feeds = [
        { name: '界面·商业', url: 'https://plink.anyfeeder.com/jiemian/business' },
        { name: '界面·财经', url: 'https://plink.anyfeeder.com/jiemian/finance' },
        { name: '界面·天下', url: 'https://plink.anyfeeder.com/jiemian/news' }
      ];

      const allItems: RawItem[] = [];
      await Promise.all(feeds.map(async (feed) => {
        try {
          const res = await fetch(`/api/rss?url=${encodeURIComponent(feed.url)}`);
          if (!res.ok) return;
          const json = await res.json();
          const items = (json.data?.items || []).map((n: any) => ({
            ...n, // Spread everything to be safe
            title: n.title,
            url: n.link,
            _sourceName: feed.name,
            // Prioritize isoDate as it's the most standardized in rss-parser
            pubDate: n.isoDate || n.pubDate || n.date || n.published || n.updated || n.created
          }));
          allItems.push(...items);
        } catch (e) {
          console.error(`Fetch ${feed.name} failed:`, e);
        }
      }));

      // Sort by date (newest first)
      const sortedItems = allItems.sort((a, b) => {
        const dateA = new Date(a.pubDate || 0).getTime();
        const dateB = new Date(b.pubDate || 0).getTime();
        return (isNaN(dateB) ? 0 : dateB) - (isNaN(dateA) ? 0 : dateA);
      });

      setDiscoveryItems(sortedItems);
      setStatusBar(`精选资讯抓取成功: ${sortedItems.length} 条`);
      playNotification();
      setTimeout(() => setStatusBar('就绪'), 3000);
    } catch (e: any) {
      setStatusBar(`获取失败: ${e.message}`);
    } finally {
      setIsDiscovering(false);
    }
  };

  const formatDate = (dateValue: any) => {
    if (!dateValue) return '';
    try {
      let val = dateValue;
      if (typeof val === 'string' && /^\d+$/.test(val)) {
        val = parseInt(val, 10);
      }
      
      if (typeof val === 'number') {
        if (val < 10000000000) val *= 1000;
      }
      
      const d = new Date(val);
      if (isNaN(d.getTime())) {
        // Try fallback if Date constructor failed but it might be a weird format
        return '';
      }
      
      return d.toLocaleString('zh-CN', { 
        month: '2-digit', 
        day: '2-digit', 
        hour: '2-digit', 
        minute: '2-digit',
        hour12: false 
      }).replace(/\//g, '/');
    } catch (e) {
      return '';
    }
  };

  const fetchHotlist = async () => {
    setStatusBar('正在抓取全网热榜...');
    try {
      const SOURCES = [
        { key: 'toutiao', name: '今日头条' },
        { key: 'thePaper', name: '澎湃新闻' },
        { key: 'sina', name: '新浪新闻' },
        { key: '36Kr', name: '36氪' },
        { key: 'zhihuHot', name: '知乎热榜' },
        { key: 'netease', name: '网易新闻' },
        { key: 'tencent', name: '腾讯新闻' }
      ];
      
      const results = await Promise.all(SOURCES.map(async (s) => {
        try {
          const res = await fetch(`/api/hotlist?type=${s.key}`);
          if (!res.ok) return { data: [] };
          const data = await res.json();
          return data;
        } catch (err) {
          return { data: [] };
        }
      }));
      
      const allItems: RawItem[] = results.flatMap((r, i) => {
        const items = r.data || r.list || [];
        return items.map((item: any) => ({ 
          title: item.title || item.name || '', 
          url: item.url || item.link || '', 
          _sourceName: SOURCES[i].name 
        }));
      });
      
      const POLITICAL_KEYWORDS = ['习近平', '李强', '赵乐际', '王沪宁', '蔡奇', '丁薛祥', '李希', '韩正', '外交部', '国台办', '国防部'];
      const filteredItems = allItems.filter(item => !POLITICAL_KEYWORDS.some(kw => item.title.includes(kw)));

      setRawItems(filteredItems);
      setStatTotal(filteredItems.length + '条');
      setStatusBar('热榜抓取成功');
      playNotification();
      setTimeout(() => setStatusBar('就绪'), 2000);
    } catch (e: any) {
      setStatusBar(`抓取失败: ${e.message}`);
    }
  };

  const startAnalysis = async () => {
    const currentKey = apiKey;
    if (!currentKey) return alert('请在设置中配置 DeepSeek API Key');
    
    let sourceItems: RawItem[] = [];
    if (activeTab === 'hotlist') sourceItems = rawItems;
    else if (activeTab === 'rss') sourceItems = rssItems.map(it => ({ title: it.title, url: it.link, _sourceName: it._sourceName }));
    else if (activeTab === 'discovery') sourceItems = discoveryItems;

    if (sourceItems.length === 0) return alert('当前列表为空，请先执行抓取');

    setIsAnalyzing(true);
    setStatusBar('正在进行 AI 深度选题筛选...');
    try {
      // 减少处理条数到 50 条以提升速度
      const titles = sourceItems.slice(0, 50).map((it, i) => `${i + 1}. [${it._sourceName}] ${it.title}`).join('\n');
      const prompt = `你是一个资深媒体编辑，请从以下标题列表中筛选出 8-10 个最适合深度评论或分析的选题。
筛选原则：关注负面消息，以及有强烈冲突，容易引发大众讨论的话题。请注意信息源的多样性，尽量平衡各平台内容，减少"今日头条"的入选比例。
输出必须为严格的 JSON 格式。

待分析列表：
${titles}

输出格式：
{
  "selected": [
    {
      "index": 原始序号,
      "angles": ["具体视角1", "具体视角2", "具体视角3"]
    }
  ]
}`;

      // 使用 JSON mode (responseSchema: true) 并显式指定 DeepSeek
      const text = await callAI(apiKey, prompt, { 
        maxTokens: 2000, 
        responseSchema: true, 
        temperature: 0.3 
      });
      
      let analysis;
      try {
        // 清理可能包含的 <think> 标签及其内容 (适配 Deepseek 等模型)
        let processedText = text.replace(/<think>[\s\S]*?<\/think>/gi, '');
        // 清理 Markdown 标记
        const cleanedText = processedText.replace(/```json\n?|```/g, '').trim();
        const firstBrace = cleanedText.indexOf('{');
        const lastBrace = cleanedText.lastIndexOf('}');
        analysis = JSON.parse(cleanedText.substring(firstBrace, lastBrace + 1));
      } catch (e) {
        console.error("Parse Error:", text);
        throw new Error('AI 返回格式解析失败，请重试');
      }
      
      const selectedTopics: Topic[] = analysis.selected.map((s: any) => {
        const item = sourceItems[s.index - 1];
        if (!item) return null;
        return { title: item.title, angles: s.angles, url: item.url, sourceName: item._sourceName };
      }).filter((t): t is Topic => t !== null);

      setTopicData(selectedTopics);
      setStatusBar('选题筛选完成');
      logAdminBehavior('AI选题分析', `${sourceItems.length}个资讯源比对`, `筛选出品质选题 ${selectedTopics.length} 个`, 0, 0, '', 'system_cron_bot');
      setTimeout(() => setStatusBar('就绪'), 2000);
    } catch (e: any) {
      setStatusBar(`筛选失败: ${e.message}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const callAI = async (key: string, prompt: string, options: { maxTokens?: number, responseSchema?: any, providerOverride?: string, useSearch?: boolean, temperature?: number } = {}) => {
    const activeProvider = options.providerOverride || 'deepseek';
    const activeBaseUrl = localStorage.getItem(activeProvider + '_base_url') || '';
    const activeModel = options.providerOverride ? (localStorage.getItem(activeProvider + '_model') || '') : customModel;
    
    const maxRetries = 2;
    let lastError: any = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        if (activeProvider === 'gemini') {
          // If gemini is forced as an override, we MUST use the internal key if the provided key is from deepseek
          const finalKey = (options.providerOverride ? (process.env.GEMINI_API_KEY || key) : (key || process.env.GEMINI_API_KEY || '')).trim();
          if (!finalKey) throw new Error('Gemini API Key 缺失。');
          
          const ai = new GoogleGenAI({ apiKey: finalKey });
          
          try {
            const response = await ai.models.generateContent({
              model: activeModel || "gemini-3-flash-preview",
              contents: [{ role: 'user', parts: [{ text: prompt }] }],
              config: {
                responseMimeType: options.responseSchema ? "application/json" : "text/plain",
                temperature: typeof options.temperature === 'number' ? options.temperature : undefined,
                tools: options.useSearch ? [{ googleSearch: {} }] : undefined
              }
            });
            
            const text = response.text || '';
            if (!text) throw new Error('Gemini 返回了空响应。');
            return text;
          } catch (geminiErr: any) {
            console.error("Gemini SDK Error:", geminiErr);
            throw geminiErr;
          }
        } else {
          let res;
          try {
            const payload: any = { 
              model: activeModel || 'deepseek-chat', 
              max_tokens: options.maxTokens || 4000, 
              temperature: typeof options.temperature === 'number' ? options.temperature : 0.7,
              messages: [{ role: 'user', content: prompt }],
              ...(deepThinking ? { thinking: { type: 'enabled', budget_tokens: 1024 } } : {})
            };

            if (options.responseSchema) {
              payload.response_format = { type: 'json_object' };
            }

            res = await fetch('/api/proxy', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ 
                apiKey: key.trim(), 
                provider: 'deepseek', 
                baseUrl: activeBaseUrl,
                payload
              })
            });
          } catch (fetchErr) {
            // Fallback to direct fetch if proxy fails (might need CORS)
            if (!activeBaseUrl) {
              const payload: any = {
                model: activeModel || 'deepseek-chat',
                messages: [{ role: 'user', content: prompt }],
                max_tokens: options.maxTokens || 4000,
                ...(deepThinking ? { thinking: { type: 'enabled', budget_tokens: 1024 } } : {})
              };
              if (options.responseSchema) {
                payload.response_format = { type: 'json_object' };
              }

              res = await fetch('https://api.deepseek.com/v1/chat/completions', {
                method: 'POST',
                headers: { 
                  'Content-Type': 'application/json',
                  'Authorization': `Bearer ${key.trim()}`
                },
                body: JSON.stringify(payload)
              });
            } else {
              throw fetchErr;
            }
          }
          const data = await res.json();
          if (!res.ok) {
            const details = data.error?.message || data.message || JSON.stringify(data);
            throw new Error(`DeepSeek 接口返回错误: ${details}`);
          }
          return data.choices?.[0]?.message?.content || '';
        }
      } catch (e: any) {
        lastError = e;
        if (attempt < maxRetries) {
          await new Promise(resolve => setTimeout(resolve, 2000 * (attempt + 1)));
          continue;
        }
        throw e;
      }
    }
    throw lastError;
  };

  const executeWorkflow = async (title: string, angle: string, style: string, persona: string, wordcount: number, url: string, sourceName: string, preExtractedFacts?: string[], preConfiguredRefs?: { title: string, url: string, source: string, content?: string }[]) => {
    const currentKey = apiKey;
    const currentResearchKey = apiKey;
    
    setDraftReferences(preConfiguredRefs || []);
    setShowDraft(true);
    setDraftTitle(title);
    setDraftBody('');
    setShowFactcheck(false);
    setFactCheckReport('');
    setIsFactcheckDisabled(true);
    setPendingCorrections([]);
    setCurrentSourceContent('');
    setCurrentSourceUrl(url || '');
    setCurrentSourceName(sourceName || '');

    const styleMap: any = { fact_first: '事实优先', pipeline: '模式化解读', oped: '理念主导' };
    const personaMap: any = { editor: '主流情绪 (公约数视角)', balance: '平衡派 (有褒有贬)', radical: '犀利批判 (批判既得利益)' };
    const modelName = customModel || (provider === 'gemini' ? 'gemini-3-flash-preview' : 'deepseek-chat');
    setDraftMetaInfo(`[ 模型: ${modelName} | 搜索: ${searchEngine.toUpperCase()} | 模式: ${styleMap[style] || style} | 立场: ${personaMap[persona] || persona} ]`);

    const hasUrl = !!(url && url.startsWith('http'));
    const isSearchSource = sourceName === '今日头条' || sourceName === '新浪新闻';
    let sourceContent = '';
    
    // If we have pre-extracted facts, we skip Phase 1 research
    if (preExtractedFacts && preExtractedFacts.length > 0) {
      sourceContent = `【预分析核心事实清单】：\n${preExtractedFacts.join('\n')}`;
      setCurrentSourceContent(sourceContent);
      setCurrentSourceUrl(url || '');
      // If we have preConfiguredRefs, they are already set in setDraftReferences above
      setDraftBody(`PHASE 1: 已加载预分析核心事实（共 ${preExtractedFacts.length} 条）...\n\n正在进入深度排版创作阶段...`);
      // Tiny delay for UX
      await new Promise(r => setTimeout(r, 600));
    } else {
      // Initialize with provided URL if it exists (only if not already set by preConfiguredRefs)
      if (url && url.startsWith('http') && (!preConfiguredRefs || preConfiguredRefs.length === 0)) {
        setDraftReferences([{ title: title, url: url, source: sourceName || '原始信源' }]);
      }

      // Attempt direct extraction first for non-search sources
      if (!isSearchSource && hasUrl) {
      setDraftBody(`PHASE 1: 识别到权威信源 [${sourceName || '外部链接'}]，正在直接提取事实...\n链接: ${url}`);
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 15000); // 15s timeout
        const jinaRes = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (jinaRes.ok) {
          const text = await jinaRes.text();
          if (text === "SCRAPE_BLOCKED_BY_WAF") {
            console.warn("发现抓取拦截，建议用户在自由创作区粘贴原文内容");
            return;
          }
          if (text && text.length > 200) { // Ensure we actually got content
            sourceContent = text.substring(0, 5000);
            setCurrentSourceContent(sourceContent);
            setCurrentSourceUrl(url);
            setDraftBody(`PHASE 1: [${sourceName || '原文'}] 提取成功，正在聚合核心事实...`);
          } else {
            console.warn("直接抓取内容过短，将尝试搜索补充");
          }
        } else {
          console.warn(`直接抓取失败 (Status: ${jinaRes.status})，将尝试搜索补充`);
        }
      } catch (e) {
        console.warn("直接抓取异常，将尝试搜索补充", e);
      }
    }

    // If search is needed (Toutiao/Sina/No URL) OR direct extraction failed
    if (!sourceContent) {
      const searchLabel = searchEngine === 'google' ? 'Google Search' : (searchEngine === 'bing' ? 'Bing/Web Search' : '新浪新闻搜索');
      const searchReason = isSearchSource ? `[${sourceName}] 需要多维信源交叉验证` : (hasUrl ? "原文提取未果" : "未提供链接");
      
      setDraftBody(`PHASE 1: ${searchReason}，正在通过 ${searchLabel} 获取事实...\n关键词: ${title}`);

      try {
        let searchResults: { title: string, url: string, source: string }[] = [];

        if (searchEngine === 'google') {
        // Use Gemini's native Google Search
        const searchPrompt = `请在互联网上搜索关于"${title}"的最新、最权威的新闻报道。
        请列出前 3-5 个最相关的结果，包括标题、URL 和来源名称。
        请严格按以下 JSON 格式输出：
        {
          "results": [
            { "title": "标题", "url": "URL", "source": "来源名称" }
          ]
        }`;
        
        const responseSchema = {
          type: Type.OBJECT,
          properties: {
            results: {
              type: Type.ARRAY,
              items: {
                type: Type.OBJECT,
                properties: {
                  title: { type: Type.STRING },
                  url: { type: Type.STRING },
                  source: { type: Type.STRING }
                },
                required: ["title", "url", "source"]
              }
            }
          },
          required: ["results"]
        };

        const text = await callAI(currentResearchKey, searchPrompt, { 
          maxTokens: 1000, 
          providerOverride: 'gemini', // Force gemini for search grounding
          useSearch: true,
          responseSchema
        });

        try {
          const firstBrace = text.indexOf('{');
          const lastBrace = text.lastIndexOf('}');
          const data = JSON.parse(text.substring(firstBrace, lastBrace + 1));
          searchResults = data.results || [];
        } catch (e) {
          console.error("Google Search JSON parse failed", e);
        }
      } else if (searchEngine === 'bing') {
        // Use Jina Search (s.jina.ai) as a high-quality web search
        const jinaSearchUrl = `https://s.jina.ai/${encodeURIComponent(title)}`;
        const res = await fetch(jinaSearchUrl);
        if (res.ok) {
          const md = await res.text();
          const extractPrompt = `从以下 Web 搜索结果中提取前 3-5 个最相关的新闻文章。
          请严格按以下格式输出，每行一个：
          标题 | URL | 来源
          
          搜索结果：
          ${md.substring(0, 5000)}`;
          
          const text = await callAI(currentResearchKey, extractPrompt, { maxTokens: 800 });
          searchResults = text.split('\n')
            .filter(l => l.includes('|'))
            .map(l => {
              const [t, u, s] = l.split('|').map(str => str.trim());
              return { title: t, url: u, source: s || 'Web' };
            })
            .filter(r => r.url && r.url.startsWith('http'));
        }
      } else {
        // Original Sina Search
        const searchUrl = `https://search.sina.com.cn/search?q=${encodeURIComponent(title)}&tp=news`;
        const searchRes = await fetch('https://r.jina.ai/' + searchUrl);
        if (searchRes.ok) {
          const searchMd = await searchRes.text();
          const extractPrompt = `从以下新浪新闻搜索结果中提取前 3-5 个最相关的新闻文章。
          请严格按以下格式输出，每行一个：
          标题 | URL
          
          搜索结果：
          ${searchMd.substring(0, 4000)}`;
          
          const resultsText = await callAI(currentResearchKey, extractPrompt, { maxTokens: 500 });
          searchResults = resultsText.split('\n')
            .filter(l => l.includes('|'))
            .map(l => {
              const [t, u] = l.split('|').map(s => s.trim());
              return { title: t, url: u, source: '新浪新闻' };
            })
            .filter(r => r.url && r.url.startsWith('http'));
        }
      }

      if (searchResults.length > 0) {
        setDraftReferences(searchResults.map(r => ({ title: r.title, url: r.url, source: r.source })));
        const displayList = searchResults.map((r, i) => `${i+1}. 【${r.source}】${r.title}\n   🔗 ${r.url}`).join('\n\n');
        setDraftBody(`PHASE 1: 已通过 ${searchLabel} 找到以下权威信源：\n\n${displayList}\n\n正在聚合核心事实...`);
        
        // Fetch content from top results
        const topUrls = searchResults.slice(0, 2).map(r => r.url);
        const contents = await Promise.all(topUrls.map(async (u) => {
          try {
            const r = await fetch(`/api/scrape?url=${encodeURIComponent(u)}`);
            if (!r.ok) return '';
            const text = await r.text();
            if (text === "SCRAPE_BLOCKED_BY_WAF") return '';
            // Process text into numbered paragraphs for better AI citation
            return text.split('\n')
              .map(p => p.trim())
              .filter(p => p.length > 20)
              .map((p, idx) => `[段落${idx + 1}] ${p}`)
              .join('\n');
          } catch { return ''; }
        }));
        sourceContent = contents.filter(c => c).map((c, i) => `【参考信源 ${i+1}】：\n${c.substring(0, 3000)}`).join('\n\n');
        setCurrentSourceContent(sourceContent);
        if (searchResults[0]?.url) setCurrentSourceUrl(searchResults[0].url);
      }
    } catch (e) {
      console.warn("深度搜索过程中出现异常", e);
    }
  }
}

    // Final fallback: if everything failed but we have a URL, try one last direct fetch
    if (!sourceContent && hasUrl) {
      setDraftBody(`PHASE 1: 深度搜索未果，尝试最后一次直接读取原始网页...`);
      try {
        const jinaRes = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
        if (jinaRes.ok) {
          const text = await jinaRes.text();
          if (text === "SCRAPE_BLOCKED_BY_WAF") {
             setDraftBody(`PHASE 1: 该链接 (微信等) 已开启强力反爬。建议您进入"自由创作"模式，手动粘贴正文内容。`);
             return;
          }
          sourceContent = text.split('\n')
            .map(p => p.trim())
            .filter(p => p.length > 20)
            .map((p, idx) => `[段落${idx + 1}] ${p}`)
            .join('\n')
            .substring(0, 5000);
          setCurrentSourceContent(sourceContent);
        }
      } catch (e) { console.warn("最终抓取失败", e); }
    }

    try {
      const now = new Date();
      const timeStr = now.getFullYear() + "年" + (now.getMonth() + 1) + "月" + now.getDate() + "日";
      
      let research = '';
      if (preExtractedFacts && preExtractedFacts.length > 0) {
        research = sourceContent;
      } else {
        let researchPrompt = `你是一位严谨的深度调查记者。
【深度核查规则】：请仅基于我下方提供的【原始参考素材】来提取事实。如果素材中没有提及特定的数据、引言或微观细节，请**直接忽略或寻找相关逻辑替代**，绝对禁止在提取结果中输出"资料未提及"等无关废话。
【强制溯源要求】：在提取数据、时间、引言或核心事实时，请务必在句末标注其来源及对应的段落号（例如：[来源1：段落3]）。
【时空坐标校准】：当前真实时间是 ${timeStr}。请记住现在是 2026 年，2025 年的所有活动均已结束。
针对选题【${title}】和视角【${angle}】，请基于以下提供的【原始参考素材】提取最鲜活的新闻细节。`;
        researchPrompt += `\n【重要时间指引】：如果素材中出现"X月X日"而未标注年份，请默认其为 2026 年。如果素材描述的是 2025 年的事件，请明确将其视为"去年"或"已完成"的事件。`;
        researchPrompt += `\n【原始参考素材】：\n${sourceContent || '无外部素材，请依赖内部数据库'}\n\n【输出要求】：严禁主观评价，只列客观事实（带溯源标签），字数600字内。`;
        
        research = await callAI(currentResearchKey, researchPrompt, { 
          maxTokens: 1500,
          useSearch: !sourceContent,
          temperature: 0.1
        });
      }
      setDraftBody(`PHASE 2: 事实素材处理完毕。已确定核心事实框架。\n\n正在进行深度排版创作...`);
      
      const personasDesc: any = {
        editor: "主流情绪观察员 (以主流媒体的视角，站在主流民意的立场，以同情、包容的态度分析，以公平、公开、正义为目标)",
        balance: "平衡派 (既解释相关方的行为合理之处，也对某些错漏做出针对性强的批判或建议)",
        radical: "犀利批判 (以独特而异于常人的角度，分析事情的荒诞和冲突，给出一针见血的批判，打破既得利益结构)",
        cause_effect: `前因后果式解读 (陈述事件，交代背景，点出事件的"荒诞感"或"冲突点"。解释事件为什么会发生，从法律、经济或社会心理角度寻找底层逻辑。横向比较或纵向溯源，给出让读者"长知识"的增量信息。留一个让人回味的念想，引发点赞或转发。)`,
        investor: "投资者视角 (以投资者为目标读者，讲述新闻背后的经济、商业逻辑，以及新闻对宏观经济、特定行业或相关公司的影响，收益和风险兼顾。)"
      };
      
      let prompt = `你是【${personasDesc[persona]}】。你的文字应当像手术刀一样精准，具备深厚的政经素养。
【时空坐标校准】：当前真实时间是 ${timeStr}。请记住现在是 2026 年，2025 年的所有活动均已结束。

基于以下【深度素材】写一篇约${wordcount}字文章。
【重要时间指引】：请确保文章中的时间逻辑严密。当前是 2026 年，请勿将 2026 年的事件误写为 2024 或 2025 年。如果素材提到 2025 年，请以"回顾"或"去年"的口吻描述。
【深度素材】：
${research}

【选题】：${title}
【核心灵魂视角】：${angle}
【禁令】：严禁在文中出现如 [视角1]、[视角2] 或 [角度X] 等形式的引导标签或标注。请将视角自然融入论述中。

【创作要求】：
1. **基于事实，逻辑延伸**：你的主要论据必须来自提供的【深度素材】。如果素材中缺失某些具体细节，请通过严密的【逻辑分析】和【政经常识】进行合理延伸，建立完整的论点链路。**严禁在文章中出现"素材未提及"、"资料未查到"等破坏阅读体验的描述**。
2. **强制溯源要求**：在你的文章中，每当引用具体的数据、时间或关键引言时，请务必保留素材中的【溯源标签】（如 [链接1]、[补充素材1] 或 [来源1]），将其自然、隐形地融入句末。不要修改这些标签的名称，如果是素材中提供的 [链接1] 请原样保留。
3. **深度逻辑**：拒绝表象堆砌，重点分析【相关方的动公】、素材中蕴含的【经济规律】或【政治逻辑】。你需要比读者看深三步。
4. **专业文采**：保持文字的克制与力量。开篇扎实，分析透彻，结尾具有方向性的指引。

【创作流程与格式要求】：
第一步：请先输出以下分析工序（作为文章的前置思考）：
1. 【文章核心论点，80字以内】：（直接陈述核心论点，限一句话）
2. 【文章反驳的常见误解】：（指出并反驳一个关于此话题的常见误区，限一句话）
3. 【文章提出的具体建议或判断】：（给出具体的行动建议或定性判断，限一句话）

第二步：生成 3 个备选标题。
你现在扮演一位主流媒体的资深标题编辑。你的信条是：标题不是文章内容的概括，而是文章最核心判断的直接陈述。
标题写作规律：
1. 句子是完整的判断句，有主语+谓语+宾语
2. 常用"是……而非……""或是……的关键""应该是……"等 显示立场的连接词
3. 可以引用政策原话或民间词汇加引号，制造熟悉感中的陌生感
4. 长度18-24字为佳，允许口语化
格式：【备选标题一】... 【备选标题二】... 【备选标题三】...

第三步：开始正文创作。
- 严格控制正文字数在 ${wordcount} 字左右（不含前置分析和标题），误差范围控制在 ±10% 以内。
- 严禁使用 Markdown 加粗符号（**）。
- 禁止使用"让人痛心"、"我们要..."等公文套话。
- 保持【${personasDesc[persona]}】的文风。`;

      if (style === 'fact_first') {
        prompt += "\n\n第四步：正文模式要求（新闻实录）：请将 60% 的篇幅用于复述素材中的事实细节，分析应中肯而犀利，不说废话和空洞的理论术语。";
      } else if (style === 'oped') {
        prompt += "\n\n第四步：正文模式要求（专业解读）：解释事件为什么会发生，会如何发展，有哪些后果。使用通俗易懂的经济学、传播学、社会学等理论，流体思维自然展开。";
      }

      const raw = await callAI(currentKey, prompt, { maxTokens: 4000, temperature: 0.6 });
      const cleaned = raw.replace(/\*\*/g, '');
      // Wrap citations and system notes for UI display with user-select: none
      const wrapped = cleaned.replace(/(\[来源[^\]]+\]|\[共同事实\]|\[素材未提及\]|\[资料未提及\]|\[差异\/独特\]|\[核查\s*\d+\]|\[视角[^\]]+\])/g, '<span class="citation-tag">$1</span>');
      
      setDraftBody(wrapped);
      setWordCount(cleaned.length);
      setIsFactcheckDisabled(false);
      setStatusBar('稿件创作完成！');
      playNotification();

      // Audit behavior logging with generated article cache
      try {
        const styleMap: any = { fact_first: '事实优先', pipeline: '模式化解读', oped: '理念主导' };
        const personaMap: any = { editor: '主流情绪', balance: '平衡派', radical: '犀利批判' };
        const modelName = customModel || 'deepseek-chat';
        const metaStr = `[ 模型: ${modelName} | 模式: ${styleMap[style] || style} | 立场: ${personaMap[persona] || persona} ]`;
        const actionLabel = (preExtractedFacts && preExtractedFacts.length > 0) ? '自由写作' : '开始创作';
        logAdminBehavior(actionLabel, title, metaStr, draftReferences.length, cleaned.length, cleaned, activeOperator);
      } catch (errLog) {
        console.error("Failed to write success audit log", errLog);
      }

      setTimeout(() => setStatusBar('就绪'), 3000);
    } catch (e: any) {
      let msg = e.message;
      if (msg.includes('insufficient balance') || msg.includes('recharge') || msg.includes('quota')) {
        msg = "AI 账户余额不足或已达限额，请检查 API Key 状态或更换模型。";
      }
      setDraftBody(`生成失败: ${msg}`);
    }
  };

  const startFactcheck = async () => {
    setDraftTab('sources');
    const currentKey = apiKey || (provider === 'gemini' ? process.env.GEMINI_API_KEY : '');
    if (!currentKey && provider !== 'gemini') return alert('请填入 API Key');
    
    setIsFactchecking(true);
    setShowFactcheck(true);
    setPendingCorrections([]);
    setFactcheckItems([
      <div key="loading" className="flex flex-col gap-2">
        <div className="flex items-center gap-2 text-gold font-mono animate-pulse">
          <span className="w-2 h-2 bg-gold rounded-full"></span>
          正在提取文中关键事实与数据...
        </div>
        <div className="text-[0.7rem] text-muted">基于原文素材与关联检索进行双重比对，这可能需要 10-20 秒</div>
      </div>
    ]);
    
    try {
      const now = new Date();
      const fullDateStr = now.toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      const timeStr = now.getFullYear() + "年" + (now.getMonth() + 1) + "月";
      
      // Fetch content from specified URLs
      let extraSourceContent = '';
      const validUrls = factCheckUrls.filter(u => u && u.startsWith('http'));
      let scrapeCount = 0;

      if (validUrls.length > 0) {
        setStatusBar('正在提取外部核查信源...');
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
        extraSourceContent = contents.filter(c => c).map((c, i) => `【用户指定核查信源 ${i+1} 内容（最高优先级）】：\n${c.substring(0, 4000)}`).join('\n\n');
        
        if (scrapeCount > 0) {
          setFactcheckItems(prev => [
            ...prev,
            <div key="scrape-success" className="text-[0.65rem] text-green-600 font-bold bg-green-50 p-2 rounded border border-green-200 mt-2 border-l-4">
              ✅ 成功读取 {scrapeCount} 个核查信源，已设为最高优先级进行比对。
            </div>
          ]);
        } else if (validUrls.length > 0) {
          setFactcheckItems(prev => [
            ...prev,
            <div key="scrape-fail" className="text-[0.65rem] text-red-600 font-bold bg-red-50 p-2 rounded border border-red-200 mt-2 border-l-4">
              ❌ 指定信源抓取失败 (超时或被拦截)，将仅依赖系统素材比对。
            </div>
          ]);
        }
      }

      const sourceContext = (currentSourceContent || extraSourceContent) 
        ? `【多维参考信源清单】：\n${draftReferences.map((r, i) => `[来源${i+1}]：标题《${r.title}》, 链接: ${r.url}`).join('\n')}\n\n【原始新闻参考素材】：\n${currentSourceContent}\n\n【用户手动提供的"指定核查信源"（这是本次核查的最权威依据，若与正文冲突请务必指出）】：\n${extraSourceContent || '无'}\n\n` 
        : '【注意】：未提供原始素材，请完全依赖你的内部知识库，并对不确定的事实标注搜索建议。';

    const today = new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' });

    const prompt = `你是一位职业事实核查员（Fact-Checker）。
【重要基准时间】：${today}（注：请以此作为评估文章时效性的唯一基准，当前已是2026年）

【核查任务】：
请根据下方提供的【用户手动提供的"指定核查信源"】和【原始新闻参考素材】，对《待核查文章》进行深度审计。
**特别注意：如果【用户手动提供的"指定核查信源"】中包含的信息与《待核查文章》不符，请视其为严重事实错误（ERROR）。**

【核查基准】：
${sourceContext}

【输出格式】（严格按行输出，使用|分割，确保每行4个或5个字段）：
ERROR|草稿中的严重事实错误|正确事实表述 (精准修正)|错误原因 (简要)|验证此事实的权威URL、[来源N] 或 [核查信源N]
WARNING|表述偏颇/修辞不当/细节缺失|改进建议 (如何表述更客观或更充实)|建议原因 (如：存在立场偏差/数据支持不足)|验证参考URL、[来源N] 或 [核查信源N]
OK|草稿中的正确表述|验证此事实的权威URL、[来源N] 或 [核查信源N]

【溯源标签使用规范】：
- 如果核实依据来自"指定核查信源"，请务必使用 [核查信源1]、[核查信源2] 等标签。
- 如果核实依据来自"原始参考素材"，请使用 [来源1]、[来源2] 等标签。
- 如果是你的内部知识库验证，请提供具体的权威URL。

【限制】：
- "ERROR" 仅用于数据、时间、人物、逻辑关系的硬伤。
- "WARNING" 用于主观偏见、情绪化用词、事实厚度不足等建议。
- 不要输出任何开场白或总结。

待核查文章：
${draftBody}`;
      
      const report = await callAI(currentKey, prompt, { maxTokens: 3000, useSearch: false, temperature: 0.1 });
      setFactCheckReport(report);
      
      const { items, corrections } = parseFactCheckReport(report, draftReferences, currentSourceUrl, draftTitle, factCheckUrls);
      
      setFactcheckItems(prev => {
        const logs = prev.filter(item => {
          const key = (item as any)?.key;
          return key === 'scrape-success' || key === 'scrape-fail';
        });
        return [...logs, ...items];
      });
      setPendingCorrections(corrections);
      setIsFactchecking(false);
      setStatusBar('事实核查完成');
      playNotification();
      logAdminBehavior('事实核查', draftTitle, `使用核查信源数: ${validUrls.length}个`, validUrls.length, draftBody.length, draftBody, activeOperator);
      setTimeout(() => setStatusBar('就绪'), 3000);
    } catch (e: any) {
      setFactcheckItems([<div key="error" className="text-accent font-mono">核查中断: {e.message}</div>]);
      setIsFactchecking(false);
      setStatusBar('核查失败');
    }
  };

  const parseFactCheckReport = (report: string, refs: any[], sUrl: string, sTitle: string, userFactUrls: string[] = []) => {
    const lines = report.split('\n').filter(l => l.trim() && (l.includes('|')));
    
    if (lines.length === 0) {
      return {
        items: [<div key="error" className="text-muted italic">AI 未发现明显的硬性事实错误，或未能按规范生成报告。建议手动核对关键数据。</div>],
        corrections: [] as Correction[]
      };
    }

    const items: React.ReactNode[] = [];
    const corrections: Correction[] = [];

    lines.forEach((line, index) => {
      const p = line.split('|');
      if (p.length < 2) return;

      const isError = line.startsWith('ERROR');
      const isWarning = line.startsWith('WARNING');
      const isOk = line.startsWith('OK|');
      
      const rawUrlOrTag = (isError || isWarning) ? p[4] : p[2];
      const hasSpecificUrl = rawUrlOrTag && rawUrlOrTag.startsWith('http');
      let primaryLink = '';
      let linkLabel = '';

      if (hasSpecificUrl) {
        primaryLink = rawUrlOrTag;
        linkLabel = '🔗 外部验证信源';
      } else if (rawUrlOrTag && rawUrlOrTag.includes('[核查信源')) {
        const match = rawUrlOrTag.match(/\[核查信源\s*(\d+)\]/);
        const sourceIdx = match ? parseInt(match[1]) - 1 : 0;
        primaryLink = userFactUrls[sourceIdx] || (sUrl || '');
        linkLabel = '🔗 指定核查信源对照';
      } else if (rawUrlOrTag && rawUrlOrTag.includes('[来源')) {
        const match = rawUrlOrTag.match(/\[来源(\d+)\]/);
        const sourceIdx = match ? parseInt(match[1]) - 1 : 0;
        const ref = refs[sourceIdx];
        primaryLink = ref ? ref.url : (sUrl || '');
        linkLabel = ref ? `🔗 [${ref.source}] 原始对照` : '🔗 原始素材对照';
      } else {
        primaryLink = sUrl || (refs[0]?.url || `https://search.sina.com.cn/search?q=${encodeURIComponent(sTitle)}&tp=news`);
        linkLabel = '🔗 原始素材对照';
      }
      
      if (isError || isWarning) {
        const severityTag = isError ? 'ERR' : 'WARN';
        const severityClass = isError ? 'bg-accent' : 'bg-blue text-white';
        
        corrections.push({ original: p[1], corrected: p[2], sourceLink: primaryLink, id: index });
        
        items.push(
          <div className="fact-item group" key={index}>
            <div className="flex items-start gap-2 mb-2">
              <span className={`${severityClass} text-[0.6rem] px-1.5 py-0.5 font-bold mt-1`}>{severityTag}</span>
              <div className="flex-1">
                <div className="fact-original">原文: {p[1]}</div>
                <div className="fact-corrected text-blue">{isWarning ? '建议: ' : '修正: '}{p[2]}</div>
                <div className="text-[0.7rem] text-muted mt-1 italic">{isWarning ? '理由: ' : '原因: '}{p[3]}</div>
              </div>
            </div>
            <div className="flex gap-2 ml-8">
              <a className="fact-link" href={primaryLink} target="_blank" rel="noreferrer">{linkLabel}</a>
              {!hasSpecificUrl && (
                <a className="fact-link bg-muted/10 text-muted" href={`https://search.sina.com.cn/search?q=${encodeURIComponent(p[1])}&tp=news`} target="_blank" rel="noreferrer">🌐 联机检索</a>
              )}
            </div>
          </div>
        );
      } else if (isOk) {
        items.push(
          <div className="fact-ok flex items-center gap-2" key={index}>
            <span className="text-green">●</span>
            <span className="flex-1">核实一致：{p[1]}</span>
            <a className="text-[0.65rem] text-blue hover:underline" href={primaryLink} target="_blank" rel="noreferrer">
              {hasSpecificUrl ? '查看外部溯源' : '溯源'}
            </a>
          </div>
        );
      }
    });

    return { items, corrections };
  };

  const copyDraft = () => {
    // 1. Strip internal HTML tags added for fact-checking/citation wrapping
    let cleanText = draftBody.replace(/<[^>]*>/g, '');
    // 2. Strip Square bracket citations and system notes
    cleanText = cleanText.replace(/\[[^\]]*?(?:链接\d+|补充素材\d+|来源|共同事实|素材未提及|资料未提及|差异\/独特|核查|视角|推论|分析|研判|点评|思考|总结)[^\]]*?\]/g, '');
    // 3. Trim whitespace
    cleanText = cleanText.trim();

    navigator.clipboard.writeText(cleanText);
    
    // Provide visual feedback
    setCopyBtnText('✓ 已复制');
    playNotification();
    setStatusBar('✓ 正文已复制到剪贴板');
    setTimeout(() => {
      setCopyBtnText('复制纯文本正文');
      setStatusBar('就绪');
    }, 2000);
  };

  const renderDraftBody = (text: string) => {
    // 1. Line breaks
    let html = text.replace(/\n/g, '<br>');
    // 2. Special handling for source tags and other citations
    // We style [链接X], [补充素材X], [来源X], [核查X], [推论], [研判] etc.
    const citationRegex = /\[([^\]]*?(?:链接\d+|补充素材\d+|来源|共同事实|素材未提及|资料未提及|差异\/独特|核查|视角|推论|分析|研判|点评|思考|总结)[^\]]*?)\]/g;
    html = html.replace(citationRegex, '<span class="source-inline-tag" title="溯源核查标签">[$1]</span>');
    return { __html: html };
  };

  const groupedRawItems = rawItems.reduce((acc: any, item) => {
    if (!acc[item._sourceName]) acc[item._sourceName] = [];
    acc[item._sourceName].push(item);
    return acc;
  }, {});

  const openWriteDialog = (idx: number) => {
    setCurrentIdx(idx);
    setSelectedAngles([]);
    setCustomAngleToggle(false);
    setCustomAngleInput('');
    setShowWriteDialog(true);
  };

  const fillFreeWrite = (item: RawItem) => {
    setFreeTitle(item.title);
    setFreeUrls([item.url]);
    setFreeStep(1);
    setFreeSharedFacts([]);
    setFreeDiffFacts([]);
    setFreeRecommendedAngles([]);
    setFreeAngle('');
    setStatusBar(`已填充选题: ${item.title}`);
    document.getElementById('freeWriteSection')?.scrollIntoView({ behavior: 'smooth' });
  };

  const toggleFreeAngle = (angle: string) => {
    // If the angle is exactly one of the recommended ones, we try to toggle its presence in the freeAngle text
    const currentLines = freeAngle.split('\n').map(l => l.trim()).filter(l => l !== '');
    if (currentLines.includes(angle)) {
      setFreeAngle(currentLines.filter(l => l !== angle).join('\n'));
    } else {
      setFreeAngle(freeAngle === '' ? angle : freeAngle + '\n' + angle);
    }
  };
  /**
   * Shared multi-source analysis: given labeled source contents,
   * DeepSeek extracts shared facts, diff facts, and writing angles.
   * Used by both free-write (原料直达) and topic-search (选题检索) flows.
   */
  const runMultiSourceAnalysis = async (
    sourceContents: { id: string; content: string }[]
  ): Promise<{ sharedFacts: string[]; diffFacts: string[]; angles: string[] }> => {
    const combinedContent = sourceContents
      .map(s => `【${s.id}】:\n${s.content}`)
      .join('\n\n---\n\n');

    const analysisPrompt = `你是一位深谙政经逻辑与大众心理的资深媒体研判专家。
请对以下多个信源提供的素材进行客观、深度且具传播力的分析。
【注意】：请务必记住每个信源的编号（如"链接1"、"补充素材1"）。

【素材内容】：
${combinedContent}

【任务】：
1. 【核心事实】：提取多方信源达成共识的核心事实。**要求：每个事实末尾必须标注其来源编号，如 [链接1] 或 [链接2, 补充素材1]**。
2. 【差异事实】：提取信源之间存在偏差或各家独有的深度细节。**要求：必须标注来源编号，如 [链接3]**。
3. 【视角推荐】：提供 3-5 个具体、通俗、犀利的写作视角。视角应具备冲突感、稀缺性、解释力和读者共鸣。

请严格按以下 JSON 格式输出：
{
  "sharedFacts": ["事实A [链接1, 链接2]", "事实B [链接1]"],
  "diffFacts": ["差异点C [链接3]", "差异点D [补充素材1]"],
  "angles": ["视角1", "视角2", "视角3"]
}`;

    const responseSchema = {
      type: Type.OBJECT,
      properties: {
        sharedFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
        diffFacts: { type: Type.ARRAY, items: { type: Type.STRING } },
        angles: { type: Type.ARRAY, items: { type: Type.STRING } }
      },
      required: ["sharedFacts", "diffFacts", "angles"]
    };

    const result = await callAI(apiKey, analysisPrompt, {
      maxTokens: 3000,
      responseSchema: responseSchema,
      temperature: 0.3,
    });

    const firstBrace = result.indexOf('{');
    const lastBrace = result.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1) throw new Error('AI 返回的不是有效的 JSON 格式');
    const data = JSON.parse(result.substring(firstBrace, lastBrace + 1));

    if ((data.sharedFacts?.length || 0) === 0 && (data.angles?.length || 0) === 0) {
      throw new Error('AI 未能提取到有效事实或视角');
    }

    return {
      sharedFacts: data.sharedFacts || [],
      diffFacts: data.diffFacts || [],
      angles: data.angles || [],
    };
  };

  const handleFreeAnalysis = async () => {
    const validUrls = freeUrls.filter(u => u && u.startsWith('http'));
    if (validUrls.length === 0 && !freePastedContent) return alert('请填入链接或直接粘贴素材内容以供 AI 分析');

    setIsAnalyzingFree(true);
    setFreeAngle('');
    setStatusBar('AI 正在读取网页并提取事实与推荐视角...');

    try {
      setStatusBar(`正在深度读取 ${validUrls.length} 个参考信源...`);

      const sourceContents: { id: string; content: string }[] = [];

      // Scrape URLs in parallel
      if (validUrls.length > 0) {
        const scraped = await Promise.all(validUrls.map(async (url, i) => {
          try {
            const res = await fetch(`/api/scrape?url=${encodeURIComponent(url)}`);
            if (res.ok) {
              const text = await res.text();
              if (text === "SCRAPE_BLOCKED_BY_WAF") {
                return { id: `链接${i+1}`, content: `[抓取被拦截] ${url}` };
              }
              return { id: `链接${i+1}`, content: text.substring(0, 5000) };
            }
            return { id: `链接${i+1}`, content: `[读取失败 HTTP ${res.status}] ${url}` };
          } catch {
            return { id: `链接${i+1}`, content: `[抓取错误] ${url}` };
          }
        }));
        sourceContents.push(...scraped);
      }

      // Add pasted content
      if (freePastedContent) {
        sourceContents.push({ id: '补充素材1', content: freePastedContent });
      }
      if (freePastedContent2) {
        sourceContents.push({ id: '补充素材2', content: freePastedContent2 });
      }

      // Run shared analysis
      const { sharedFacts, diffFacts, angles } = await runMultiSourceAnalysis(sourceContents);

      setFreeSharedFacts(sharedFacts);
      setFreeDiffFacts(diffFacts);
      setFreeRecommendedAngles(angles);
      setFreeStep(2);
      setStatusBar('多源分析完成，请选择视角并开始创作');
      setTimeout(() => {
        document.getElementById('freeWriteSection')?.scrollIntoView({ behavior: 'smooth' });
      }, 100);
    } catch (e: any) {
      console.error("Free write analysis failed:", e);
      setStatusBar(`分析失败: ${e.message}`);
      alert('分析失败: ' + e.message + '\n\n提示：请确保填入的是有效的新闻网页链接，且 AI 设置无误。');
    } finally {
      setIsAnalyzingFree(false);
    }
  };

  const submitFreeWrite = () => {
    if (!freeTitle) return alert('请填写选题标题');
    const combinedFacts = [
      ...freeSharedFacts.map(f => `[共同事实] ${f}`),
      ...freeDiffFacts.map(f => `[差异/独特] ${f}`)
    ];
    // Collect all references used
    const refs: { title: string, url: string, source: string, content?: string }[] = [];
    freeUrls.forEach((u, i) => {
      if (u && u.startsWith('http')) {
        refs.push({ title: `参考链接 ${i+1}`, url: u, source: `链接${i+1}` });
      }
    });
    if (freePastedContent) {
      refs.push({ title: '补充素材 1', url: '#', source: '补充素材1', content: freePastedContent });
    }
    if (freePastedContent2) {
      refs.push({ title: '补充素材 2', url: '#', source: '补充素材2', content: freePastedContent2 });
    }

    const firstUrl = freeUrls.find(u => u && u.startsWith('http')) || '';

    executeWorkflow(freeTitle, freeAngle, freeStyle, freePersona, freeWordcount, firstUrl, '', combinedFacts, refs);
  };

  const submitFromDialog = () => {
    if (selectedAngles.length === 0 && !customAngleToggle) return alert('请至少选择一个视角');
    const topic = topicData[currentIdx!];
    const angles = selectedAngles.map(i => topic.angles[i]);
    if (customAngleToggle && customAngleInput) angles.push(customAngleInput);
    
    setShowWriteDialog(false);

    executeWorkflow(topic.title, angles.join(' | '), diagStyle, diagPersona, diagWordcount, topic.url, topic.sourceName);
  };

  return (
    <div className="min-h-screen">
      {!showDraft && (
        <div className="floating-status-wrap">
          <div className={`status-bar ${statusBar !== '就绪' ? 'busy' : ''}`}>
            {statusBar !== '就绪' ? (
              <RefreshCw size={14} className="animate-spin text-accent" />
            ) : (
              <span className="status-dot animate-pulse"></span>
            )}
            <span className="uppercase tracking-wider mr-2">{statusBar}</span>
            <button 
              onClick={playNotification}
              className={`text-muted hover:text-accent p-1 transition-all ${showAudioToast ? 'scale-125 text-accent' : ''}`}
              title="测试提示音"
            >
              <Volume2 size={12} />
            </button>
          </div>
        </div>
      )}
      <div className="masthead flex-wrap gap-4">
        <div>
          <div 
            className="masthead-title select-none cursor-pointer hover:opacity-85 active:scale-95 transition-all duration-150 inline-block"
            onClick={handleLogoTap}
            title="点击 5 次打开管理员授权后台"
          >
            时评<span>雷达</span>
          </div>
        </div>
        <div className="flex items-center gap-2 md:gap-4 flex-wrap justify-end">
          <button 
            className="cat-btn !bg-ink !text-paper border-none flex items-center gap-2" 
            style={{ fontSize: '0.75rem', padding: '6px 15px' }}
            onClick={() => setShowRssManager(true)}
          >
            <Rss size={14} /> RSS 订阅管理
          </button>
          <button 
            className="cat-btn !bg-ink !text-paper border-none" 
            style={{ fontSize: '0.75rem', padding: '6px 15px' }}
            onClick={() => setShowDraftsList(true)}
          >
            📁 我的草稿箱 ({drafts.length})
          </button>
          <div className="hidden md:block font-mono text-[0.7rem]">{clock}</div>
        </div>
      </div>

      <div className="toolbar">
        <div className="flex items-center gap-2 md:gap-4 flex-wrap w-full md:w-auto">
          <div className="flex items-center gap-2 w-full md:w-auto">
            <span className="text-[0.6rem] text-muted uppercase font-bold w-12 md:w-14 flex-shrink-0">Key</span>
            <div className="flex-1 md:flex-none md:w-64">
              <input 
                className="key-input !py-1 w-full font-mono text-[0.7rem]" 
                type="password" 
                value={apiKey}
                onChange={(e) => handleKeyChange(e.target.value)}
                placeholder="填写 DeepSeek API Key..."
              />
            </div>
          </div>



          <button 
            onClick={() => setShowToolbarSettings(!showToolbarSettings)}
            className={`md:hidden p-1.5 rounded border border-border flex items-center gap-1 transition-all ${showToolbarSettings ? 'bg-ink text-paper border-ink' : 'text-muted'}`}
          >
            <Settings size={14} className={showToolbarSettings ? 'animate-spin-slow' : ''} />
            <span className="text-[0.6rem] font-bold">配置</span>
          </button>

          <div className={`${showToolbarSettings ? 'flex' : 'hidden md:flex'} items-center gap-4 w-full md:w-auto mt-2 md:mt-0 pt-2 md:pt-0 border-t md:border-t-0 border-border md:border-l pl-0 md:pl-4 flex-wrap`}>
            <div className="flex flex-col">
              <label className="text-[0.6rem] text-muted font-bold uppercase mb-0.5">模型</label>
              <select 
                className="key-input !py-1 !w-full md:!w-auto"
                value={customModel}
                onChange={(e) => handleModelChange(e.target.value)}
              >
                <option value="deepseek-v4-flash">DeepSeek V4-Flash (Default)</option>
                <option value="deepseek-v4-pro">DeepSeek V4-Pro</option>
              </select>
            </div>

            <div className="flex items-center gap-2 border-l-0 md:border-l border-border md:pl-4">
              <input 
                type="checkbox" 
                id="deep-thinking-check"
                className="w-3 h-3 accent-accent cursor-pointer" 
                checked={deepThinking}
                onChange={(e) => handleDeepThinkingChange(e.target.checked)}
              />
              <label htmlFor="deep-thinking-check" className="text-[0.6rem] font-bold text-muted cursor-pointer select-none">
                深度思考 (Thinking)
              </label>
            </div>
          </div>
        </div>

        <div className="hidden md:flex flex-1" />

        <div className={`${showToolbarSettings ? 'flex' : 'hidden md:flex'} w-full md:w-auto mt-2 md:mt-0 key-input-wrap !mb-0 items-center gap-2 border-t md:border-t-0 border-border pt-2 md:pt-0`}>
          <label className="text-[0.6rem] text-muted font-bold uppercase whitespace-nowrap">搜索源</label>
          <select 
            className="key-input !py-1 w-full md:w-auto" 
            value={searchEngine}
            onChange={(e) => handleSearchEngineChange(e.target.value)}
          >
            <option value="bing">深度搜索 (Bing/Jina/DeepSeek)</option>
            <option value="google">联网搜索 (Google/Gemini)</option>
            <option value="sina">新浪新闻搜索 (Sina)</option>
          </select>
        </div>
      </div>

      <div className="layout">
        <div className="side-col">
          <div className="flex gap-1 mb-4 border-b border-border">
            {[
              { id: 'hotlist', name: '实时热榜' },
              { id: 'rss', name: 'RSS订阅' },
              { id: 'discovery', name: '精选资讯' }
            ].map(tab => (
              <button 
                key={tab.id}
                className={`px-3 py-2 text-[0.7rem] font-bold transition-all ${activeTab === tab.id ? 'border-b-2 border-ink text-ink' : 'text-muted hover:text-ink'}`}
                onClick={() => setActiveTab(tab.id as any)}
              >
                {tab.name}
              </button>
            ))}
          </div>

          <div className="side-title text-[0.7rem] tracking-[1px] uppercase border-b border-border pb-[5px] mb-[10px] flex justify-between items-center">
            <span>
              {activeTab === 'hotlist' && '全网实时榜单'}
              {activeTab === 'rss' && 'RSS 订阅内容'}
              {activeTab === 'discovery' && '深度精选资讯'}
            </span>
            <button 
              className="text-muted hover:text-ink transition-colors p-1"
              onClick={() => {
                if (activeTab === 'hotlist') fetchHotlist();
                else if (activeTab === 'rss') fetchRssItems();
                else if (activeTab === 'discovery') fetchGoogleNews();
              }}
              disabled={isFetchingRss || isDiscovering}
            >
              <RefreshCw size={14} className={(isFetchingRss || isDiscovering) ? 'animate-spin' : ''} />
            </button>
          </div>

          <div className="raw-list">
            {activeTab === 'hotlist' && (
              rawItems.length === 0 ? (
                <div className="text-[0.7rem] text-muted italic py-8 text-center">点击刷新抓取热榜</div>
              ) : (
                Object.entries(groupedRawItems).map(([name, list]: [string, any]) => (
                  <div key={name}>
                    <div className="raw-platform-header">{name}</div>
                    {list.slice(0, name === '今日头条' ? 20 : 10).map((it: RawItem, i: number) => (
                      <div className="raw-item" key={i}>
                        <span className="raw-rank">{i + 1}</span>
                        <a href={it.url} target="_blank" rel="noreferrer" className="raw-title">{it.title}</a>
                        <button className="raw-write-btn" onClick={() => fillFreeWrite(it)}>
                          <SquarePen size={14} className="md:hidden" />
                          <span className="hidden md:inline">写这篇</span>
                        </button>
                      </div>
                    ))}
                  </div>
                ))
              )
            )}

            {activeTab === 'rss' && (
              rssItems.length === 0 ? (
                <div className="text-[0.7rem] text-muted italic py-8 text-center">点击刷新同步 RSS</div>
              ) : (
                rssItems.slice(0, 30).map((item, i) => (
                  <div className="raw-item" key={i}>
                    <div className="flex flex-col gap-1 w-full">
                      <div className="flex justify-between items-start gap-2">
                        <span className="text-[0.6rem] bg-cream px-1 border border-border text-muted whitespace-nowrap">{item._sourceName}</span>
                        <span className="text-[0.55rem] text-muted font-mono">{item.pubDate ? new Date(item.pubDate).toLocaleDateString() : ''}</span>
                      </div>
                      <a href={item.link} target="_blank" rel="noreferrer" className="raw-title">{item.title}</a>
                      <div className="flex justify-end">
                        <button className="raw-write-btn" onClick={() => fillFreeWrite({ title: item.title, url: item.link, _sourceName: item._sourceName })}>
                          <SquarePen size={14} className="md:hidden" />
                          <span className="hidden md:inline">写这篇</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )
            )}

            {activeTab === 'discovery' && (
              discoveryItems.length === 0 ? (
                <div className="text-[0.7rem] text-muted italic py-8 text-center">点击刷新获取精选资讯</div>
              ) : (
                discoveryItems.map((item, i) => (
                  <div className="raw-item" key={i}>
                    <div className="flex flex-col gap-1 w-full">
                      <div className="flex justify-between items-center gap-2">
                        <span className="text-[0.6rem] bg-blue-50/40 text-blue-400/90 px-1.5 py-0.5 rounded border border-blue-100/30 font-medium uppercase tracking-wider">{item._sourceName}</span>
                        {item.pubDate && (
                          <span className="text-[0.55rem] text-muted font-mono">
                            {formatDate(item.pubDate)}
                          </span>
                        )}
                      </div>
                      <a href={item.url} target="_blank" rel="noreferrer" className="raw-title">{item.title}</a>
                      <div className="flex justify-end">
                        <button className="raw-write-btn" onClick={() => fillFreeWrite(item)}>
                          <SquarePen size={14} className="md:hidden" />
                          <span className="hidden md:inline">写这篇</span>
                        </button>
                      </div>
                    </div>
                  </div>
                ))
              )
            )}
          </div>
        </div>

        <div className="main-col">
          <div className="flex justify-between items-center mb-4">
            <div className="section-title">自由创作中心</div>
            {/* Mode Switch */}
            <div className="flex border border-border rounded-sm overflow-hidden">
              <button
                className={`px-4 py-1.5 text-[0.65rem] font-bold uppercase tracking-wider transition-all ${
                  writeMode === 'direct'
                    ? 'bg-ink text-paper'
                    : 'bg-transparent text-muted hover:text-ink'
                }`}
                onClick={() => setWriteMode('direct')}
              >
                📝 原料直达
              </button>
              <button
                className={`px-4 py-1.5 text-[0.65rem] font-bold uppercase tracking-wider transition-all ${
                  writeMode === 'search'
                    ? 'bg-ink text-paper'
                    : 'bg-transparent text-muted hover:text-ink'
                }`}
                onClick={() => setWriteMode('search')}
              >
                🔍 选题检索
              </button>
            </div>
          </div>

          {writeMode === 'search' ? (
            <div className="free-write-section !border-t-0 !pt-0 !pb-10 !bg-transparent">
              <TopicSearchPanel
                apiKey={apiKey}
                onImport={async (facts, refs, title) => {
                  // Build labeled source contents from selected article summaries
                  const sourceContents = refs.map((r, i) => ({
                    id: `链接${i+1}`,
                    content: `标题: ${r.title}\n来源: ${r.source}\n摘要: ${facts[i] || ''}`,
                  }));

                  // Pre-fill form state (needed before analysis for UX)
                  setFreeTitle(title);
                  const urls = refs.map(r => r.url).filter(u => u && u.startsWith('http'));
                  setFreeUrls(urls.length > 0 ? urls.slice(0, 3) : ['']);
                  setFreePastedContent('');
                  setFreePastedContent2('');
                  setFreeStyle('fact_first');
                  setFreePersona('editor');
                  setFreeWordcount(1000);

                  // Switch to direct mode so user sees the progress
                  setWriteMode('direct');
                  setIsAnalyzingFree(true);
                  setStatusBar('正在对选中文章进行多源事实提取与视角分析...');

                  try {
                    const { sharedFacts, diffFacts, angles } = await runMultiSourceAnalysis(sourceContents);

                    setFreeSharedFacts(sharedFacts);
                    setFreeDiffFacts(diffFacts);
                    setFreeRecommendedAngles(angles);
                    setFreeAngle('');
                    setFreeStep(2);
                    setStatusBar(`分析完成：${sharedFacts.length}条事实 · ${angles.length}个视角 · 请选择立场后开始创作`);
                    setTimeout(() => {
                      document.getElementById('freeWriteSection')?.scrollIntoView({ behavior: 'smooth' });
                    }, 200);
                  } catch (e: any) {
                    console.error('Topic search analysis failed:', e);
                    setStatusBar(`分析失败: ${e.message}`);
                    // Fallback: still go to step 2 with raw summaries as facts
                    setFreeSharedFacts(facts);
                    setFreeDiffFacts([]);
                    setFreeRecommendedAngles([]);
                    setFreeAngle('');
                    setFreeStep(2);
                    setTimeout(() => {
                      document.getElementById('freeWriteSection')?.scrollIntoView({ behavior: 'smooth' });
                    }, 200);
                  } finally {
                    setIsAnalyzingFree(false);
                  }
                }}
              />
            </div>
          ) : (
          <div id="freeWriteSection" className="free-write-section !border-t-0 !pt-0 !pb-10 !bg-transparent">
            <div className="flex justify-between items-center mb-4">
              <div className="section-title">自由创作中心</div>
              {freeStep === 2 && (
                <button 
                  className="text-[0.65rem] text-muted hover:text-ink underline uppercase font-mono"
                  onClick={() => setFreeStep(1)}
                >
                  重置选题 / 返回上一步
                </button>
              )}
            </div>

            {freeStep === 1 ? (
              <div className="free-write-grid !gap-x-12">
                {/* Left Column: Title & Links */}
                <div className="flex flex-col gap-6">
                  <div>
                    <label className="field-label">选题标题 / 核心事件</label>
                    <input 
                      className="write-num" 
                      value={freeTitle}
                      onChange={(e) => setFreeTitle(e.target.value)}
                      placeholder="在此输入你想探讨的话题..."
                    />
                  </div>
                  <div className="flex flex-col gap-3">
                    <div className="flex justify-between items-end">
                      <label className="field-label">参考链接 ({freeUrls.length}/3)</label>
                      {freeUrls.length < 3 && (
                        <button 
                          onClick={() => setFreeUrls([...freeUrls, ''])}
                          className="text-[0.6rem] bg-ink text-white px-2 py-0.5 font-bold hover:bg-accent transition-colors"
                        >
                          + 添加链接
                        </button>
                      )}
                    </div>
                    {freeUrls.map((url, i) => (
                      <div key={i} className="flex gap-2">
                        <input 
                          type="text" 
                          className="write-num flex-1" 
                          value={url}
                          onChange={(e) => {
                            const newUrls = [...freeUrls];
                            newUrls[i] = e.target.value;
                            setFreeUrls(newUrls);
                          }}
                          placeholder={`粘贴来源链接 ${i + 1}...`}
                        />
                        {freeUrls.length > 1 && (
                          <button 
                            onClick={() => setFreeUrls(freeUrls.filter((_, idx) => idx !== i))}
                            className="px-2 text-muted hover:text-red-500"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Right Column: Supplementary Materials (Folded) */}
                <div className="flex flex-col gap-4">
                  <div 
                    className="flex justify-between items-center cursor-pointer pb-2 border-b border-border hover:border-ink transition-colors group"
                    onClick={() => setShowExtraInputs(!showExtraInputs)}
                  >
                    <label className="field-label !mb-0 cursor-pointer">补充素材 / 手动粘贴 (可选)</label>
                    <span className="text-[0.7rem] text-muted group-hover:text-ink flex items-center gap-1 uppercase font-mono">
                      {showExtraInputs ? '收起' : '展开补充框'} 
                      <span className={`transform transition-transform ${showExtraInputs ? 'rotate-180' : ''}`}>▼</span>
                    </span>
                  </div>

                  <AnimatePresence>
                    {showExtraInputs && (
                      <motion.div 
                        initial={{ height: 0, opacity: 0 }}
                        animate={{ height: 'auto', opacity: 1 }}
                        exit={{ height: 0, opacity: 0 }}
                        className="flex flex-col gap-4 overflow-hidden"
                      >
                        <div className="mt-2">
                          <label className="text-[0.6rem] text-muted mb-2 uppercase font-mono block">主要内容粘贴 01</label>
                          <textarea 
                            className="write-num !h-[140px] !py-3 !resize-none !text-[0.8rem]" 
                            value={freePastedContent}
                            onChange={(e) => setFreePastedContent(e.target.value)}
                            placeholder="粘贴第一份主要参考素材或微信文章正文..."
                          />
                        </div>
                        <div>
                          <label className="text-[0.6rem] text-muted mb-2 uppercase font-mono block">补充资料粘贴 02</label>
                          <textarea 
                            className="write-num !h-[140px] !py-3 !resize-none !text-[0.8rem]" 
                            value={freePastedContent2}
                            onChange={(e) => setFreePastedContent2(e.target.value)}
                            placeholder="粘贴补充信息、背景资料或辅助信源内容..."
                          />
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                  
                  {!showExtraInputs && (
                    <div className="text-[0.7rem] text-muted/60 italic font-medium pt-4 bg-muted/5 p-4 border border-dashed border-border rounded">
                      提示：如果链接（如微信、内网地址）难以抓取，请点击上方展开按钮，手动将文章内容粘贴到补充框内，以便 AI 进行深度研判。
                    </div>
                  )}
                </div>

                <div className="free-write-full text-right mt-4">
                  <button 
                    className={`btn-fetch ${isAnalyzingFree ? 'opacity-50' : ''}`} 
                    onClick={handleFreeAnalysis}
                    disabled={isAnalyzingFree}
                  >
                    {isAnalyzingFree ? (
                      <div className="flex items-center gap-2">
                        <RefreshCw size={14} className="animate-spin" />
                        正在深度语义分析...
                      </div>
                    ) : (
                      '▶ 下一步：智能提取事实与推荐视角'
                    )}
                  </button>
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-8">
                <div className="flex flex-col gap-6">
                  <div className="bg-paper border border-border p-4 overflow-y-auto">
                    <div className="text-[0.65rem] text-muted font-bold uppercase mb-4 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-accent rounded-full"></span>
                      核心事实研判 (Fact Analysis)
                    </div>
                    
                    {freeSharedFacts.length > 0 && (
                      <div className="mb-6">
                        <div className="text-[0.6rem] text-ink/40 font-bold mb-2 uppercase tracking-widest bg-muted/10 px-2 py-1 inline-block">Shared / 共识事实</div>
                        <ul className="space-y-2">
                          {freeSharedFacts.map((f, i) => (
                            <li key={i} className="text-[0.75rem] leading-relaxed text-ink/80 flex gap-2">
                              <span className="text-muted font-mono">{i+1}.</span>
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {freeDiffFacts.length > 0 && (
                      <div>
                        <div className="text-[0.6rem] text-accent/60 font-bold mb-2 uppercase tracking-widest bg-accent/5 px-2 py-1 inline-block">Unique & Differences / 差异与特有提及</div>
                        <ul className="space-y-2">
                          {freeDiffFacts.map((f, i) => (
                            <li key={i} className="text-[0.75rem] leading-relaxed text-ink/80 flex gap-2">
                              <span className="text-muted font-mono">{i+1}.</span>
                              {f}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}

                    {freeSharedFacts.length === 0 && freeDiffFacts.length === 0 && (
                      <div className="text-muted italic text-xs">暂无事实记录</div>
                    )}
                  </div>

                  <div className="flex flex-col gap-4">
                    <div className="text-[0.65rem] text-muted font-bold uppercase mb-1 flex items-center gap-2">
                      <span className="w-1.5 h-1.5 bg-blue rounded-full"></span>
                      AI 推荐写作视角 (Select an Angle)
                    </div>
                    {freeRecommendedAngles.map((a, i) => {
                      const isSelected = freeAngle.includes(a);
                      return (
                        <div 
                          key={i} 
                          className={`p-3 border transition-all cursor-pointer hover:border-ink hover:bg-white text-[0.8rem] leading-relaxed flex items-start gap-3 ${isSelected ? 'border-ink bg-white shadow-sm ring-1 ring-ink' : 'border-border bg-paper'}`}
                          onClick={() => toggleFreeAngle(a)}
                        >
                          <div className={`mt-1.5 w-3 h-3 border flex-shrink-0 flex items-center justify-center ${isSelected ? 'bg-ink border-ink' : 'border-muted'}`}>
                            {isSelected && <span className="text-[10px] text-white">✓</span>}
                          </div>
                          <div>
                            <div className="font-bold mb-0.5 font-mono text-muted text-[0.6rem]">视角推荐 {i+1}</div>
                            {a}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                <div className="free-write-grid !mt-0 border-t border-border pt-6 flex flex-col gap-6">
                  <div className="flex flex-col gap-6 free-write-full">
                    <div className="border-b border-border pb-4">
                      <label className="field-label">文章模式</label>
                      <select className="write-num !w-full md:!w-auto" value={freeStyle} onChange={(e) => setFreeStyle(e.target.value)}>
                        <option value="fact_first">事实优先 (叙事为主)</option>
                        <option value="oped">理念主导 (理论前瞻)</option>
                      </select>
                    </div>
                    <div className="border-b border-border pb-4">
                      <label className="field-label">写作立场</label>
                      <select className="write-num !w-full md:!w-auto" value={freePersona} onChange={(e) => setFreePersona(e.target.value)}>
                        <option value="editor">主流情绪 (公约数视角)</option>
                        <option value="balance">平衡派 (有褒有贬)</option>
                        <option value="radical">犀利批判 (打破结构)</option>
                        <option value="cause_effect">前因后果式解读 (底层逻辑)</option>
                        <option value="investor">投资者视角 (收益与风险)</option>
                      </select>
                    </div>
                    <div>
                      <label className="field-label">目标字数</label>
                      <input 
                        type="number" 
                        className="write-num !w-full md:!w-auto" 
                        value={freeWordcount}
                        onChange={(e) => setFreeWordcount(parseInt(e.target.value))}
                        step="500" min="500" max="3000"
                      />
                    </div>
                  </div>
                  <div className="free-write-full">
                    <label className="field-label">核心观点 / 补充细节 (补充自定义切入点)</label>
                    <textarea 
                      className="write-num h-24 font-serif" 
                      value={freeAngle}
                      onChange={(e) => setFreeAngle(e.target.value)}
                      placeholder="已选视角内容将出现在此，您可以继续修改或补充..."
                    />
                  </div>
                  <div className="free-write-full text-right">
                    <button className="btn-fetch" onClick={submitFreeWrite}>▶ 开始深度创作</button>
                  </div>
                </div>
              </div>
            )}
          </div>
          )}

          <div className="section-header !items-center border-t-3 border-double border-ink pt-8">
            <div className="flex items-center gap-4">
              <div className="section-title">今日推荐选题</div>
              <button className="btn-fetch !py-1.5 !px-4 !text-[0.7rem]" onClick={startAnalysis} disabled={isAnalyzing}>
                {isAnalyzing ? "筛选中..." : "AI筛选左侧新闻列表"}
              </button>
            </div>
            <div className="font-mono text-[0.7rem] text-muted">{topicData.length || '--'} SELECTIONS</div>
          </div>
          <div id="resultList">
            {topicData.length === 0 ? (
              <div className="py-[100px] text-center text-muted">点击上方"AI筛选新闻"按钮获取今日选题</div>
            ) : (
              <AnimatePresence>
                {topicData.map((topic, i) => (
                    <motion.div 
                      className="topic-card" 
                      key={i}
                      initial={{ opacity: 0, y: 20 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.05 }}
                      onClick={() => openWriteDialog(i)}
                    >
                    <div className="card-rank">{(i + 1).toString().padStart(2, '0')}</div>
                    <div className="card-body">
                      <div className="card-title">
                        <a href={topic.url} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()}>{topic.title}</a>
                      </div>
                      <div className="card-angles">
                        {topic.angles.map((a, j) => (
                          <div className="angle-item" key={j}>
                            <div className="flex items-start gap-2 mb-2">
                              <span className="angle-num mt-0.5">视角 {j+1}</span>
                              <div className="text-[0.8rem] text-ink leading-relaxed">
                                {a}
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                      <button 
                        className="cat-btn mt-3 border-gold text-gold" 
                        onClick={(e) => { e.stopPropagation(); openWriteDialog(i); }}
                      >
                        ✍ 写这篇
                      </button>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            )}
          </div>
        </div>
      </div>

      {/* Write Dialog */}
      <AnimatePresence>
        {showWriteDialog && (
          <motion.div 
            className="fixed inset-0 bg-black/85 z-[200] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div 
              className="bg-paper text-ink w-full max-w-[600px] p-[35px] border border-ink relative shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="font-black text-[1.2rem] mb-5 leading-[1.4] font-display">{topicData[currentIdx!]?.title}</div>
            <div className="font-mono text-[0.65rem] text-muted mb-2">选择写作角度 (可多选)</div>
            <div className="mb-5 bg-cream p-[15px] border border-border max-h-[220px] overflow-y-auto">
              {topicData[currentIdx!]?.angles.map((a, i) => (
                <label key={i} className="block mb-[12px] cursor-pointer group">
                  <div className="flex items-start gap-2">
                    <input 
                      type="checkbox" 
                      className="mt-1"
                      checked={selectedAngles.includes(i)}
                      onChange={(e) => {
                        if (e.target.checked) setSelectedAngles([...selectedAngles, i]);
                        else setSelectedAngles(selectedAngles.filter(idx => idx !== i));
                      }}
                    /> 
                    <div className="flex-1 text-[0.85rem] text-ink leading-snug group-hover:text-accent transition-colors">
                      {a}
                    </div>
                  </div>
                </label>
              ))}
              <label className="block mb-[10px] cursor-pointer text-[0.9rem]">
                <input 
                  type="checkbox" 
                  checked={customAngleToggle}
                  onChange={(e) => setCustomAngleToggle(e.target.checked)}
                /> 自定义补充视角...
              </label>
              {customAngleToggle && (
                <input 
                  type="text" 
                  className="write-num w-full mb-[10px]" 
                  value={customAngleInput}
                  onChange={(e) => setCustomAngleInput(e.target.value)}
                  placeholder="输入要补充的视角，将与上方勾选项融合..."
                />
              )}
            </div>
            
            <div className="grid grid-cols-2 gap-[15px] mb-[25px]">
              <div>
                <label className="text-[0.65rem] text-muted block mb-[5px]">文章模式</label>
                <select className="write-num" value={diagStyle} onChange={(e) => setDiagStyle(e.target.value)}>
                  <option value="fact_first">事实优先 (事实记录)</option>
                  <option value="oped">理念主导 (理论分析)</option>
                </select>
              </div>
              <div>
                <label className="text-[0.65rem] text-muted block mb-[5px]">写作立场</label>
                <select className="write-num" value={diagPersona} onChange={(e) => setDiagPersona(e.target.value)}>
                  <option value="editor">主流情绪 (公约数视角)</option>
                  <option value="balance">平衡派 (有褒有贬)</option>
                  <option value="radical">犀利批判 (打破结构)</option>
                  <option value="cause_effect">前因后果式解读 (逻辑溯源)</option>
                  <option value="investor">投资者视角 (商业价值)</option>
                </select>
              </div>
              <div>
                <label className="text-[0.65rem] text-muted block mb-[5px]">目标字数</label>
                <input 
                  type="number" 
                  className="write-num" 
                  value={diagWordcount}
                  onChange={(e) => setDiagWordcount(parseInt(e.target.value))}
                  step="500" min="500" max="3000"
                />
              </div>
            </div>
            <div className="text-right">
              <button onClick={() => setShowWriteDialog(false)} className="bg-none border-none mr-[15px] cursor-pointer font-mono text-[0.7rem] hover:underline">CANCEL</button>
              <button className="btn-fetch" onClick={submitFromDialog}>START WRITING</button>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* Draft Overlay */}
      <AnimatePresence>
        {showDraft && (
          <motion.div 
            className="draft-overlay open"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div 
              className="draft-box"
              initial={{ y: 40, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              exit={{ y: 40, opacity: 0 }}
            >
              <div className="draft-header">
                <div className="font-bold text-[1.2rem] flex-1 truncate mr-4 font-display">{draftTitle}</div>
                <button onClick={() => setShowDraft(false)} className="cursor-pointer bg-none border-none text-[1.2rem] flex-shrink-0 hover:rotate-90 transition-transform">✕</button>
              </div>

              {/* Mobile Tabs */}
              <div className="flex md:hidden border-b border-border bg-paper">
                <button 
                  onClick={() => setDraftTab('content')}
                  className={`flex-1 py-3 text-[0.8rem] font-bold tracking-widest transition-all ${draftTab === 'content' ? 'text-accent border-b-2 border-accent bg-paper' : 'text-muted'}`}
                >
                  正文创作
                </button>
                <button 
                  onClick={() => setDraftTab('sources')}
                  className={`flex-1 py-3 text-[0.8rem] font-bold tracking-widest transition-all ${draftTab === 'sources' ? 'text-accent border-b-2 border-accent bg-paper' : 'text-muted'}`}
                >
                  核查与溯源
                </button>
              </div>
            
            <div className="draft-content-layout">
              <div className={`draft-main-area ${draftTab !== 'content' ? 'hidden md:flex' : 'flex'}`}>
                <div className="draft-body" dangerouslySetInnerHTML={renderDraftBody(draftBody)}></div>
              </div>

              <div className={`draft-side-area ${draftTab !== 'sources' ? 'hidden md:flex' : 'flex'}`}>
                <div className="flex-1 flex flex-col overflow-hidden">
                  <div className="flex-1 overflow-y-auto bg-white">
                    {/* SOURCES LIST */}
                    {draftReferences.length > 0 && (
                      <div className="p-4 border-b border-border bg-paper/50">
                        <div className="text-[0.6rem] font-black text-ink uppercase tracking-widest mb-3 flex items-center gap-2">
                          <span className="w-2 h-2 bg-ink rotate-45"></span>
                          溯源信源清单 (Sources)
                        </div>
                        <div className="grid grid-cols-1 gap-1.5">
                          {draftReferences.map((ref, i) => (
                            <div key={i} className="flex items-center gap-2 group leading-tight truncate">
                              <span className="text-[0.55rem] bg-ink/5 px-1 rounded text-ink font-bold font-mono min-w-[1.2rem] text-center">[{ref.source || i+1}]</span>
                              {ref.url && ref.url !== '#' ? (
                                <a 
                                  href={ref.url} 
                                  target="_blank" 
                                  rel="noreferrer" 
                                  className="text-[0.65rem] text-blue-600 hover:text-accent truncate underline-offset-2 font-medium"
                                  title={ref.title}
                                >
                                  {ref.title}
                                </a>
                              ) : (
                                <button 
                                  className="text-[0.65rem] text-blue-600 hover:text-accent cursor-pointer truncate font-medium flex items-center gap-1 bg-transparent border-none p-0 appearance-none text-left"
                                  onClick={() => setSelectedMaterial({ title: ref.title, content: ref.content || '暂无内容' })}
                                >
                                  📄 {ref.title}
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}

                    {/* FACT CHECK INPUTS */}
                    <div className="p-4 border-b border-border bg-cream/10">
                      <div className="flex justify-between items-center mb-3">
                        <div className="text-[0.6rem] text-muted font-bold uppercase tracking-wider flex items-center gap-2">
                          <span className="w-2 h-2 border border-muted rounded-full"></span>
                          指定核查信源 (Optional)
                        </div>
                        <button 
                          className="text-[0.6rem] text-muted hover:text-accent underline"
                          onClick={() => setFactCheckUrls(['', ''])}
                        >
                          RESET
                        </button>
                      </div>
                      <div className="flex flex-col gap-2">
                        {factCheckUrls.map((url, idx) => (
                          <input
                            key={idx}
                            type="text"
                            className="write-num !text-[0.65rem] !py-1.5 !px-3 !bg-paper !border-muted/30 focus:!border-accent"
                            placeholder={`粘贴外部核查链接 ${idx + 1}...`}
                            value={url}
                            onChange={(e) => {
                              const newUrls = [...factCheckUrls];
                              newUrls[idx] = e.target.value;
                              setFactCheckUrls(newUrls);
                            }}
                          />
                        ))}
                      </div>
                    </div>

                    {/* RESULTS AREA */}
                    <div className="p-4">
                      <div className="text-[0.6rem] text-muted font-bold uppercase tracking-wider mb-4">
                        AI 深度事实核查结果 (Verification)
                      </div>
                      
                      {!showFactcheck ? (
                        <div className="py-12 flex flex-col items-center justify-center text-center text-muted border border-dashed border-muted/20 rounded-lg">
                          <div className="text-[2.5rem] mb-4 opacity-50">🔍</div>
                          <div className="text-[0.7rem] leading-relaxed max-w-[200px]">
                            点击下方 <span className="text-accent font-bold">"溯源核查"</span><br/>
                            AI 将根据主辅信源比对核实<br/>
                            标记潜在错误与逻辑偏误
                          </div>
                        </div>
                      ) : (
                        <div id="factcheckItems" className="space-y-4">
                          {factcheckItems}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </div>
            
            <div className="draft-footer p-3 md:p-[8px_20px] bg-cream border-t border-border flex flex-col md:flex-row justify-between items-center gap-2 md:gap-4">
              <div className="flex items-center gap-4 md:gap-[15px]">
                <div className="font-mono text-[0.65rem] md:text-[0.75rem] text-gold font-semibold uppercase">{draftMetaInfo}</div>
                <div className="font-mono text-[0.6rem] md:text-[0.7rem] text-muted">{wordCount} 字符</div>
              </div>
              <div className="flex gap-2 w-full md:w-auto">
                <button 
                  className="cat-btn border-blue-500 text-blue-500 p-[6px_10px] md:p-[8px_15px] text-[0.65rem] md:text-[0.7rem] flex-1 md:flex-initial" 
                  onClick={saveToDrafts}
                  id="draft-save-btn"
                >
                  <span className="hidden md:inline">{saveBtnText}</span>
                  <span className="md:hidden">{saveBtnText === '💾 保存到草稿箱' ? '💾 保存' : saveBtnText}</span>
                </button>
                <button 
                  className={`cat-btn border-green text-green p-[6px_10px] md:p-[8px_15px] text-[0.65rem] md:text-[0.7rem] flex items-center justify-center gap-1 md:gap-2 flex-1 md:flex-initial ${isFactchecking ? 'opacity-50 cursor-not-allowed' : ''}`} 
                  onClick={startFactcheck}
                  disabled={isFactcheckDisabled || isFactchecking}
                  id="draft-factcheck-btn"
                >
                  {isFactchecking ? (
                    <>
                      <RefreshCw size={10} className="animate-spin" />
                      正在核查...
                    </>
                  ) : (
                    <>🔍 溯源核查</>
                  )}
                </button>
                <button 
                  className="btn-fetch p-[6px_10px] md:p-[8px_20px] text-[0.65rem] md:text-[0.7rem] flex-1 md:flex-initial" 
                  onClick={copyDraft}
                  id="draft-copy-btn"
                >
                  <span className="hidden md:inline">{copyBtnText}</span>
                  <span className="md:hidden">{copyBtnText === '复制纯文本正文' ? '📋 复制' : copyBtnText}</span>
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
      </AnimatePresence>

      {/* RSS Manager Modal */}
      <AnimatePresence>
        {showRssManager && (
          <motion.div 
            className="fixed inset-0 bg-black/80 z-[300] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div 
              className="bg-paper border border-ink w-full max-w-md flex flex-col shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="p-6 border-b border-ink flex justify-between items-center bg-cream">
                <h3 className="font-black text-xl font-display flex items-center gap-2">
                  <Rss size={20} /> RSS 订阅管理
                </h3>
                <button onClick={() => setShowRssManager(false)} className="text-2xl hover:rotate-90 transition-transform">✕</button>
              </div>
              <div className="p-6">
                <div className="mb-6">
                  <label className="field-label">添加新订阅源 (最多 6 个)</label>
                  <div className="flex flex-col gap-2">
                    <input 
                      className="write-num" 
                      value={rssNameInput}
                      onChange={(e) => setRssNameInput(e.target.value)}
                      placeholder="订阅源名称 (如: 虎嗅)"
                      disabled={rssFeeds.length >= 6}
                    />
                    <div className="flex gap-2">
                      <input 
                        className="write-num flex-1" 
                        value={rssUrlInput}
                        onChange={(e) => setRssUrlInput(e.target.value)}
                        placeholder="RSS URL (https://...)"
                        disabled={rssFeeds.length >= 6}
                      />
                      <button 
                        className="btn-fetch !py-1 !px-4" 
                        onClick={addRssFeed}
                        disabled={rssFeeds.length >= 6}
                      >
                        <Plus size={16} />
                      </button>
                    </div>
                    {rssFeeds.length >= 6 && (
                      <div className="text-[0.65rem] text-accent italic">已达到最大订阅数量限制 (6个)</div>
                    )}
                  </div>
                </div>

                <label className="field-label">已订阅 ({rssFeeds.length}/6)</label>
                <div className="max-h-[300px] overflow-y-auto border border-border bg-white">
                  {rssFeeds.length === 0 ? (
                    <div className="p-4 text-center text-muted italic text-sm">暂无订阅源</div>
                  ) : (
                    rssFeeds.map((feed, idx) => (
                      <div key={idx} className="p-3 border-b border-border last:border-none flex justify-between items-center hover:bg-cream transition-colors">
                        <div className="flex flex-col overflow-hidden">
                          <span className="font-bold text-sm truncate">{feed.name}</span>
                          <span className="text-[0.6rem] text-muted truncate">{feed.url}</span>
                        </div>
                        <button 
                          onClick={() => removeRssFeed(feed.url)}
                          className="text-muted hover:text-accent p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    ))
                  )}
                </div>
              </div>
              <div className="p-4 bg-cream border-t border-ink text-right">
                <button 
                  className="btn-fetch" 
                  onClick={() => {
                    setShowRssManager(false);
                    fetchRssItems();
                  }}
                >
                  保存并刷新
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Passcode Modal (Secret Lock) */}
      <AnimatePresence>
        {showAdminPasswordModal && (
          <motion.div 
            className="fixed inset-0 bg-black/85 z-[310] flex items-center justify-center p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div 
              className="bg-paper border border-ink w-full max-w-sm flex flex-col shadow-2xl overflow-hidden"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="p-5 border-b border-ink bg-cream relative flex flex-col justify-center items-center text-center">
                <div className="w-12 h-12 rounded-full border border-ink flex items-center justify-center bg-gold/10 text-xl mb-2 text-gold animate-bounce">
                  🔒
                </div>
                <h3 className="font-black text-lg font-display">管理员核心授权</h3>
                <p className="text-[0.7rem] text-muted font-mono tracking-wide mt-1 uppercase">Commentary Radar Suite Security</p>
                <button 
                  onClick={() => setShowAdminPasswordModal(false)}
                  className="absolute top-4 right-4 text-sm hover:opacity-75 cursor-pointer font-mono"
                >
                  ✕
                </button>
              </div>

              <form onSubmit={handleAdminPasswordSubmit} className="p-6 flex flex-col gap-4 bg-paper">
                <div className="flex flex-col gap-1.5">
                  <label className="text-[0.65rem] font-bold text-muted uppercase tracking-wider">通行密码 (Passcode)</label>
                  <input 
                    type="password"
                    autoComplete="off"
                    placeholder="请输入安全密钥..."
                    className="w-full bg-white border border-border text-center text-lg tracking-widest py-2.5 px-3 focus:border-ink font-mono outline-none"
                    value={adminPasswordInput}
                    onChange={(e) => {
                      setAdminPasswordInput(e.target.value);
                      if (adminPasswordError) setAdminPasswordError('');
                    }}
                    autoFocus
                  />
                  {adminPasswordError && (
                    <span className="text-[0.65rem] text-accent font-bold mt-1 text-center font-mono">
                      {adminPasswordError}
                    </span>
                  )}
                </div>

                {/* Preset key helpers for easy tapping on mobile */}
                <div className="grid grid-cols-3 gap-2 mt-1">
                  {['1', '2', '3', '4', '5', '6', '7', '8', '0'].map(num => (
                    <button
                      key={num}
                      type="button"
                      onClick={() => {
                        setAdminPasswordInput(prev => prev + num);
                        if (adminPasswordError) setAdminPasswordError('');
                      }}
                      className="bg-cream border border-border py-2 text-sm font-bold font-mono active:bg-ink active:text-paper hover:bg-cream/50 cursor-pointer transition-colors"
                    >
                      {num}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={() => setAdminPasswordInput('')}
                    className="bg-[#FFF0F0] border border-red-200 text-red-600 py-2 text-xs font-bold active:bg-red-100 cursor-pointer transition-colors col-span-1"
                  >
                    重置
                  </button>
                  <button
                    type="button"
                    onClick={() => setAdminPasswordInput(prev => prev.slice(0, -1))}
                    className="bg-cream border border-border py-2 text-xs font-bold active:bg-ink active:text-paper cursor-pointer transition-colors col-span-2"
                  >
                    ← 退格
                  </button>
                </div>

                <div className="flex gap-2.5 mt-2">
                  <button 
                    type="button" 
                    onClick={() => setShowAdminPasswordModal(false)}
                    className="btn-fetch flex-1 !bg-cream !text-ink border border-ink py-2 text-xs"
                  >
                    取消
                  </button>
                  <button 
                    type="submit" 
                    className="btn-fetch flex-1 !bg-ink !text-paper border border-ink py-2 text-xs font-bold"
                  >
                    验证通行
                  </button>
                </div>
              </form>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Admin Console Modal */}
      <AnimatePresence>
        {showAdminConsole && (
          <motion.div 
            className="fixed inset-0 bg-black/80 z-[300] flex items-center justify-center p-4 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div 
              className="bg-paper border border-ink w-full max-w-5xl h-[85vh] flex flex-col shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="p-6 border-b border-ink flex justify-between items-center bg-cream">
                <div className="flex items-center gap-2">
                  <h3 className="font-black text-xl font-display">🛡️ 决策与内容审计后台 (Admin Suite)</h3>
                  <span className="text-[0.6rem] bg-amber-100 border border-amber-300 text-amber-800 px-1 py-0.5 font-mono uppercase rounded font-bold">Live Core</span>
                </div>
                <button onClick={() => setShowAdminConsole(false)} className="text-2xl hover:rotate-90 transition-transform cursor-pointer">✕</button>
              </div>

              <div className="flex-1 overflow-y-auto p-6 flex flex-col gap-6 bg-[#FAF9F5]">
                
                {/* Dynamic Stats Cards */}
                {(() => {
                  const stats = getAuditStats();
                  const total = adminLogs.length;
                  return (
                    <>
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                        <div className="bg-white border border-border p-4 shadow-sm relative overflow-hidden">
                          <span className="text-muted text-[0.65rem] tracking-wider uppercase font-bold block mb-1">总触发次数</span>
                          <span className="text-3xl font-black font-mono text-ink">{total}</span>
                          <div className="absolute right-2 bottom-2 text-ink/10 font-bold text-5xl select-none font-mono">#</div>
                        </div>

                        <div className="bg-white border border-border p-4 shadow-sm relative overflow-hidden">
                          <span className="text-muted text-[0.65rem] tracking-wider uppercase font-bold block mb-1">AI排版写作/自由创作</span>
                          <span className="text-3xl font-black font-mono text-accent">{stats.counts.writing}</span>
                          <div className="absolute right-2 bottom-2 text-accent/10 font-bold text-5xl select-none font-mono">✍</div>
                        </div>

                        <div className="bg-white border border-border p-4 shadow-sm relative overflow-hidden">
                          <span className="text-gold border-gold/10 text-[0.65rem] tracking-wider uppercase font-bold block mb-1">事实核查审计</span>
                          <span className="text-3xl font-black font-mono text-gold">{stats.counts.factcheck}</span>
                          <div className="absolute right-2 bottom-2 text-gold/10 font-bold text-5xl select-none font-mono">🔍</div>
                        </div>

                        <div className="bg-white border border-border p-4 shadow-sm relative overflow-hidden">
                          <span className="text-blue-500 text-[0.65rem] tracking-wider uppercase font-bold block mb-1">AI热榜筛选</span>
                          <span className="text-3xl font-black font-mono text-sky-600">{stats.counts.analysis}</span>
                          <div className="absolute right-2 bottom-2 text-sky-500/10 font-bold text-5xl select-none font-mono">⚡</div>
                        </div>
                      </div>

                      {/* Distribution breakdown progress bars */}
                      {total > 0 && (
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                          
                          {/* Stances */}
                          <div className="bg-white border border-border p-4 shadow-sm flex flex-col gap-3">
                            <h4 className="font-bold text-xs uppercase text-ink border-b border-border pb-1">⚖️ 时评立场(Persona)分布</h4>
                            <div className="flex flex-col gap-2 mt-1">
                              {Object.keys(stats.stances).length === 0 ? (
                                <div className="text-[0.65rem] italic text-muted text-center py-4">暂无立场偏好数据</div>
                              ) : (
                                Object.entries(stats.stances).map(([stance, count]) => {
                                  const pct = stats.counts.writing > 0 ? Math.round((count / stats.counts.writing) * 100) : 0;
                                  return (
                                    <div key={stance} className="flex flex-col gap-1">
                                      <div className="flex justify-between text-xs font-mono">
                                        <span>{stance}</span>
                                        <span className="font-bold">{count}次 ({pct}%)</span>
                                      </div>
                                      <div className="w-full bg-cream h-2 border border-border rounded-sm overflow-hidden">
                                        <div className="bg-gold h-full" style={{ width: `${pct}%` }} />
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>

                          {/* Styles */}
                          <div className="bg-white border border-border p-4 shadow-sm flex flex-col gap-3">
                            <h4 className="font-bold text-xs uppercase text-ink border-b border-border pb-1">📝 写作主导模式选择</h4>
                            <div className="flex flex-col gap-2 mt-1">
                              {Object.keys(stats.styles).length === 0 ? (
                                <div className="text-[0.65rem] italic text-muted text-center py-4">暂无模式偏好数据</div>
                              ) : (
                                Object.entries(stats.styles).map(([style, count]) => {
                                  const pct = stats.counts.writing > 0 ? Math.round((count / stats.counts.writing) * 100) : 0;
                                  return (
                                    <div key={style} className="flex flex-col gap-1">
                                      <div className="flex justify-between text-xs font-mono">
                                        <span>{style}</span>
                                        <span className="font-bold">{count}次 ({pct}%)</span>
                                      </div>
                                      <div className="w-full bg-cream h-2 border border-border rounded-sm overflow-hidden">
                                        <div className="bg-ink h-full" style={{ width: `${pct}%` }} />
                                      </div>
                                    </div>
                                  );
                                })
                              )}
                            </div>
                          </div>

                        </div>
                      )}
                    </>
                  );
                })()}

                {/* Search & Audit Table Core */}
                <div className="bg-white border border-border flex-1 flex flex-col shadow-sm">
                  
                  {/* Table Toolbar */}
                  <div className="p-4 border-b border-border flex flex-wrap gap-4 items-center justify-between bg-cream">
                    
                    {/* SearchInput */}
                    <div className="flex items-center gap-2 flex-1 max-w-md">
                      <span className="text-xs font-bold text-muted uppercase">筛选日志</span>
                      <input 
                        type="text" 
                        placeholder="根据操作、选题标题或AI模型进行筛选..."
                        className="flex-1 bg-white border border-border text-xs py-1.5 px-3 focus:border-ink font-sans"
                        value={adminSearchTerm}
                        onChange={(e) => setAdminSearchTerm(e.target.value)}
                      />
                      {adminSearchTerm && (
                        <button 
                          className="text-xs text-muted hover:text-ink font-mono px-1"
                          onClick={() => setAdminSearchTerm('')}
                        >
                          清除
                        </button>
                      )}
                    </div>

                    <div className="flex items-center gap-2">
                      <button 
                        onClick={exportAdminLogs}
                        className="text-xs bg-ink text-paper border border-ink py-1.5 px-3 font-bold uppercase hover:bg-opacity-90 flex items-center gap-1.5 cursor-pointer"
                      >
                        📤 导出审计日志 (JSON)
                      </button>
                      <button 
                        onClick={clearAdminLogs}
                        className="text-xs border border-red-500 text-red-600 py-1.5 px-3 font-bold uppercase hover:bg-red-50 cursor-pointer"
                      >
                        🗑️ 永久清空
                      </button>
                    </div>

                  </div>

                  {/* Log rows scroll */}
                  <div className="flex-1 overflow-y-auto">
                    {(() => {
                      const filtered = adminLogs.filter(log => {
                        const term = adminSearchTerm.trim().toLowerCase();
                        if (!term) return true;
                        return (log.action || '').toLowerCase().includes(term) ||
                               (log.title || '').toLowerCase().includes(term) ||
                               (log.operator || '').toLowerCase().includes(term) ||
                               (log.draftMeta || '').toLowerCase().includes(term);
                      });

                      if (filtered.length === 0) {
                        return (
                          <div className="text-center py-16 text-muted italic text-xs">
                            {adminLogs.length === 0 ? "暂无审计日志，进行AI写作或安全审查即可自动记录..." : "没有符合筛选条件的日志记录"}
                          </div>
                        );
                      }

                      return (
                        <table className="w-full text-left border-collapse">
                          <thead>
                            <tr className="bg-cream/40 border-b border-border text-[0.65rem] font-bold text-muted uppercase tracking-wider">
                              <th className="py-2.5 px-4 font-mono w-12 text-center">No.</th>
                              <th className="py-2.5 px-4 w-24">触发时间</th>
                              <th className="py-2.5 px-4 w-32">操作人 (UID)</th>
                              <th className="py-2.5 px-4 w-24">模块/动作</th>
                              <th className="py-2.5 px-4">题材/标题</th>
                              <th className="py-2.5 px-4 font-mono w-24 text-right">参考信源</th>
                              <th className="py-2.5 px-4 text-center w-24">文章缓存</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border text-xs">
                            {filtered.map((log, idx) => {
                              let actionBadgeClass = 'bg-cream text-muted';
                              if (log.action === 'AI选题分析') {
                                actionBadgeClass = 'bg-sky-50 text-sky-700 border border-sky-200';
                              } else if (log.action === '开始排版写作' || log.action === '自由创作写作') {
                                actionBadgeClass = 'bg-green-50 text-green-700 border border-green-200';
                              } else if (log.action === '事实核查') {
                                actionBadgeClass = 'bg-purple-50 text-purple-700 border border-purple-200';
                              } else if (log.action === '保存到草稿箱') {
                                actionBadgeClass = 'bg-amber-50 text-amber-700 border border-amber-200';
                              }

                              return (
                                <tr key={log.id} className="hover:bg-cream/30 transition-colors">
                                  <td className="py-3 px-4 text-[0.65rem] text-muted font-mono text-center">{filtered.length - idx}</td>
                                  <td className="py-3 px-4 text-[0.7rem] text-muted whitespace-nowrap font-mono">
                                    {(() => {
                                      try {
                                        const d = new Date(log.timestamp);
                                        const mm = String(d.getMonth() + 1).padStart(2, '0');
                                        const dd = String(d.getDate()).padStart(2, '0');
                                        const hh = String(d.getHours()).padStart(2, '0');
                                        const min = String(d.getMinutes()).padStart(2, '0');
                                        return `${mm}-${dd} ${hh}:${min}`;
                                      } catch (e) {
                                        return log.timestamp;
                                      }
                                    })()}
                                  </td>
                                  <td className="py-3 px-4 font-mono text-[0.65rem] text-muted whitespace-nowrap" title={log.operator || "guest"}>
                                    {log.operator || "guest"}
                                  </td>
                                  <td className="py-3 px-4">
                                    <span className={`text-[0.65rem] font-bold px-1.5 py-0.5 rounded capitalize ${actionBadgeClass}`}>
                                      {log.action}
                                    </span>
                                  </td>
                                  <td className="py-3 px-4 font-bold text-ink pr-6">
                                    <div className="line-clamp-1 max-w-xs" title={log.title}>{log.title || '空'}</div>
                                  </td>
                                  <td className="py-3 px-4 font-mono text-right text-[0.65rem] text-muted whitespace-nowrap">
                                    {log.referencesCount > 0 ? (
                                      <span className="bg-cream px-1 border border-border" title="参考信源">{log.referencesCount} ref</span>
                                    ) : (
                                      <span className="text-muted text-[0.65rem] font-mono">-</span>
                                    )}
                                  </td>
                                  <td className="py-3 px-4 text-center">
                                    {log.articleBody ? (
                                      <button
                                        onClick={() => setSelectedLogCache(log)}
                                        className="text-[0.65rem] bg-cream border border-border py-1 px-2 font-bold cursor-pointer hover:bg-ink hover:text-paper hover:border-ink transition-colors flex items-center gap-1 mx-auto whitespace-nowrap shadow-xs"
                                      >
                                        📄 查阅
                                      </button>
                                    ) : (
                                      <span className="text-muted text-[0.65rem] font-mono">-</span>
                                    )}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      );
                    })()}
                  </div>

                </div>

              </div>
              <div className="p-4 bg-cream border-t border-ink text-right">
                <button 
                  className="btn-fetch" 
                  onClick={() => setShowAdminConsole(false)}
                >
                  关闭后台
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Article Cache Viewer Modal */}
      <AnimatePresence>
        {selectedLogCache && (
          <motion.div 
            className="fixed inset-0 bg-black/80 z-[350] flex items-center justify-center p-4 backdrop-blur-xs"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div 
              className="bg-paper border border-ink w-full max-w-3xl h-[85vh] flex flex-col shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="p-4 border-b border-ink flex justify-between items-center bg-cream">
                <div>
                  <span className="text-[0.65rem] uppercase font-bold tracking-wider text-muted block">
                    📜 全局审计版次控制和文章存档
                  </span>
                  <h3 className="font-black text-sm text-ink line-clamp-1" title={selectedLogCache.title}>
                    【存档】{selectedLogCache.title || '无特定选题'}
                  </h3>
                </div>
                <button 
                  onClick={() => setSelectedLogCache(null)} 
                  className="text-lg font-mono hover:text-accent font-bold p-1 cursor-pointer"
                >
                  ✕
                </button>
              </div>

              {/* Log Metadata Header Row */}
              <div className="bg-cream/40 px-6 py-4 border-b border-border grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs font-mono">
                <div>
                  <span className="text-muted block text-[0.65rem] uppercase font-bold">操作员 (Operator)</span>
                  <span className="font-bold text-ink">{selectedLogCache.operator || 'guest'}</span>
                </div>
                <div>
                  <span className="text-muted block text-[0.65rem] uppercase font-bold">保存时间 (Backup Time)</span>
                  <span className="font-bold text-ink">
                    {(() => {
                      try {
                        return new Date(selectedLogCache.timestamp).toLocaleString('zh-CN', { hour12: false });
                      } catch (e) {
                        return selectedLogCache.timestamp;
                      }
                    })()}
                  </span>
                </div>
                <div>
                  <span className="text-muted block text-[0.65rem] uppercase font-bold">动作类型</span>
                  <span className="font-bold text-ink">{selectedLogCache.action}</span>
                </div>
                <div>
                  <span className="text-muted block text-[0.65rem] uppercase font-bold">统计字数</span>
                  <span className="font-bold text-ink">{selectedLogCache.wordCount || selectedLogCache.articleBody?.length || 0} 字</span>
                </div>
              </div>

              {/* Article Content Viewer */}
              <div className="flex-1 overflow-y-auto p-6 bg-paper selection:bg-accent selection:text-paper font-sans">
                <div className="prose max-w-none text-ink text-sm">
                  <div className="draft-body leading-relaxed whitespace-pre-wrap font-sans text-xs sm:text-sm" dangerouslySetInnerHTML={renderDraftBody(selectedLogCache.articleBody || '')}></div>
                </div>
              </div>

              {/* Console Action Bar */}
              <div className="p-4 bg-cream border-t border-ink flex flex-wrap gap-4 items-center justify-between">
                <div className="text-[0.65rem] text-muted italic">
                  * 缓存由本地审计模块自动记录，本段文本仅在客户端及会话持久化存储。
                </div>
                <div className="flex items-center gap-2">
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(selectedLogCache.articleBody || '');
                      setStatusBar('✓ 缓存文本已复制到剪贴板');
                      setTimeout(() => setStatusBar('就绪'), 2000);
                      alert('已成功复制存档正文！');
                    }}
                    className="text-xs border border-ink bg-white hover:bg-ink hover:text-paper py-1.5 px-3 font-semibold uppercase cursor-pointer"
                  >
                    📋 复制正文纯文本
                  </button>
                  <button 
                    onClick={() => {
                      if (window.confirm(`确认要将当前缓存的"${selectedLogCache.title}"还原到排版写作区域吗？这会覆盖你当前正在起草的内容。`)) {
                        setDraftTitle(selectedLogCache.title);
                        setDraftBody(selectedLogCache.articleBody);
                        setWordCount(selectedLogCache.articleBody?.length || 0);
                        setShowDraft(true);
                        setSelectedLogCache(null);
                        setShowAdminConsole(false);
                        setStatusBar('✓ 已从审计日志中恢复副本');
                        setTimeout(() => setStatusBar('就绪'), 2000);
                      }
                    }}
                    className="text-xs bg-ink text-paper border border-ink py-1.5 px-3 font-bold uppercase hover:bg-opacity-90 cursor-pointer"
                  >
                    ⚡ 还原到当前写作间
                  </button>
                  <button 
                    onClick={() => setSelectedLogCache(null)} 
                    className="text-xs border border-border bg-white text-muted py-1.5 px-3 uppercase hover:text-ink cursor-pointer"
                  >
                    关闭
                  </button>
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Drafts List Modal */}
      <AnimatePresence>
        {showDraftsList && (
          <motion.div 
            className="fixed inset-0 bg-black/80 z-[300] flex items-center justify-center p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <motion.div 
              className="bg-paper border border-ink w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl"
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
            >
              <div className="p-6 border-b border-ink flex justify-between items-center bg-cream">
                <h3 className="font-black text-xl font-display">📁 我的草稿箱</h3>
                <button onClick={() => setShowDraftsList(false)} className="text-2xl hover:rotate-90 transition-transform">✕</button>
              </div>
              <div className="flex-1 overflow-y-auto p-6">
                {drafts.length === 0 ? (
                  <div className="text-center py-12 text-muted italic">暂无草稿</div>
                ) : (
                  <div className="grid gap-6">
                    {drafts.map(d => (
                      <motion.div 
                        key={d.id} 
                        className="border border-border p-5 hover:bg-cream transition-colors group relative cursor-pointer"
                        whileHover={{ x: 4 }}
                        onClick={() => loadDraft(d)}
                      >
                        <div className="flex justify-between items-start mb-2">
                          <h4 className="font-bold text-lg flex-1 pr-4 font-display break-words leading-tight">{d.title}</h4>
                          <span className="text-[0.65rem] text-muted font-mono whitespace-nowrap">
                            {new Date(d.updatedAt).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-muted line-clamp-2 mb-4 font-serif">{d.body.replace(/<[^>]*>/g, '').substring(0, 120)}...</p>
                        <div className="flex gap-3">
                          <button 
                            onClick={(e) => { e.stopPropagation(); loadDraft(d); }}
                            className="text-[0.7rem] bg-ink text-paper px-4 py-1.5 font-bold uppercase tracking-wider hover:opacity-80"
                          >
                            加载草稿
                          </button>
                          {deletingId === d.id ? (
                            <>
                              <button 
                                onClick={(e) => { e.stopPropagation(); deleteDraft(d.id); }}
                                className="text-[0.7rem] bg-red-600 text-white px-4 py-1.5 font-bold uppercase tracking-wider hover:bg-red-700"
                              >
                                确认删除
                              </button>
                              <button 
                                onClick={(e) => { e.stopPropagation(); setDeletingId(null); }}
                                className="text-[0.7rem] border border-ink px-4 py-1.5 font-bold uppercase tracking-wider hover:bg-gray-100"
                              >
                                取消
                              </button>
                            </>
                          ) : (
                            <button 
                              type="button"
                              onClick={(e) => { e.stopPropagation(); setDeletingId(d.id); }}
                              className="text-[0.7rem] border border-red-500 text-red-500 px-4 py-1.5 font-bold uppercase tracking-wider hover:bg-red-50"
                            >
                              删除
                            </button>
                          )}
                        </div>
                      </motion.div>
                    ))}
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {selectedMaterial && (
          <motion.div 
            className="fixed inset-0 z-[1000] flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedMaterial(null)}
          >
            <motion.div 
              className="bg-paper w-full max-w-2xl max-h-[80vh] rounded-xl shadow-2xl flex flex-col overflow-hidden"
              initial={{ scale: 0.9, opacity: 0, y: 20 }}
              animate={{ scale: 1, opacity: 1, y: 0 }}
              exit={{ scale: 0.9, opacity: 0, y: 20 }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="p-4 border-b border-border flex justify-between items-center bg-cream">
                <h3 className="font-bold text-ink truncate mr-4">素材详情：{selectedMaterial.title}</h3>
                <button onClick={() => setSelectedMaterial(null)} className="text-ink hover:text-accent text-xl transition-colors">✕</button>
              </div>
              <div className="p-6 overflow-y-auto text-sm leading-relaxed whitespace-pre-wrap font-sans text-ink/80 bg-white">
                {selectedMaterial.content}
              </div>
              <div className="p-3 border-t border-border bg-cream flex justify-end">
                <button 
                  onClick={() => setSelectedMaterial(null)}
                  className="px-4 py-1.5 bg-ink text-white rounded text-xs font-bold hover:bg-black transition-colors"
                >
                  关闭
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {showAudioToast && (
          <motion.div 
            initial={{ opacity: 0, y: 20, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, scale: 0.9 }}
            className="fixed bottom-16 left-1/2 -translate-x-1/2 z-[500] bg-ink text-cream px-4 py-2 rounded-full shadow-2xl flex items-center gap-2 border border-accent/30"
          >
            <div className="w-2 h-2 bg-accent rounded-full animate-pulse" />
            <span className="text-xs font-bold tracking-widest uppercase">Notification</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
