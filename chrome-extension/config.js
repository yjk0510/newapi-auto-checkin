// 默认站点配置（首次安装时写入 storage）
const DEFAULT_SITES = [
  { domain: 'test.com', name: 'test.com', enabled: true }
];

// 全局配置
const GLOBAL_CONFIG = {
  autoSignTime: '09:00',
  retryTimes: 2,
  requestTimeout: 10000
};

// WebDAV 默认配置
const WEBDAV_DEFAULTS = {
  enabled: false,
  url: '',
  username: '',
  password: '',
  filename: 'checkin-config.json',
  autoSync: false,       // 配置变更后自动同步
  periodicSync: false,   // 启用定时同步
  syncInterval: 60       // 定时同步间隔（分钟）
};

// 从域名生成完整站点配置（所有 New API 站点通用）
function buildSiteConfig(site) {
  const d = site.domain;
  return {
    siteId: d.replace(/\./g, '_'),
    siteName: site.name || d,
    enabled: site.enabled !== false,
    cookieDomain: d,
    signExecUrl: `https://${d}/api/user/checkin`,
    signExecMethod: 'POST',
    signExecParams: {},
    signQueryUrl: `https://${d}/api/user/checkin`,
    signQueryMethod: 'GET',
    cookieTestUrl: `https://${d}/`,
    unauthKeywords: ['未登录', '请登录']
  };
}

// 从 storage 加载站点列表
async function loadSitesConfig() {
  const data = await chrome.storage.local.get('userSites');
  const sites = data.userSites || DEFAULT_SITES;
  return sites.map(buildSiteConfig);
}

// 保存站点列表到 storage
async function saveSitesConfig(sites) {
  await chrome.storage.local.set({ userSites: sites });
}

// 读取原始站点列表（简化格式）
async function loadRawSites() {
  const data = await chrome.storage.local.get('userSites');
  return data.userSites || DEFAULT_SITES;
}

// ─── WebDAV 配置存取 ──────────────────────────────────────────

async function loadWebdavConfig() {
  const data = await chrome.storage.local.get('webdavConfig');
  return data.webdavConfig || WEBDAV_DEFAULTS;
}

async function saveWebdavConfig(config) {
  await chrome.storage.local.set({ webdavConfig: config });
}

// ─── WebDAV 同步核心 ──────────────────────────────────────────

function buildWebdavUrl(cfg) {
  let base = cfg.url.replace(/\/+$/, '');
  if (!base) return null;
  return base + '/' + encodeURIComponent(cfg.filename);
}

function buildAuthHeader(cfg) {
  if (!cfg.username || !cfg.password) return null;
  return 'Basic ' + btoa(cfg.username + ':' + cfg.password);
}

/**
 * 上传站点配置到 WebDAV 服务器
 * @returns {{success: boolean, message: string}}
 */
async function webdavUpload(cfg) {
  const url = buildWebdavUrl(cfg);
  if (!url) return { success: false, message: 'WebDAV 地址未配置' };

  const auth = buildAuthHeader(cfg);
  const sites = await loadRawSites();

  const payload = {
    version: '1.0',
    syncTime: new Date().toISOString(),
    sites
  };

  try {
    const res = await fetch(url, {
      method: 'PUT',
      headers: {
        'Authorization': auth || '',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload, null, 2)
    });

    if (res.ok) {
      return { success: true, message: `配置已上传 (${sites.length} 个站点)` };
    }
    return { success: false, message: `上传失败: HTTP ${res.status}` };
  } catch (e) {
    return { success: false, message: `上传失败: ${e.message}` };
  }
}

/**
 * 从 WebDAV 服务器下载站点配置
 * @returns {{success: boolean, message: string, config?: object}}
 */
async function webdavDownload(cfg) {
  const url = buildWebdavUrl(cfg);
  if (!url) return { success: false, message: 'WebDAV 地址未配置' };

  const auth = buildAuthHeader(cfg);

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { 'Authorization': auth || '' }
    });

    if (!res.ok) {
      if (res.status === 404) {
        return { success: false, message: '服务器上未找到配置文件' };
      }
      return { success: false, message: `下载失败: HTTP ${res.status}` };
    }

    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      return { success: false, message: '配置文件格式错误' };
    }

    if (!data.sites || !Array.isArray(data.sites)) {
      return { success: false, message: '配置文件缺少 sites 字段' };
    }

    // 验证站点格式
    const validSites = data.sites.filter(s => s.domain && typeof s.domain === 'string');
    return { success: true, message: `下载成功 (${validSites.length} 个站点)`, config: { sites: validSites } };
  } catch (e) {
    return { success: false, message: `下载失败: ${e.message}` };
  }
}

/**
 * 测试 WebDAV 连接
 * @returns {{success: boolean, message: string}}
 */
async function webdavTest(cfg) {
  const url = buildWebdavUrl(cfg);
  if (!url) return { success: false, message: 'WebDAV 地址未配置' };

  const auth = buildAuthHeader(cfg);

  try {
    // 先用 HEAD 测试连通性
    const headRes = await fetch(url, {
      method: 'HEAD',
      headers: { 'Authorization': auth || '' }
    });

    // HEAD 成功（200）或文件不存在（404）都说明服务器可达
    if (headRes.ok || headRes.status === 404) {
      return { success: true, message: headRes.status === 404
        ? 'WebDAV 连接正常，配置文件尚未创建'
        : 'WebDAV 连接正常，配置文件已存在' };
    }

    if (headRes.status === 401 || headRes.status === 403) {
      return { success: false, message: '认证失败，请检查用户名和密码' };
    }

    return { success: false, message: `连接失败: HTTP ${headRes.status}` };
  } catch (e) {
    return { success: false, message: `连接失败: ${e.message}` };
  }
}
