import { Router } from 'express';
import { getDb } from '../db/init.js';
import { authMiddleware, adminMiddleware } from '../middleware/auth.js';
import { normalizeRemoteBaseUrl } from '../middleware/remoteProxy.js';
import { resolveProductByItem, applyProductToOrder } from '../services/productResolve.js';

const router = Router();
const DEFAULT_COLLECTOR_BASE_URL = process.env.COLLECTOR_BASE_URL || 'http://127.0.0.1:5069';
const REMOTE_ERP_BASE_URL = normalizeRemoteBaseUrl(process.env.ERP_REMOTE_BASE_URL);
const IS_BRIDGE_MODE = Boolean(REMOTE_ERP_BASE_URL);
const COLLECTOR_CONTROL_ENABLED = process.env.ERP_ENABLE_LOCAL_COLLECTOR_CONTROLS !== '0' || IS_BRIDGE_MODE;
const POLL_HEARTBEAT_MS = 10 * 1000;
const MAX_POLL_JITTER_MS = 5 * 60 * 1000;
const MAX_OVERDUE_STAGGER_MS = 2 * 60 * 1000;
const POLL_INTERVALS = [30, 60];
const pollState = {
  loaded: false,
  enabled: false,
  running: false,
  intervalMinutes: 30,
  userId: null,
  token: null,
  timer: null,
  nextRunByShop: new Map(),
  lastCheck: null,
  lastRun: null,
  lastError: null,
};

async function bridgeAuthMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ message: '未登录，请先登录服务器账号' });
  }

  try {
    const response = await fetch(`${REMOTE_ERP_BASE_URL}/api/auth/me`, {
      headers: { Authorization: authHeader, Accept: 'application/json' },
    });
    const body = await response.json().catch(() => null);
    if (!response.ok || !body?.user) {
      return res.status(401).json({ message: body?.message || '服务器登录已失效，请重新登录' });
    }
    req.user = body.user;
    next();
  } catch (err) {
    return res.status(502).json({ message: '无法连接远程 ERP 鉴权服务', detail: err.message });
  }
}

router.use(IS_BRIDGE_MODE ? bridgeAuthMiddleware : authMiddleware);

function normalizeCollectorBaseUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  return url || DEFAULT_COLLECTOR_BASE_URL;
}

function getCollectorBaseUrl() {
  const db = getDb();
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('collector_base_url');
  return normalizeCollectorBaseUrl(row?.value);
}

async function collectorRequest(path, options = {}) {
  const url = `${getCollectorBaseUrl()}${path}`;
  const response = await fetch(url, {
    ...options,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    const message = body?.message || body?.error || `采集器接口失败：${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

function buildCollectorShopEnsurePayload(shop, fallback = {}) {
  const platform = String(fallback.platform || shop?.platform || '').trim();
  if (!['taobao', 'jd'].includes(platform)) return null;

  return {
    platform,
    shopName: String(
      fallback.shop_name
      || fallback.shopName
      || fallback.real_name
      || fallback.name
      || shop?.real_name
      || shop?.name
      || '',
    ).trim(),
  };
}

async function ensureLocalCollectorShop(shop, fallback = {}) {
  const collectorShopId = String(shop?.collector_shop_id || fallback.collector_shop_id || '').trim();
  if (!collectorShopId) return null;

  const payload = buildCollectorShopEnsurePayload(shop, fallback);
  if (!payload) return null;

  try {
    return await collectorRequest(`/api/shops/${collectorShopId}/ensure`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  } catch (err) {
    if (err.status === 404 || err.status === 405) return null;
    throw err;
  }
}

async function remoteApiRequest(req, path, options = {}) {
  if (!IS_BRIDGE_MODE) return null;

  const url = `${REMOTE_ERP_BASE_URL}${path}`;
  const response = await fetch(url, {
    method: options.method || 'GET',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: req.headers.authorization || '',
      ...(options.headers || {}),
    },
    body: options.body === undefined
      ? undefined
      : (typeof options.body === 'string' ? options.body : JSON.stringify(options.body)),
  });

  const text = await response.text();
  let body = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { raw: text };
    }
  }

  if (!response.ok) {
    const message = body?.message || body?.error || `远程 ERP 接口失败：${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.body = body;
    throw error;
  }

  return body;
}

async function syncCollectorShopsToRemote(req, collectorShops) {
  if (!IS_BRIDGE_MODE) return null;
  return await remoteApiRequest(req, '/api/collector/ingest/shops', {
    method: 'POST',
    body: { shops: normalizeCollectorShopList(collectorShops) },
  });
}

async function syncOrdersToRemote(req, shop, orders, collectorResult, full) {
  if (!IS_BRIDGE_MODE) return null;
  const collectedAt = normalizeTimestamp(collectorResult?.last_collect_at) || nowIso();
  return await remoteApiRequest(req, '/api/collector/ingest/orders', {
    method: 'POST',
    body: {
      collector_shop_id: shop.collector_shop_id,
      platform: shop.platform,
      shop_name: shop.real_name || shop.name,
      full: Boolean(full),
      collected_at: collectedAt,
      orders,
      collector: collectorResult,
    },
  });
}

async function reportCollectorIssueToRemote(req, issue) {
  if (!IS_BRIDGE_MODE || !req) return null;
  try {
    return await remoteApiRequest(req, '/api/collector/ingest/issues', {
      method: 'POST',
      body: issue,
    });
  } catch {
    return null;
  }
}

function normalizeIssueLevel(value) {
  return ['info', 'warning', 'error'].includes(value) ? value : 'error';
}

function isSecurityPausedResult(result) {
  const text = [
    result?.reason,
    result?.message,
    result?.note,
    result?.security_reason,
    result?.current_url,
    result?.url,
  ].filter(Boolean).join(' ');
  return result?.paused === true
    || result?.security_paused === true
    || /安全验证|滑块|验证码|x5sec|verify|captcha|security/i.test(text);
}

function securityPauseMessage(result) {
  return result?.security_reason
    || result?.reason
    || result?.message
    || result?.note
    || result?.current_url
    || '平台出现安全验证或滑块，需要人工处理后再恢复采集';
}

function insertCollectorIssue(db, issue, userId = null) {
  const collectorShopId = String(issue?.collector_shop_id || '').trim();
  const shop = collectorShopId ? getShopByCollectorId(db, collectorShopId) : null;
  const source = String(issue?.source || 'collector').slice(0, 80);
  const title = String(issue?.title || '采集异常').slice(0, 200);
  const message = String(issue?.message || issue?.error || '').slice(0, 1000);
  const level = normalizeIssueLevel(issue?.level);
  const platform = String(issue?.platform || shop?.platform || '').slice(0, 40);
  const details = typeof issue?.details === 'string'
    ? issue.details
    : JSON.stringify(issue?.details || issue || {});

  const existing = db.prepare(`
    SELECT id
    FROM collector_issues
    WHERE resolved = 0
      AND collector_shop_id = ?
      AND source = ?
      AND title = ?
    ORDER BY id DESC
    LIMIT 1
  `).get(collectorShopId, source, title);

  if (existing) {
    db.prepare(`
      UPDATE collector_issues SET
        level = ?,
        message = ?,
        shop_id = ?,
        platform = ?,
        details = ?,
        created_by = ?,
        created_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      level,
      message,
      shop?.id || issue?.shop_id || null,
      platform,
      details,
      userId,
      existing.id,
    );
    return db.prepare('SELECT * FROM collector_issues WHERE id = ?').get(existing.id);
  }

  const result = db.prepare(`
    INSERT INTO collector_issues (
      level, source, title, message, collector_shop_id, shop_id, platform, details, created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    level,
    source,
    title,
    message,
    collectorShopId,
    shop?.id || issue?.shop_id || null,
    platform,
    details,
    userId,
  );

  return db.prepare('SELECT * FROM collector_issues WHERE id = ?').get(result.lastInsertRowid);
}

function readLogAny(source, ...names) {
  for (const name of names) {
    if (source && source[name] !== undefined && source[name] !== null) return source[name];
  }
  return undefined;
}

function normalizeCollectorLogUpload(body = {}) {
  const logs = Array.isArray(readLogAny(body, 'logs', 'Logs')) ? readLogAny(body, 'logs', 'Logs') : [];
  const machineName = String(readLogAny(body, 'machine_name', 'machineName', 'MachineName') || '').trim();
  const clientId = String(readLogAny(body, 'client_id', 'clientId', 'ClientId') || '').trim();
  const collectorVersion = String(readLogAny(body, 'collector_version', 'collectorVersion', 'CollectorVersion') || '').trim();
  const reason = String(readLogAny(body, 'reason', 'Reason') || 'manual').trim();
  const activeSessions = Number(readLogAny(body, 'active_sessions', 'activeSessions', 'ActiveSessions') || 0);
  const shopCount = Number(readLogAny(body, 'shop_count', 'shopCount', 'ShopCount') || 0);
  const errorFiles = logs.filter((log) => String(readLogAny(log, 'kind', 'Kind') || '').toLowerCase() === 'error');
  const latestError = errorFiles[0] || null;
  const titleIdentity = machineName || clientId || 'unknown-client';
  const messageParts = [
    `files=${logs.length}`,
    `error_files=${errorFiles.length}`,
    `shops=${shopCount}`,
    `active_sessions=${activeSessions}`,
  ];
  if (collectorVersion) messageParts.push(`collector=${collectorVersion}`);
  if (latestError) messageParts.push(`latest_error=${String(readLogAny(latestError, 'file_name', 'fileName', 'FileName') || '').slice(0, 80)}`);

  return {
    level: errorFiles.length > 0 ? 'warning' : 'info',
    source: 'collector_log_upload',
    title: `客户端日志上传：${titleIdentity}`,
    message: messageParts.join(' | '),
    details: {
      ...body,
      normalized: {
        reason,
        machine_name: machineName,
        client_id: clientId,
        collector_version: collectorVersion,
        log_count: logs.length,
        error_file_count: errorFiles.length,
        active_sessions: activeSessions,
        shop_count: shopCount,
      },
    },
  };
}

function normalizePollIntervalMinutes(value) {
  const minutes = Number(value);
  return POLL_INTERVALS.includes(minutes) ? minutes : 30;
}

function pollIntervalMs() {
  return pollState.intervalMinutes * 60 * 1000;
}

function pollSpacingMs(shopCount) {
  return Math.max(POLL_HEARTBEAT_MS, Math.floor(pollIntervalMs() / Math.max(shopCount, 1)));
}

function initialPollDelayMs(index, spacingMs) {
  const slotJitterMs = Math.max(POLL_HEARTBEAT_MS, Math.floor(spacingMs / 2));
  return Math.max(POLL_HEARTBEAT_MS, (index * spacingMs) + randomInt(POLL_HEARTBEAT_MS, slotJitterMs + POLL_HEARTBEAT_MS));
}

function nextPollDelayMs() {
  const intervalMs = pollIntervalMs();
  const jitterMs = Math.max(POLL_HEARTBEAT_MS, Math.min(MAX_POLL_JITTER_MS, Math.floor(intervalMs * 0.1)));
  return intervalMs + randomInt(0, jitterMs);
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function parseScheduleTimestamp(value) {
  if (!value) return null;
  const text = String(value).trim();
  const normalized = text.includes(' ') ? text.replace(' ', 'T') : text;
  const time = Date.parse(normalized);
  return Number.isNaN(time) ? null : time;
}

function overduePollDelayMs(index, spacingMs) {
  const staggerMs = Math.min(MAX_OVERDUE_STAGGER_MS, Math.max(POLL_HEARTBEAT_MS, spacingMs));
  return index * staggerMs + randomInt(0, POLL_HEARTBEAT_MS);
}

function scheduledPollAt(shop, index, spacingMs, now = Date.now()) {
  const lastCollectAt = parseScheduleTimestamp(shop.last_collect_at);
  if (lastCollectAt) {
    const dueAt = lastCollectAt + pollIntervalMs();
    if (dueAt > now) {
      const jitterMs = Math.max(POLL_HEARTBEAT_MS, Math.min(MAX_POLL_JITTER_MS, Math.floor(pollIntervalMs() * 0.05)));
      return dueAt + randomInt(0, jitterMs);
    }
  }

  return now + overduePollDelayMs(index, spacingMs);
}

function loadPollingSettings(db) {
  if (pollState.loaded) return;
  pollState.loaded = true;
  if (!COLLECTOR_CONTROL_ENABLED) {
    pollState.enabled = false;
    stopPollingTimer();
    return;
  }
  const enabled = db.prepare('SELECT value FROM settings WHERE key = ?').get('collector_polling_enabled')?.value;
  const interval = db.prepare('SELECT value FROM settings WHERE key = ?').get('collector_polling_interval_minutes')?.value;
  const userId = db.prepare('SELECT value FROM settings WHERE key = ?').get('collector_polling_user_id')?.value;
  const token = db.prepare('SELECT value FROM settings WHERE key = ?').get('collector_polling_token')?.value;
  pollState.enabled = enabled === '1';
  pollState.intervalMinutes = normalizePollIntervalMinutes(interval);
  pollState.userId = Number(userId) || null;
  pollState.token = token || null;
  if (pollState.enabled) startPollingTimer();
}

function savePollingSettings(db) {
  const save = db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
  save.run('collector_polling_enabled', pollState.enabled ? '1' : '0');
  save.run('collector_polling_interval_minutes', String(pollState.intervalMinutes));
  save.run('collector_polling_user_id', String(pollState.userId || ''));
  save.run('collector_polling_token', pollState.token || '');
}

function getPollingUserId(db) {
  if (pollState.userId) return pollState.userId;
  return db.prepare("SELECT id FROM users WHERE role = 'admin' ORDER BY id LIMIT 1").get()?.id
    || db.prepare('SELECT id FROM users ORDER BY id LIMIT 1').get()?.id
    || 1;
}

function getPollingEligibleShops(db) {
  return db.prepare(`
    SELECT *
    FROM shops
    WHERE collector_shop_id != ''
      AND status != 0
      AND collector_status IN ('online', 'synced')
    ORDER BY id ASC
  `).all();
}

function ensurePollSchedule(db, reset = false) {
  const shops = getPollingEligibleShops(db);
  const validIds = new Set(shops.map((shop) => shop.collector_shop_id));
  for (const shopId of Array.from(pollState.nextRunByShop.keys())) {
    if (!validIds.has(shopId)) pollState.nextRunByShop.delete(shopId);
  }

  if (!pollState.enabled || shops.length === 0) return shops;

  const now = Date.now();
  const spacingMs = pollSpacingMs(shops.length);
  if (reset) {
    pollState.nextRunByShop.clear();
    shops.forEach((shop, index) => {
      pollState.nextRunByShop.set(shop.collector_shop_id, scheduledPollAt(shop, index, spacingMs, now));
    });
    return shops;
  }

  let newShopIndex = 0;
  for (const shop of shops) {
    if (pollState.nextRunByShop.has(shop.collector_shop_id)) continue;
    pollState.nextRunByShop.set(shop.collector_shop_id, scheduledPollAt(shop, newShopIndex, spacingMs, now));
    newShopIndex += 1;
  }

  return shops;
}

function startPollingTimer() {
  if (!COLLECTOR_CONTROL_ENABLED) return;
  if (pollState.timer) return;
  pollState.timer = setInterval(() => {
    runPollingTick('timer').catch((err) => {
      pollState.lastError = {
        message: err.message,
        at: new Date().toISOString(),
      };
    });
  }, POLL_HEARTBEAT_MS);
  pollState.timer.unref?.();
}

function stopPollingTimer() {
  if (!pollState.timer) return;
  clearInterval(pollState.timer);
  pollState.timer = null;
}

function pollingStatus(db) {
  loadPollingSettings(db);
  const shops = ensurePollSchedule(db, false);
  const pausedShopCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM shops
    WHERE collector_shop_id != ''
      AND status != 0
      AND collector_status = 'security_paused'
  `).get().count;
  const unresolvedIssueCount = db.prepare(`
    SELECT COUNT(*) as count
    FROM collector_issues
    WHERE resolved = 0
  `).get().count;
  const nextRuns = shops.map((shop) => ({
    erp_shop_id: shop.id,
    collector_shop_id: shop.collector_shop_id,
    platform: shop.platform,
    name: shop.real_name || shop.name,
    last_collect_at: shop.last_collect_at,
    next_run_at: pollState.nextRunByShop.has(shop.collector_shop_id)
      ? new Date(pollState.nextRunByShop.get(shop.collector_shop_id)).toISOString()
      : null,
  }));

  return {
    ok: true,
    enabled: pollState.enabled,
    running: pollState.running,
    interval_minutes: pollState.intervalMinutes,
    eligible_shop_count: shops.length,
    paused_shop_count: pausedShopCount,
    unresolved_issue_count: unresolvedIssueCount,
    server_time: new Date().toISOString(),
    next_runs: nextRuns,
    last_check: pollState.lastCheck,
    last_run: pollState.lastRun,
    last_error: pollState.lastError,
  };
}

async function runPollingTick(reason = 'timer', options = {}) {
  if (!COLLECTOR_CONTROL_ENABLED) return null;
  if (!pollState.enabled || pollState.running) return null;

  pollState.running = true;
  try {
    const db = getDb();
    loadPollingSettings(db);
    const shops = ensurePollSchedule(db, false);
    const now = Date.now();
    let dueShop = shops
      .filter((shop) => (pollState.nextRunByShop.get(shop.collector_shop_id) || Infinity) <= now)
      .sort((a, b) => (pollState.nextRunByShop.get(a.collector_shop_id) || 0) - (pollState.nextRunByShop.get(b.collector_shop_id) || 0))[0];
    const forced = options.force === true;

    if (!dueShop && forced) {
      dueShop = shops
        .slice()
        .sort((a, b) => (pollState.nextRunByShop.get(a.collector_shop_id) || Infinity) - (pollState.nextRunByShop.get(b.collector_shop_id) || Infinity))[0];
    }

    if (!dueShop) {
      const nextRunAt = shops
        .map((shop) => pollState.nextRunByShop.get(shop.collector_shop_id))
        .filter(Boolean)
        .sort((a, b) => a - b)[0] || null;
      pollState.lastCheck = {
        reason,
        at: new Date().toISOString(),
        due: false,
        forced,
        eligible_shop_count: shops.length,
        next_run_at: nextRunAt ? new Date(nextRunAt).toISOString() : null,
        message: shops.length > 0 ? '本次检查没有到期店铺' : '没有可轮询店铺',
      };
      return {
        ok: true,
        skipped: true,
        ...pollState.lastCheck,
      };
    }

    const authHeader = options.req?.headers?.authorization || pollState.token;
    if (IS_BRIDGE_MODE && !authHeader) {
      throw new Error('本地轮询缺少服务器登录令牌，请重新登录后再开启轮询');
    }
    const pollReq = IS_BRIDGE_MODE ? { headers: { authorization: authHeader } } : null;
    const result = await collectOrdersForShop(db, dueShop, getPollingUserId(db), false, pollReq);
    const securityPaused = result?.security_paused || result?.paused;
    const nextRunAt = securityPaused ? null : Date.now() + nextPollDelayMs();
    if (nextRunAt) {
      pollState.nextRunByShop.set(dueShop.collector_shop_id, nextRunAt);
    } else {
      pollState.nextRunByShop.delete(dueShop.collector_shop_id);
    }
    pollState.lastRun = {
      reason,
      at: new Date().toISOString(),
      forced,
      erp_shop_id: dueShop.id,
      collector_shop_id: dueShop.collector_shop_id,
      platform: dueShop.platform,
      name: dueShop.real_name || dueShop.name,
      order_count: result.order_count,
      security_paused: Boolean(securityPaused),
      sync: result.sync,
      next_run_at: nextRunAt ? new Date(nextRunAt).toISOString() : null,
    };
    pollState.lastCheck = {
      reason,
      at: pollState.lastRun.at,
      due: true,
      forced,
      eligible_shop_count: shops.length,
      erp_shop_id: dueShop.id,
      collector_shop_id: dueShop.collector_shop_id,
      platform: dueShop.platform,
      name: dueShop.real_name || dueShop.name,
      order_count: result.order_count,
      next_run_at: pollState.lastRun.next_run_at,
      message: forced ? '已手动执行一次轮询自检' : '已执行到期店铺轮询',
    };
    pollState.lastError = null;
    return pollState.lastRun;
  } catch (err) {
    pollState.lastError = {
      message: err.message,
      at: new Date().toISOString(),
    };
    throw err;
  } finally {
    pollState.running = false;
  }
}

function platformLabel(platform) {
  return platform === 'jd' ? '京东店铺' : '淘宝店铺';
}

function normalizeShopNameKey(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/\s+/g, '')
    .trim()
    .toLowerCase();
}

const PLACEHOLDER_SHOP_NAME_KEYS = new Set([
  '\u6dd8\u5b9d',
  '\u6dd8\u5b9d\u5e97\u94fa',
  '\u6dd8\u5b9d\u5356\u5bb6\u4e2d\u5fc3',
  '\u5343\u725b',
  '\u5343\u725b\u5de5\u4f5c\u53f0',
  '\u4eac\u4e1c',
  '\u4eac\u4e1c\u5e97\u94fa',
  '\u4eac\u9ea6',
  'jdm\u4eac\u9ea6',
  '\u5546\u5bb6\u540e\u53f0',
  '\u5e73\u53f0\u5e97\u94fa',
  '\u672a\u8bc6\u522b\u5e97\u94fa\u540d',
  'taobao',
  'jd',
  'jdm',
].map(normalizeShopNameKey));

function meaningfulShopName(value) {
  const text = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  if (!text) return '';
  const key = normalizeShopNameKey(text);
  if (!key || PLACEHOLDER_SHOP_NAME_KEYS.has(key)) return '';
  return text;
}

function getShopVisibleName(shop) {
  return meaningfulShopName(shop?.real_name) || meaningfulShopName(shop?.name) || '';
}

function findReusableShopByRealName(db, platform, realName, excludeCollectorShopId = '') {
  const name = meaningfulShopName(realName);
  const targetKey = normalizeShopNameKey(name);
  if (!targetKey) return null;

  const excludeId = String(excludeCollectorShopId || '').trim();
  const rows = db.prepare(`
    SELECT *
    FROM shops
    WHERE platform = ?
      AND status != 0
      AND collector_shop_id != ''
      AND (? = '' OR collector_shop_id != ?)
    ORDER BY
      CASE collector_status
        WHEN 'security_paused' THEN 0
        WHEN 'online' THEN 1
        WHEN 'synced' THEN 2
        ELSE 3
      END,
      id ASC
  `).all(platform, excludeId, excludeId);

  return rows.find((row) => normalizeShopNameKey(getShopVisibleName(row)) === targetKey) || null;
}

function markCollectorShopIgnored(db, collectorShopId, platform, shopName, reason = 'duplicate_real_shop', userId = null) {
  const id = String(collectorShopId || '').trim();
  if (!id) return;

  db.prepare(`
    INSERT INTO collector_shop_deletions (collector_shop_id, platform, shop_name, reason, created_by)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(collector_shop_id) DO UPDATE SET
      platform = excluded.platform,
      shop_name = excluded.shop_name,
      reason = excluded.reason,
      created_by = excluded.created_by,
      created_at = CURRENT_TIMESTAMP
  `).run(
    id,
    platform || '',
    meaningfulShopName(shopName) || String(shopName || '').trim(),
    reason,
    userId || null,
  );
}

function mergeDuplicateShopIntoExisting(db, duplicateShop, existingShop) {
  if (!duplicateShop || !existingShop || duplicateShop.id === existingShop.id) {
    return { moved_orders: 0, removed_duplicate_orders: 0, moved_expenses: 0 };
  }

  const duplicateOrders = db.prepare('SELECT id, order_no FROM orders WHERE shop_id = ?')
    .all(duplicateShop.id);
  const findExistingOrder = db.prepare('SELECT id FROM orders WHERE shop_id = ? AND order_no = ? LIMIT 1');
  const moveOrder = db.prepare('UPDATE orders SET shop_id = ?, collector_shop_id = ? WHERE id = ?');
  const deleteOrder = db.prepare('DELETE FROM orders WHERE id = ?');

  let movedOrders = 0;
  let removedDuplicateOrders = 0;
  for (const order of duplicateOrders) {
    const orderNo = String(order.order_no || '').trim();
    if (orderNo && findExistingOrder.get(existingShop.id, orderNo)) {
      deleteOrder.run(order.id);
      removedDuplicateOrders += 1;
      continue;
    }

    moveOrder.run(existingShop.id, existingShop.collector_shop_id || '', order.id);
    movedOrders += 1;
  }

  const movedExpenses = db.prepare('UPDATE expenses SET shop_id = ? WHERE shop_id = ?')
    .run(existingShop.id, duplicateShop.id).changes;
  db.prepare('UPDATE collector_issues SET shop_id = ? WHERE shop_id = ?')
    .run(existingShop.id, duplicateShop.id);
  db.prepare('DELETE FROM shops WHERE id = ?').run(duplicateShop.id);

  return {
    moved_orders: movedOrders,
    removed_duplicate_orders: removedDuplicateOrders,
    moved_expenses: movedExpenses,
  };
}

function insertDuplicateShopIssue(db, duplicateCollectorShopId, platform, realName, existingShop, userId = null, merge = null) {
  const existingName = getShopVisibleName(existingShop) || meaningfulShopName(realName);
  return insertCollectorIssue(db, {
    level: 'warning',
    source: 'duplicate_shop_session',
    title: '\u91cd\u590d\u767b\u5f55\u540c\u4e00\u5e97\u94fa',
    message: `\u5df2\u8df3\u8fc7\u91cd\u590d\u4f1a\u8bdd\uff0c\u7ee7\u7eed\u4f7f\u7528\u5df2\u6709\u5e97\u94fa\u4f1a\u8bdd\uff1a${existingName || duplicateCollectorShopId}`,
    collector_shop_id: duplicateCollectorShopId,
    shop_id: existingShop?.id || null,
    platform,
    details: {
      reason: 'duplicate_real_shop',
      duplicate_collector_shop_id: duplicateCollectorShopId,
      duplicate_shop_name: meaningfulShopName(realName),
      existing_shop_id: existingShop?.id || null,
      existing_collector_shop_id: existingShop?.collector_shop_id || '',
      existing_shop_name: existingName,
      merge,
    },
  }, userId);
}

function reuseExistingShopForDuplicateCollector(db, duplicateCollectorShopId, platform, realName, existingShop, userId = null) {
  const duplicateShop = getShopByCollectorId(db, duplicateCollectorShopId);
  const merge = mergeDuplicateShopIntoExisting(db, duplicateShop, existingShop);
  markCollectorShopIgnored(db, duplicateCollectorShopId, platform, realName, 'duplicate_real_shop', userId);
  const issue = insertDuplicateShopIssue(db, duplicateCollectorShopId, platform, realName, existingShop, userId, merge);
  return {
    reused: true,
    duplicate_collector_shop_id: duplicateCollectorShopId,
    existing_shop_id: existingShop.id,
    existing_collector_shop_id: existingShop.collector_shop_id,
    existing_shop_name: getShopVisibleName(existingShop) || meaningfulShopName(realName),
    merge,
    issue,
  };
}

function readIssueDetails(details) {
  if (!details) return null;
  try {
    return typeof details === 'string' ? JSON.parse(details) : details;
  } catch {
    return null;
  }
}

function readIssueDetailName(details) {
  const data = readIssueDetails(details);
  if (!data) return '';
  return meaningfulShopName(data.existing_shop_name)
    || meaningfulShopName(data.shop_name)
    || meaningfulShopName(data.shopName)
    || meaningfulShopName(data.duplicate_shop_name)
    || meaningfulShopName(data.shop?.real_name)
    || meaningfulShopName(data.shop?.name)
    || meaningfulShopName(data.existing?.real_name)
    || meaningfulShopName(data.existing?.name)
    || '';
}

function enrichIssueRow(row) {
  return {
    ...row,
    shop_name: meaningfulShopName(row.shop_name) || readIssueDetailName(row.details),
  };
}

function normalizeCollectorShopList(result) {
  if (Array.isArray(result)) return result;
  if (Array.isArray(result?.shops)) return result.shops;
  if (Array.isArray(result?.data)) return result.data;
  if (Array.isArray(result?.items)) return result.items;
  return [];
}

function normalizeStatus(statusText = '') {
  const text = String(statusText);
  if (/待付款|未付款|待支付|等待付款|等待买家付款|买家未付款/.test(text)) return 'unpaid';
  return 'unprocessed';
}

function parsePlatformTime(value) {
  if (!value) return new Date().toISOString();
  const text = String(value);
  if (/^\d{13}$/.test(text)) return new Date(Number(text)).toISOString();
  if (/^\d{10}$/.test(text)) return new Date(Number(text) * 1000).toISOString();
  return text;
}

function nowIso() {
  return new Date().toISOString();
}

function normalizeTimestamp(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstItem(order) {
  return Array.isArray(order.Items) && order.Items.length > 0 ? order.Items[0] : {};
}

function readAny(source, names) {
  for (const name of names) {
    if (source?.[name] !== undefined && source?.[name] !== null && source?.[name] !== '') {
      return source[name];
    }
  }
  return '';
}

function mapCollectorOrder(order, shop, userId) {
  const item = firstItem(order);
  const statusText = readAny(order, ['StatusDescription', 'Status', 'statusDescription', 'status']);
  const amount = Number(readAny(order, ['Amount', 'amount', 'TotalAmount', 'totalAmount']) || 0);
  const quantity = Number(readAny(item, ['Quantity', 'quantity', 'Num', 'num']) || readAny(order, ['ItemCount', 'itemCount']) || 1);

  return {
    order_no: String(readAny(order, ['OrderId', 'orderId', 'Tid', 'tid', 'id'])),
    product_name: String(readAny(item, ['Title', 'title', 'Name', 'name', 'SkuName', 'skuName', 'ProductName', 'productName']) || '平台订单'),
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    shop_id: shop.id,
    price: Number.isFinite(amount) ? amount : 0,
    cost: 0,
    tracking_no: String(readAny(order, ['TrackingNo', 'trackingNo', 'LogisticsNo', 'logisticsNo'])),
    status: normalizeStatus(statusText),
    handler_id: userId,
    note: '',
    buyer_nick: String(readAny(order, ['BuyerNick', 'buyerNick'])),
    receiver_name: String(readAny(order, ['ReceiverName', 'receiverName'])),
    receiver_phone: String(readAny(order, ['ReceiverPhone', 'receiverPhone'])),
    receiver_address: String(readAny(order, ['ReceiverAddress', 'receiverAddress'])),
    main_image_url: String(readAny(order, ['MainImageUrl', 'mainImageUrl']) || readAny(item, ['MainImageUrl', 'mainImageUrl'])),
    platform_status: String(readAny(order, ['Status', 'status'])),
    status_description: String(statusText),
    platform_created_at: String(readAny(order, ['CreatedAt', 'createdAt'])),
    ship_deadline_text: String(readAny(order, ['ShipDeadlineText', 'shipDeadlineText', 'PromiseShipText', 'promiseShipText'])),
    ship_deadline_at: String(readAny(order, ['ShipDeadlineAt', 'shipDeadlineAt', 'PromiseShipAt', 'promiseShipAt'])),
    collector_shop_id: shop.collector_shop_id,
    raw_json: JSON.stringify(order),
    created_at: parsePlatformTime(readAny(order, ['CreatedAt', 'createdAt'])),
    item_id: String(readAny(item, ['ItemId', 'itemId', 'NumIid', 'numIid'])),
    sku_id: String(readAny(item, ['SkuId', 'skuId'])),
  };
}

function syncOrdersToDb(db, shop, orders, userId) {
  let inserted = 0;
  let updated = 0;
  let skippedIgnored = 0;

  const insert = db.prepare(`
    INSERT INTO orders (
      order_no, product_name, quantity, shop_id, price, cost, tracking_no, status,
      handler_id, note, buyer_nick, receiver_name, receiver_phone, receiver_address,
      main_image_url, platform_status, status_description, platform_created_at,
      ship_deadline_text, ship_deadline_at, collector_shop_id, raw_json, created_at,
      item_id, sku_id
    )
    VALUES (
      @order_no, @product_name, @quantity, @shop_id, @price, @cost, @tracking_no, @status,
      @handler_id, @note, @buyer_nick, @receiver_name, @receiver_phone, @receiver_address,
      @main_image_url, @platform_status, @status_description, @platform_created_at,
      @ship_deadline_text, @ship_deadline_at, @collector_shop_id, @raw_json, @created_at,
      @item_id, @sku_id
    )
  `);

  const update = db.prepare(`
    UPDATE orders SET
      product_name = @product_name,
      quantity = @quantity,
      price = @price,
      tracking_no = @tracking_no,
      status = CASE
        WHEN status IS NULL OR status = '' OR status = 'unpaid' THEN @status
        ELSE status
      END,
      buyer_nick = @buyer_nick,
      receiver_name = @receiver_name,
      receiver_phone = @receiver_phone,
      receiver_address = @receiver_address,
      main_image_url = @main_image_url,
      platform_status = @platform_status,
      status_description = @status_description,
      platform_created_at = @platform_created_at,
      ship_deadline_text = @ship_deadline_text,
      ship_deadline_at = @ship_deadline_at,
      collector_shop_id = @collector_shop_id,
      raw_json = @raw_json,
      item_id = @item_id,
      sku_id = @sku_id
    WHERE id = @id
  `);

  const find = db.prepare('SELECT id FROM orders WHERE order_no = ? AND shop_id = ?');
  const ignoredByCollector = db.prepare('SELECT id FROM order_sync_ignores WHERE order_no = ? AND collector_shop_id = ?');
  const ignoredByShop = db.prepare('SELECT id FROM order_sync_ignores WHERE order_no = ? AND shop_id = ?');
  const tx = db.transaction(() => {
    for (const order of orders) {
      const mapped = mapCollectorOrder(order, shop, userId);
      if (!mapped.order_no) continue;

      const ignored = mapped.collector_shop_id
        ? ignoredByCollector.get(mapped.order_no, mapped.collector_shop_id)
        : ignoredByShop.get(mapped.order_no, shop.id);
      if (ignored) {
        skippedIgnored += 1;
        continue;
      }

      const existing = find.get(mapped.order_no, shop.id);
      let orderId;
      if (existing) {
        update.run({ ...mapped, id: existing.id });
        orderId = existing.id;
        updated += 1;
      } else {
        const r = insert.run(mapped);
        orderId = r.lastInsertRowid;
        inserted += 1;
      }
      // 商品ID已绑定成品 → 自动归类并同步成本（未匹配的保持"待确认"）
      if (mapped.item_id) {
        const product = resolveProductByItem(db, mapped.item_id, mapped.sku_id);
        if (product) applyProductToOrder(db, orderId, product);
      }
    }
  });

  tx();
  return { inserted, updated, skipped_ignored: skippedIgnored };
}

function getShopByCollectorId(db, collectorShopId) {
  return db.prepare('SELECT * FROM shops WHERE collector_shop_id = ?').get(collectorShopId);
}

function syncCollectorShopsToDb(db, collectorShops) {
  const find = db.prepare('SELECT * FROM shops WHERE collector_shop_id = ?');
  const deleted = new Set(
    db.prepare('SELECT collector_shop_id FROM collector_shop_deletions')
      .all()
      .map((item) => String(item.collector_shop_id)),
  );
  const insert = db.prepare(`
    INSERT INTO shops (name, platform, real_name, collector_shop_id, collector_status, last_login_check_at, last_collect_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const update = db.prepare(`
    UPDATE shops SET
      name = ?,
      platform = ?,
      real_name = ?,
      collector_status = ?,
      last_login_check_at = CASE WHEN ? IS NOT NULL THEN ? ELSE last_login_check_at END,
      last_collect_at = CASE WHEN ? IS NOT NULL THEN ? ELSE last_collect_at END,
      status = CASE WHEN status IS NULL THEN 1 ELSE status END
    WHERE collector_shop_id = ?
  `);

  let inserted = 0;
  let updated = 0;
  let skippedDeleted = 0;
  let duplicatesReused = 0;
  const duplicateSessions = [];

  const tx = db.transaction(() => {
    for (const shop of collectorShops) {
      const collectorShopId = String(shop?.shop_id || '').trim();
      if (!collectorShopId) continue;
      if (deleted.has(collectorShopId)) {
        skippedDeleted += 1;
        continue;
      }

      const platform = shop?.platform === 'jd' ? 'jd' : 'taobao';
      const rawName = String(shop?.shop_name || '').trim();
      const realName = meaningfulShopName(rawName);
      const collectorStatus = shop?.security_paused
        ? 'security_paused'
        : (shop?.session_valid ? 'online' : 'created');
      const lastLoginCheckAt = normalizeTimestamp(shop?.updated_at);
      const lastCollectAt = normalizeTimestamp(shop?.last_collect_at || shop?.lastCollectAt);
      const existing = find.get(collectorShopId);
      const displayName = realName
        || meaningfulShopName(existing?.real_name)
        || meaningfulShopName(existing?.name)
        || rawName
        || platformLabel(platform);
      const reusable = realName
        ? findReusableShopByRealName(db, platform, realName, collectorShopId)
        : null;

      if (reusable) {
        const duplicate = reuseExistingShopForDuplicateCollector(db, collectorShopId, platform, realName, reusable);
        deleted.add(collectorShopId);
        duplicatesReused += 1;
        duplicateSessions.push(duplicate);
        continue;
      }

      if (existing) {
        update.run(
          displayName,
          platform,
          realName || existing.real_name || '',
          collectorStatus,
          lastLoginCheckAt,
          lastLoginCheckAt,
          lastCollectAt,
          lastCollectAt,
          collectorShopId,
        );
        updated += 1;
      } else {
        insert.run(
          displayName,
          platform,
          realName,
          collectorShopId,
          collectorStatus,
          lastLoginCheckAt,
          lastCollectAt,
        );
        inserted += 1;
      }
    }
  });

  tx();
  return {
    inserted,
    updated,
    skipped_deleted: skippedDeleted,
    duplicates_reused: duplicatesReused,
    duplicate_sessions: duplicateSessions,
  };
}

function extractCollectorOrders(result) {
  if (Array.isArray(result?.orders)) return result.orders;
  if (Array.isArray(result?.result_export?.orders)) return result.result_export.orders;
  if (Array.isArray(result?.export?.orders)) return result.export.orders;
  if (Array.isArray(result?.data?.orders)) return result.data.orders;
  return [];
}

async function collectOrdersForShop(db, shop, userId, full = false, req = null) {
  const path = full
    ? `/api/shops/${shop.collector_shop_id}/collect/orders/full`
    : `/api/shops/${shop.collector_shop_id}/collect/orders`;
  try {
    await ensureLocalCollectorShop(shop);
    const result = await collectorRequest(path, { method: 'POST' });
    const collectedAt = normalizeTimestamp(result?.last_collect_at) || nowIso();

    if (isSecurityPausedResult(result)) {
      db.prepare('UPDATE shops SET collector_status = ?, last_login_check_at = ? WHERE id = ?')
        .run('security_paused', collectedAt, shop.id);
      const issue = insertCollectorIssue(db, {
        level: 'warning',
        source: full ? 'collect_orders_full' : 'collect_orders',
        title: '店铺出现安全验证，轮询已暂停',
        message: securityPauseMessage(result),
        collector_shop_id: shop.collector_shop_id,
        platform: shop.platform,
        details: result,
      }, userId);
      await reportCollectorIssueToRemote(req, issue);
      return {
        ok: false,
        paused: true,
        security_paused: true,
        collector_shop_id: shop.collector_shop_id,
        order_count: 0,
        mode: result?.mode || (full ? 'full' : 'incremental'),
        collect_all_pages: Boolean(result?.collect_all_pages || full),
        sync: { inserted: 0, updated: 0, skipped_deleted: 0 },
        issue,
        collector: result,
      };
    }

    if (result?.ok === false) {
      db.prepare('UPDATE shops SET last_collect_at = ?, collector_status = ? WHERE id = ?')
        .run(collectedAt, 'collect_failed', shop.id);
      const issue = insertCollectorIssue(db, {
        level: 'error',
        source: full ? 'collect_orders_full' : 'collect_orders',
        title: full ? '全量采集失败' : '订单采集失败',
        message: result?.message || result?.reason || result?.note || '采集器返回异常状态',
        collector_shop_id: shop.collector_shop_id,
        platform: shop.platform,
        details: result,
      }, userId);
      await reportCollectorIssueToRemote(req, issue);
      return {
        ok: false,
        collector_shop_id: shop.collector_shop_id,
        order_count: 0,
        mode: result?.mode || (full ? 'full' : 'incremental'),
        collect_all_pages: Boolean(result?.collect_all_pages || full),
        last_collect_at: collectedAt,
        sync: { inserted: 0, updated: 0, skipped_deleted: 0 },
        issue,
        collector: result,
      };
    }

    let orders = extractCollectorOrders(result);
    let latestExport = null;
    if (orders.length === 0) {
      latestExport = await collectorRequest(`/api/shops/${shop.collector_shop_id}/exports/latest?task=orders`);
      orders = extractCollectorOrders(latestExport);
    }

    const remoteSync = req ? await syncOrdersToRemote(req, shop, orders, { ...result, last_collect_at: collectedAt }, full) : null;
    const sync = remoteSync?.sync || syncOrdersToDb(db, shop, orders, userId);
    db.prepare('UPDATE shops SET last_collect_at = ?, collector_status = ? WHERE id = ?')
      .run(collectedAt, result.ok ? 'synced' : 'collect_failed', shop.id);

    return {
      ok: result.ok,
      collector_shop_id: shop.collector_shop_id,
      order_count: orders.length,
      mode: result?.mode || (full ? 'full' : 'incremental'),
      collect_all_pages: Boolean(result?.collect_all_pages || full),
      last_collect_at: collectedAt,
      sync,
      remote: remoteSync,
      collector: result,
      latest_export: latestExport,
    };
  } catch (err) {
    db.prepare('UPDATE shops SET last_collect_at = ?, collector_status = ? WHERE id = ?')
      .run(nowIso(), 'collect_failed', shop.id);
    const issue = insertCollectorIssue(db, {
      level: 'error',
      source: full ? 'collect_orders_full' : 'collect_orders',
      title: full ? '全量采集失败' : '订单采集失败',
      message: err.message,
      collector_shop_id: shop.collector_shop_id,
      platform: shop.platform,
      details: {
        path,
        full,
        status: err.status,
        body: err.body,
        stack: err.stack,
      },
    }, userId);
    await reportCollectorIssueToRemote(req, issue);
    throw err;
  }
}

function findSyncedShopRows(db, collectorShops) {
  const find = db.prepare(`
    SELECT id, name, platform, real_name, collector_shop_id, collector_status,
           last_login_check_at, last_collect_at, status, created_at
    FROM shops
    WHERE collector_shop_id = ?
  `);
  return normalizeCollectorShopList(collectorShops)
    .map((shop) => {
      const collectorShopId = String(shop?.shop_id || shop?.collector_shop_id || '').trim();
      if (!collectorShopId) return null;
      const byCollectorId = find.get(collectorShopId);
      if (byCollectorId) return byCollectorId;
      const platform = shop?.platform === 'jd' ? 'jd' : 'taobao';
      const realName = meaningfulShopName(shop?.shop_name || shop?.shopName || shop?.real_name || shop?.name);
      return realName ? findReusableShopByRealName(db, platform, realName, collectorShopId) : null;
    })
    .filter(Boolean);
}

router.get('/config', adminMiddleware, (req, res) => {
  res.json({
    collector_base_url: getCollectorBaseUrl(),
    default_collector_base_url: DEFAULT_COLLECTOR_BASE_URL,
    remote_erp_base_url: REMOTE_ERP_BASE_URL || '',
    bridge_mode: IS_BRIDGE_MODE,
    collector_control_enabled: COLLECTOR_CONTROL_ENABLED,
  });
});

router.post('/ingest/shops', (req, res) => {
  const collectorShops = normalizeCollectorShopList(req.body?.shops ?? req.body);
  const db = getDb();
  const sync = syncCollectorShopsToDb(db, collectorShops);
  res.json({
    ok: true,
    bridge_mode: false,
    collector_count: collectorShops.length,
    sync,
    shops: findSyncedShopRows(db, collectorShops),
  });
});

router.post('/ingest/orders', (req, res) => {
  const db = getDb();
  const collectorShopId = String(req.body?.collector_shop_id || '').trim();
  let shop = collectorShopId ? getShopByCollectorId(db, collectorShopId) : null;

  const deleted = collectorShopId
    ? db.prepare('SELECT * FROM collector_shop_deletions WHERE collector_shop_id = ?').get(collectorShopId)
    : null;
  if (deleted) {
    const platform = req.body?.platform === 'jd' ? 'jd' : (deleted.platform || 'taobao');
    const realName = meaningfulShopName(req.body?.shop_name || req.body?.shopName || deleted.shop_name);
    const reusable = deleted.reason === 'duplicate_real_shop' && realName
      ? findReusableShopByRealName(db, platform, realName, collectorShopId)
      : null;
    if (reusable) {
      shop = reusable;
    } else {
    return res.status(410).json({ ok: false, message: '该店铺已在 ERP 删除，已拒绝重新同步', collector_shop_id: collectorShopId });
    }
  }

  if (!shop && collectorShopId) {
    const collectorResult = req.body?.collector || {};
    const securityPaused = isSecurityPausedResult(collectorResult) || req.body?.security_paused === true;
    const collectorShop = {
      shop_id: collectorShopId,
      platform: req.body?.platform || 'taobao',
      shop_name: req.body?.shop_name || '',
      session_valid: !securityPaused,
      security_paused: securityPaused,
      updated_at: new Date().toISOString(),
      last_collect_at: req.body?.collected_at || req.body?.last_collect_at,
    };
    syncCollectorShopsToDb(db, [collectorShop]);
    shop = getShopByCollectorId(db, collectorShopId);
    if (!shop) {
      const platform = collectorShop.platform === 'jd' ? 'jd' : 'taobao';
      const realName = meaningfulShopName(collectorShop.shop_name);
      shop = realName ? findReusableShopByRealName(db, platform, realName, collectorShopId) : null;
    }
  }

  if (!shop) {
    return res.status(404).json({ ok: false, message: 'ERP 中找不到对应店铺', collector_shop_id: collectorShopId });
  }

  const collectorResult = req.body?.collector || {};
  if (isSecurityPausedResult(collectorResult) || req.body?.security_paused === true) {
    db.prepare('UPDATE shops SET collector_status = ?, last_login_check_at = ? WHERE id = ?')
      .run('security_paused', nowIso(), shop.id);
    const issue = insertCollectorIssue(db, {
      level: 'warning',
      source: 'collector_ingest',
      title: '店铺出现安全验证，轮询已暂停',
      message: securityPauseMessage(collectorResult || req.body),
      collector_shop_id: collectorShopId,
      platform: shop.platform || req.body?.platform,
      details: req.body,
    }, req.user?.id || null);
    return res.status(202).json({
      ok: false,
      paused: true,
      security_paused: true,
      erp_shop_id: shop.id,
      collector_shop_id: shop.collector_shop_id || collectorShopId,
      source_collector_shop_id: collectorShopId,
      reused_existing_shop: shop.collector_shop_id !== collectorShopId,
      order_count: 0,
      issue,
    });
  }

  const orders = extractCollectorOrders(req.body);
  const sync = syncOrdersToDb(db, shop, orders, req.user.id);
  const collectedAt = normalizeTimestamp(req.body?.collected_at || req.body?.last_collect_at)
    || normalizeTimestamp(req.body?.collector?.last_collect_at)
    || nowIso();
  db.prepare('UPDATE shops SET last_collect_at = ?, collector_status = ? WHERE id = ?')
    .run(collectedAt, 'synced', shop.id);

  res.json({
    ok: true,
    erp_shop_id: shop.id,
    collector_shop_id: shop.collector_shop_id || collectorShopId,
    source_collector_shop_id: collectorShopId,
    reused_existing_shop: shop.collector_shop_id !== collectorShopId,
    order_count: orders.length,
    last_collect_at: collectedAt,
    sync,
  });
});

router.post('/ingest/issues', (req, res) => {
  const db = getDb();
  const issue = insertCollectorIssue(db, req.body || {}, req.user?.id || null);
  res.status(201).json({ ok: true, issue });
});

router.post('/ingest/logs', (req, res) => {
  const db = getDb();
  const upload = normalizeCollectorLogUpload(req.body || {});
  const issue = insertCollectorIssue(db, upload, req.user?.id || null);
  res.status(201).json({
    ok: true,
    issue,
    summary: upload.details.normalized,
  });
});

router.get('/issues', adminMiddleware, (req, res) => {
  const db = getDb();
  const { resolved = '0', level, collector_shop_id, page = 1, pageSize = 20 } = req.query;
  const params = [];
  let where = 'WHERE 1=1';
  if (resolved !== 'all') {
    where += ' AND ci.resolved = ?';
    params.push(resolved === '1' ? 1 : 0);
  }
  if (level) {
    where += ' AND ci.level = ?';
    params.push(level);
  }
  if (collector_shop_id) {
    where += ' AND ci.collector_shop_id = ?';
    params.push(collector_shop_id);
  }

  const { total } = db.prepare(`
    SELECT COUNT(*) as total
    FROM collector_issues ci
    ${where}
  `).get(...params);

  const rows = db.prepare(`
    SELECT
      ci.*,
      COALESCE(
        s.real_name,
        s.name,
        d.shop_name,
        CASE
          WHEN json_valid(ci.details) THEN COALESCE(
            json_extract(ci.details, '$.shop_name'),
            json_extract(ci.details, '$.shopName'),
            json_extract(ci.details, '$.shop.name')
          )
          ELSE ''
        END,
        ''
      ) as shop_name,
      COALESCE(s.platform, ci.platform, d.platform, '') as display_platform,
      u.nickname as created_by_name
    FROM collector_issues ci
    LEFT JOIN shops s ON s.id = COALESCE(
      (SELECT id FROM shops WHERE id = ci.shop_id LIMIT 1),
      (SELECT id FROM shops WHERE ci.collector_shop_id != '' AND collector_shop_id = ci.collector_shop_id ORDER BY id DESC LIMIT 1)
    )
    LEFT JOIN collector_shop_deletions d ON ci.collector_shop_id != '' AND d.collector_shop_id = ci.collector_shop_id
    LEFT JOIN users u ON ci.created_by = u.id
    ${where}
    ORDER BY ci.resolved ASC, ci.created_at DESC, ci.id DESC
    LIMIT ? OFFSET ?
  `).all(...params, Number(pageSize), (Number(page) - 1) * Number(pageSize))
    .map(enrichIssueRow);

  res.json({ list: rows, total, page: Number(page), pageSize: Number(pageSize) });
});

router.patch('/issues/:id/resolve', adminMiddleware, (req, res) => {
  const db = getDb();
  db.prepare('UPDATE collector_issues SET resolved = 1, resolved_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(req.params.id);
  res.json({ ok: true, message: '采集问题已标记处理' });
});

router.delete('/issues/:id', adminMiddleware, (req, res) => {
  const db = getDb();
  db.prepare('DELETE FROM collector_issues WHERE id = ?').run(req.params.id);
  res.json({ ok: true, message: '采集问题已删除' });
});

router.get('/logs/upload', adminMiddleware, async (req, res, next) => {
  try {
    res.json(await collectorRequest('/api/collector/logs/upload'));
  } catch (err) {
    next(err);
  }
});

router.post('/logs/upload', adminMiddleware, async (req, res, next) => {
  try {
    const serverBaseUrl = REMOTE_ERP_BASE_URL || `${req.protocol}://${req.get('host')}`;
    res.json(await collectorRequest('/api/collector/logs/upload', {
      method: 'POST',
      body: JSON.stringify({
        serverBaseUrl,
        authorization: req.headers.authorization || '',
        reason: req.body?.reason || 'manual_from_erp',
      }),
    }));
  } catch (err) {
    next(err);
  }
});

// ===== 任务队列：网页下发任务 → 采集器轮询领取(claim) → 执行后回传 → 网页查询结果 =====
// 注意：必须放在下面的"服务器不直接控制"拦截器之前——任务队列正是中心服务器与采集器协作的方式，
// 不受 COLLECTOR_CONTROL_ENABLED 限制。
function taskSafeParse(value, fallback = null) {
  if (value === null || value === undefined || value === '') return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function genTaskId() {
  return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

// 网页：创建任务
router.post('/tasks', (req, res) => {
  const db = getDb();
  const { type, collector_shop_id: shopId, payload } = req.body || {};
  if (!type) return res.status(400).json({ message: 'type 必填' });
  const id = genTaskId();
  db.prepare(
    "INSERT INTO collector_tasks (id, type, collector_shop_id, payload, status, created_by, created_at) VALUES (?, ?, ?, ?, 'pending', ?, CURRENT_TIMESTAMP)",
  ).run(id, String(type), String(shopId || ''), JSON.stringify(payload || {}), req.user?.id || null);
  res.status(201).json({ id, status: 'pending' });
});

// 采集器：领取待执行任务
router.get('/tasks/claim', (req, res) => {
  const db = getDb();
  const limit = Math.min(Math.max(Number(req.query.limit) || 1, 1), 10);
  const rows = db.prepare("SELECT * FROM collector_tasks WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?").all(limit);
  const claim = db.prepare("UPDATE collector_tasks SET status = 'claimed', claimed_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'");
  const tasks = [];
  for (const t of rows) {
    if (claim.run(t.id).changes > 0) {
      tasks.push({
        id: t.id,
        type: t.type,
        collector_shop_id: t.collector_shop_id,
        payload: taskSafeParse(t.payload, {}),
        created_at: t.created_at,
      });
    }
  }
  res.json({ tasks });
});

// 网页：查询任务状态/结果
router.get('/tasks/:id', (req, res) => {
  const db = getDb();
  const t = db.prepare('SELECT * FROM collector_tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ message: '任务不存在' });
  res.json({ id: t.id, status: t.status, result: taskSafeParse(t.result), error: t.error || '' });
});

// 采集器：回传执行结果（兼容多种端点命名）
function submitTaskResult(req, res) {
  const db = getDb();
  const t = db.prepare('SELECT id FROM collector_tasks WHERE id = ?').get(req.params.id);
  if (!t) return res.status(404).json({ message: '任务不存在' });
  const body = req.body || {};
  const hasError = Boolean(body.error) || body.ok === false || body.status === 'failed';
  const status = body.status || (hasError ? 'failed' : 'done');
  const result = body.result !== undefined ? body.result : body;
  db.prepare('UPDATE collector_tasks SET status = ?, result = ?, error = ?, finished_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(status, JSON.stringify(result ?? null), String(body.error || ''), t.id);
  res.json({ ok: true });
}
router.post('/tasks/:id/result', submitTaskResult);
router.post('/tasks/:id/complete', submitTaskResult);
router.post('/tasks/:id/callback', submitTaskResult);
router.patch('/tasks/:id', submitTaskResult);
router.put('/tasks/:id', submitTaskResult);

router.use((req, res, next) => {
  if (COLLECTOR_CONTROL_ENABLED) return next();
  return res.status(409).json({
    ok: false,
    message: '服务器端不直接控制店铺采集。请在本地 EXE 内新增店铺、扫码登录和采集订单；服务器只负责账号鉴权和接收同步数据。',
  });
});

router.post('/config', adminMiddleware, (req, res) => {
  const baseUrl = normalizeCollectorBaseUrl(req.body?.collector_base_url);
  if (!/^https?:\/\/[^/]+(?::\d+)?$/i.test(baseUrl)) {
    return res.status(400).json({ message: '采集器地址格式不正确，例如：http://127.0.0.1:5069' });
  }

  const db = getDb();
  db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)')
    .run('collector_base_url', baseUrl);

  res.json({ message: '采集器连接地址已保存', collector_base_url: baseUrl });
});

router.get('/status', async (req, res, next) => {
  try {
    res.json(await collectorRequest('/api/collector/status'));
  } catch (err) {
    next(err);
  }
});

router.get('/shops', async (req, res, next) => {
  try {
    res.json(await collectorRequest('/api/shops'));
  } catch (err) {
    next(err);
  }
});

router.post('/shops/sync', adminMiddleware, async (req, res, next) => {
  try {
    const result = await collectorRequest('/api/shops');
    const collectorShops = normalizeCollectorShopList(result);
    const db = getDb();
    const sync = syncCollectorShopsToDb(db, collectorShops);
    const remote = await syncCollectorShopsToRemote(req, collectorShops);
    res.json({
      ok: true,
      collector_count: collectorShops.length,
      sync: remote?.sync || sync,
      remote,
      collector: result,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/shops', adminMiddleware, async (req, res, next) => {
  try {
    const { platform } = req.body;
    if (!['taobao', 'jd'].includes(platform)) {
      return res.status(400).json({ message: '平台必须是 taobao 或 jd' });
    }

    const collectorShop = await collectorRequest('/api/shops', {
      method: 'POST',
      body: JSON.stringify({ platform }),
    });

    const db = getDb();
    const name = collectorShop.shop_name || collectorShop.name || platformLabel(platform);
    db.prepare('DELETE FROM collector_shop_deletions WHERE collector_shop_id = ?')
      .run(collectorShop.shop_id);
    const result = db.prepare(`
      INSERT INTO shops (name, platform, real_name, collector_shop_id, collector_status)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, platform, collectorShop.shop_name || '', collectorShop.shop_id, 'created');
    const remote = await syncCollectorShopsToRemote(req, [collectorShop]);
    const remoteShop = Array.isArray(remote?.shops)
      ? remote.shops.find((shop) => shop.collector_shop_id === collectorShop.shop_id)
      : null;

    res.status(201).json({
      erp_shop_id: remoteShop?.id || result.lastInsertRowid,
      local_erp_shop_id: result.lastInsertRowid,
      collector_shop_id: collectorShop.shop_id,
      remote,
      collector: collectorShop,
    });
  } catch (err) {
    next(err);
  }
});

router.post('/shops/:collectorShopId/open', async (req, res, next) => {
  try {
    const db = getDb();
    let targetCollectorShopId = req.params.collectorShopId;
    let shop = getShopByCollectorId(db, targetCollectorShopId);
    if (!shop) {
      const deleted = db.prepare('SELECT * FROM collector_shop_deletions WHERE collector_shop_id = ?')
        .get(targetCollectorShopId);
      const platform = req.body?.platform === 'jd' ? 'jd' : (deleted?.platform || req.body?.platform || 'taobao');
      const realName = meaningfulShopName(req.body?.shop_name || req.body?.shopName || deleted?.shop_name);
      const reusable = deleted?.reason === 'duplicate_real_shop' && realName
        ? findReusableShopByRealName(db, platform, realName, targetCollectorShopId)
        : null;
      if (reusable) {
        shop = reusable;
        targetCollectorShopId = reusable.collector_shop_id;
      }
    }
    await ensureLocalCollectorShop(shop || {
      collector_shop_id: targetCollectorShopId,
      platform: req.body?.platform,
      name: req.body?.name,
      real_name: req.body?.real_name,
    }, req.body || {});
    const result = await collectorRequest(`/api/shops/${targetCollectorShopId}/open`, { method: 'POST' });
    res.json({
      ...result,
      redirected_to_existing: targetCollectorShopId !== req.params.collectorShopId,
      requested_collector_shop_id: req.params.collectorShopId,
      collector_shop_id: targetCollectorShopId,
      shop_name: getShopVisibleName(shop) || result?.shop_name,
    });
  } catch (err) {
    next(err);
  }
});

router.delete('/shops/:collectorShopId', adminMiddleware, async (req, res, next) => {
  try {
    const result = await collectorRequest(`/api/shops/${req.params.collectorShopId}?purge=true`, { method: 'DELETE' });
    const db = getDb();
    const shop = getShopByCollectorId(db, req.params.collectorShopId);
    if (shop) {
      const tx = db.transaction(() => {
        db.prepare(`
          INSERT INTO collector_shop_deletions (collector_shop_id, platform, shop_name, reason, created_by)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(collector_shop_id) DO UPDATE SET
            platform = excluded.platform,
            shop_name = excluded.shop_name,
            reason = excluded.reason,
            created_by = excluded.created_by,
            created_at = CURRENT_TIMESTAMP
        `).run(
          shop.collector_shop_id,
          shop.platform || '',
          shop.real_name || shop.name || '',
          'deleted_in_erp',
          req.user?.id || null,
        );
        db.prepare('DELETE FROM shops WHERE id = ?').run(shop.id);
      });
      tx();
    }
    res.json({ ok: true, collector: result });
  } catch (err) {
    next(err);
  }
});

router.post('/shops/:collectorShopId/login-check', async (req, res, next) => {
  try {
    const db = getDb();
    const existingShop = getShopByCollectorId(db, req.params.collectorShopId);
    await ensureLocalCollectorShop(existingShop || {
      collector_shop_id: req.params.collectorShopId,
      platform: req.body?.platform,
      name: req.body?.name,
      real_name: req.body?.real_name,
    }, req.body || {});
    const result = await collectorRequest(`/api/shops/${req.params.collectorShopId}/login-check`, { method: 'POST' });
    const realName = result.shop_name || result.shopName || '';
    const meaningfulRealName = meaningfulShopName(realName);
    const checkedAt = nowIso();
    const nextStatus = result?.security_paused
      ? 'security_paused'
      : (result?.session_valid ? 'online' : 'login_required');
    const platform = result?.platform === 'jd' || existingShop?.platform === 'jd' || req.body?.platform === 'jd'
      ? 'jd'
      : 'taobao';
    const reusable = meaningfulRealName
      ? findReusableShopByRealName(db, platform, meaningfulRealName, req.params.collectorShopId)
      : null;

    if (reusable) {
      const duplicate = db.transaction(() => reuseExistingShopForDuplicateCollector(
        db,
        req.params.collectorShopId,
        platform,
        meaningfulRealName,
        reusable,
        req.user?.id || null,
      ))();
      let collectorDelete = null;
      let collectorDeleteWarning = null;
      try {
        collectorDelete = await collectorRequest(`/api/shops/${req.params.collectorShopId}?purge=true`, { method: 'DELETE' });
      } catch (err) {
        collectorDeleteWarning = err.message;
      }
      const remote = await syncCollectorShopsToRemote(req, [{
        shop_id: reusable.collector_shop_id,
        platform: reusable.platform,
        shop_name: getShopVisibleName(reusable) || meaningfulRealName,
        session_valid: reusable.collector_status !== 'login_required',
        updated_at: checkedAt,
        last_collect_at: reusable.last_collect_at,
      }]);
      result.duplicate_shop = true;
      result.reused_existing_shop = true;
      result.shop_name = getShopVisibleName(reusable) || meaningfulRealName;
      result.collector_shop_id = reusable.collector_shop_id;
      result.duplicate_collector_shop_id = req.params.collectorShopId;
      result.erp_shop_id = reusable.id;
      result.duplicate = duplicate;
      result.collector_delete = collectorDelete;
      result.collector_delete_warning = collectorDeleteWarning;
      result.remote = remote;
      return res.json(result);
    }

    db.prepare(`
      UPDATE shops SET
        real_name = CASE WHEN ? != '' THEN ? ELSE real_name END,
        name = CASE WHEN ? != '' THEN ? ELSE name END,
        collector_status = ?,
        last_login_check_at = ?
      WHERE collector_shop_id = ?
    `).run(
      meaningfulRealName,
      meaningfulRealName,
      meaningfulRealName,
      meaningfulRealName,
      nextStatus,
      checkedAt,
      req.params.collectorShopId,
    );
    const shop = getShopByCollectorId(db, req.params.collectorShopId);
    const remote = shop ? await syncCollectorShopsToRemote(req, [{
      shop_id: shop.collector_shop_id,
      platform: shop.platform,
      shop_name: meaningfulRealName || shop.real_name || shop.name,
      session_valid: result.session_valid,
      updated_at: checkedAt,
      last_collect_at: shop.last_collect_at,
    }]) : null;
    if (result?.session_valid === false || result?.security_paused) {
      const issue = insertCollectorIssue(db, {
        level: result?.security_paused ? 'warning' : 'info',
        source: 'login_check',
        title: result?.security_paused ? '店铺出现安全验证' : '店铺会话未确认',
        message: result?.security_reason || result?.current_url || '登录检查未通过',
        collector_shop_id: req.params.collectorShopId,
        platform: shop?.platform,
        details: result,
      }, req.user?.id || null);
      await reportCollectorIssueToRemote(req, issue);
    }
    result.remote = remote;
    res.json(result);
  } catch (err) {
    const db = getDb();
    const issue = insertCollectorIssue(db, {
      level: 'error',
      source: 'login_check',
      title: '登录检查失败',
      message: err.message,
      collector_shop_id: req.params.collectorShopId,
      details: { status: err.status, body: err.body, stack: err.stack },
    }, req.user?.id || null);
    await reportCollectorIssueToRemote(req, issue);
    next(err);
  }
});

router.post('/shops/:collectorShopId/collect-orders', async (req, res, next) => {
  try {
    const full = req.query.full === '1' || req.body?.full === true;
    const db = getDb();
    const shop = getShopByCollectorId(db, req.params.collectorShopId);
    if (!shop) {
      return res.status(404).json({ message: 'ERP 中找不到对应店铺' });
    }

    await ensureLocalCollectorShop(shop, req.body || {});
    res.json(await collectOrdersForShop(db, shop, req.user.id, full, req));
  } catch (err) {
    next(err);
  }
});

router.get('/polling', adminMiddleware, (req, res) => {
  const db = getDb();
  res.json(pollingStatus(db));
});

router.post('/polling', adminMiddleware, async (req, res, next) => {
  try {
    const db = getDb();
    loadPollingSettings(db);
    pollState.enabled = req.body?.enabled === true;
    pollState.intervalMinutes = normalizePollIntervalMinutes(req.body?.interval_minutes);
    pollState.userId = req.user.id;
    pollState.token = pollState.enabled ? (req.headers.authorization || '') : null;
    pollState.lastError = null;

    if (pollState.enabled) {
      ensurePollSchedule(db, true);
      startPollingTimer();
    } else {
      pollState.nextRunByShop.clear();
      stopPollingTimer();
    }

    savePollingSettings(db);
    res.json(pollingStatus(db));
  } catch (err) {
    next(err);
  }
});

router.post('/polling/run-once', adminMiddleware, async (req, res, next) => {
  try {
    const db = getDb();
    loadPollingSettings(db);
    if (!pollState.enabled) {
      return res.status(409).json({ ok: false, message: '轮询未开启，请先开启轮询再自检' });
    }
    const result = await runPollingTick('manual_self_test', {
      force: req.body?.force !== false,
      req,
    });
    res.json(result || pollingStatus(db));
  } catch (err) {
    next(err);
  }
});

router.post('/polling/schedule-test', adminMiddleware, async (req, res, next) => {
  try {
    const db = getDb();
    loadPollingSettings(db);
    if (!pollState.enabled) {
      return res.status(409).json({ ok: false, message: '轮询未开启，请先开启轮询再安排定时实测' });
    }

    const shops = ensurePollSchedule(db, false);
    const requestedShopId = String(req.body?.collector_shop_id || '').trim();
    const targetShop = requestedShopId
      ? shops.find((shop) => shop.collector_shop_id === requestedShopId)
      : shops.slice().sort((a, b) => {
          const aNext = pollState.nextRunByShop.get(a.collector_shop_id) || Infinity;
          const bNext = pollState.nextRunByShop.get(b.collector_shop_id) || Infinity;
          return aNext - bNext;
        })[0];

    if (!targetShop) {
      return res.status(404).json({
        ok: false,
        message: requestedShopId ? '该店铺当前不在轮询队列中' : '当前没有可轮询店铺',
      });
    }

    const delaySeconds = Math.min(600, Math.max(30, Number(req.body?.delay_seconds || 60)));
    const nextRunAtMs = Date.now() + delaySeconds * 1000;
    pollState.nextRunByShop.set(targetShop.collector_shop_id, nextRunAtMs);
    pollState.lastCheck = {
      reason: 'schedule_test',
      at: new Date().toISOString(),
      due: false,
      scheduled_test: true,
      eligible_shop_count: shops.length,
      erp_shop_id: targetShop.id,
      collector_shop_id: targetShop.collector_shop_id,
      platform: targetShop.platform,
      name: targetShop.real_name || targetShop.name,
      next_run_at: new Date(nextRunAtMs).toISOString(),
      message: `已安排 ${targetShop.real_name || targetShop.name} 在 ${delaySeconds} 秒后由后台轮询自动执行`,
    };

    res.json({
      ok: true,
      scheduled_test: true,
      delay_seconds: delaySeconds,
      erp_shop_id: targetShop.id,
      collector_shop_id: targetShop.collector_shop_id,
      platform: targetShop.platform,
      name: targetShop.real_name || targetShop.name,
      next_run_at: new Date(nextRunAtMs).toISOString(),
      polling: pollingStatus(db),
    });
  } catch (err) {
    next(err);
  }
});

router.get('/shops/:collectorShopId/export/latest', async (req, res, next) => {
  try {
    res.json(await collectorRequest(`/api/shops/${req.params.collectorShopId}/exports/latest?task=orders`));
  } catch (err) {
    next(err);
  }
});

router.get('/shops/:collectorShopId/logs', async (req, res, next) => {
  try {
    const limit = Number(req.query.limit || 100);
    res.json(await collectorRequest(`/api/shops/${req.params.collectorShopId}/logs?limit=${limit}`));
  } catch (err) {
    next(err);
  }
});

router.post('/shops/:collectorShopId/reveal-sensitive', async (req, res, next) => {
  try {
    res.json(await collectorRequest(`/api/shops/${req.params.collectorShopId}/orders/reveal-sensitive`, {
      method: 'POST',
      body: JSON.stringify(req.body || {}),
    }));
  } catch (err) {
    next(err);
  }
});

router.use((err, req, res, next) => {
  if (err.status) {
    return res.status(err.status).json({ message: err.message, detail: err.body });
  }
  if (err.cause?.code === 'ECONNREFUSED' || /fetch failed/i.test(err.message)) {
    return res.status(503).json({ message: '采集器未启动，请先打开店铺采集器程序' });
  }
  next(err);
});

if (COLLECTOR_CONTROL_ENABLED) {
  const bootTimer = setTimeout(() => {
    try {
      loadPollingSettings(getDb());
    } catch (err) {
      pollState.lastError = {
        message: err.message,
        at: new Date().toISOString(),
      };
    }
  }, 1000);
  bootTimer.unref?.();
}

export default router;
