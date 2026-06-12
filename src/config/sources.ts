/**
 * 权威信源白名单配置
 * 前后端共享，用于搜索结果的来源权威性分级
 *
 * 分级标准：
 *   high   - 国内外顶级权威媒体、官方通讯社、政府机构
 *   medium - 知名垂直媒体、行业研究机构
 *   unknown - 不在白名单中的来源，前端标记为"存疑"
 */

export const AUTHORITY_WHITELIST: Record<string, string[]> = {
  high: [
    // 国内顶级权威
    'caixin.com',
    'yicai.com',
    'eeo.com.cn',
    'xinhuanet.com',
    'people.com.cn',
    'thepaper.cn',
    'cctv.com',
    'chinanews.com',
    'inewsweek.cn',
    'caijing.com.cn',
    'nbd.com.cn',
    '21jingji.com',
    'jiemian.com',
    // 国际顶级权威
    'reuters.com',
    'bloomberg.com',
    'ft.com',
    'wsj.com',
    'nytimes.com',
    'economist.com',
    'washingtonpost.com',
    'bbc.com',
    'apnews.com',
    'npr.org',
  ],
  medium: [
    // 国内知名垂直媒体
    '36kr.com',
    'huxiu.com',
    'tmtpost.com',
    'latepost.com',
    'geekpark.net',
    'cls.cn',
    'stcn.com',
    'guancha.cn',
    'thepaper.cn',
    // 国际知名科技/商业媒体
    'techcrunch.com',
    'wired.com',
    'theverge.com',
    'arstechnica.com',
    'fortune.com',
    'cnbc.com',
    'businessinsider.com',
    'forbes.com',
    'fastcompany.com',
    'axios.com',
    'vox.com',
  ],
};

/**
 * 根据 URL 或来源名称判断权威级别
 */
export function classifySource(
  urlOrSource: string
): 'high' | 'medium' | 'unknown' {
  const normalized = urlOrSource.toLowerCase();
  for (const level of ['high', 'medium'] as const) {
    if (
      AUTHORITY_WHITELIST[level].some((domain) =>
        normalized.includes(domain)
      )
    ) {
      return level;
    }
  }
  return 'unknown';
}

/**
 * 权威级别对应的中文标签和颜色类名
 */
export const AUTHORITY_LABELS: Record<
  string,
  { label: string; bgClass: string; textClass: string }
> = {
  high: {
    label: '一级权威',
    bgClass: 'bg-green-50',
    textClass: 'text-green-700',
  },
  medium: {
    label: '二级可信',
    bgClass: 'bg-blue-50',
    textClass: 'text-blue-600',
  },
  unknown: {
    label: '来源存疑',
    bgClass: 'bg-amber-50',
    textClass: 'text-amber-600',
  },
};
