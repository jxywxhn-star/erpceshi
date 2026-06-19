import axios from 'axios';
import request, { collectorRequest } from './request';

export const authApi = {
  login: (data) => request.post('/auth/login', data),
  changePassword: (data) => request.post('/auth/change-password', data),
};

export const userApi = {
  list: () => request.get('/users'),
  create: (data) => request.post('/users', data),
  update: (id, data) => request.put(`/users/${id}`, data),
  delete: (id) => request.delete(`/users/${id}`),
};

export const shopApi = {
  list: () => request.get('/shops'),
  create: (data) => request.post('/shops', data),
  update: (id, data) => request.put(`/shops/${id}`, data),
  delete: (id, force = false) => request.delete(`/shops/${id}${force ? '?force=1' : ''}`),
};

export const collectorApi = {
  config: () => collectorRequest.get('/collector/config'),
  saveConfig: (data) => collectorRequest.post('/collector/config', data),
  status: () => collectorRequest.get('/collector/status'),
  polling: () => collectorRequest.get('/collector/polling'),
  savePolling: (data) => collectorRequest.post('/collector/polling', data),
  runPollingOnce: (data) => collectorRequest.post('/collector/polling/run-once', data),
  schedulePollingTest: (data) => collectorRequest.post('/collector/polling/schedule-test', data),
  shops: () => collectorRequest.get('/collector/shops'),
  syncShops: () => collectorRequest.post('/collector/shops/sync'),
  createShop: (platform) => collectorRequest.post('/collector/shops', { platform }),
  openShop: (collectorShopId, data = {}) => collectorRequest.post(`/collector/shops/${collectorShopId}/open`, data),
  deleteShop: (collectorShopId) => collectorRequest.delete(`/collector/shops/${collectorShopId}`),
  loginCheck: (collectorShopId, data = {}) => collectorRequest.post(`/collector/shops/${collectorShopId}/login-check`, data),
  collectOrders: (collectorShopId, full = false, data = {}) => collectorRequest.post(`/collector/shops/${collectorShopId}/collect-orders${full ? '?full=1' : ''}`, data),
  latestExport: (collectorShopId) => collectorRequest.get(`/collector/shops/${collectorShopId}/export/latest`),
  logs: (collectorShopId, limit = 100) => collectorRequest.get(`/collector/shops/${collectorShopId}/logs`, { params: { limit } }),
  // 解密/任务：走 collectorRequest（采集器 EXE 窗口内会指向本机采集器），由采集器执行回传
  revealSensitive: (collectorShopId, data) => collectorRequest.post(`/collector/shops/${collectorShopId}/reveal-sensitive`, data),
  createTask: (type, collectorShopId, payload) => collectorRequest.post('/collector/tasks', { type, collector_shop_id: collectorShopId, payload: payload || {} }),
  getTask: (id) => collectorRequest.get(`/collector/tasks/${id}`),
  issues: (params) => collectorRequest.get('/collector/issues', { params }),
  resolveIssue: (id) => collectorRequest.patch(`/collector/issues/${id}/resolve`),
  deleteIssue: (id) => collectorRequest.delete(`/collector/issues/${id}`),
  // 店铺概览：直连本地采集器(127.0.0.1:5069) 采集/读取 SyCM 概览
  overview: async (collectorShopId) => {
    const res = await axios.post(`http://127.0.0.1:5069/api/shops/${collectorShopId}/collect/overview`, {}, { timeout: 60000 });
    return res.data;
  },
  overviewLatest: async (collectorShopId) => {
    const res = await axios.get(`http://127.0.0.1:5069/api/shops/${collectorShopId}/exports/overview`, { timeout: 15000 });
    return res.data;
  },
  uploadLogs: async () => {
    const token = localStorage.getItem('token') || '';
    const serverBaseUrl = window.location.origin;

    try {
      const response = await axios.post('http://127.0.0.1:5069/api/collector/logs/upload', {
        serverBaseUrl,
        authorization: token ? `Bearer ${token}` : '',
        reason: 'manual_from_erp_direct',
      }, { timeout: 30000 });
      return response.data;
    } catch {
      return collectorRequest.post('/collector/logs/upload', { reason: 'manual_from_erp' });
    }
  },
};

// 采集器“忙/不可直连”判断：直连失败则改走任务队列
function isCollectorBusy(res) {
  return res && res.ok === false && (res.busy === true || res.reason === 'shop_capture_already_running');
}

// 轮询任务直到完成，拿回结果（采集器底座执行后回传）
async function pollCollectorTask(id, { timeout = 90000, interval = 2000 } = {}) {
  const deadline = Date.now() + timeout;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const o = await collectorApi.getTask(id);
    if (o.status === 'done') return o.result;
    if (o.status === 'failed') throw new Error(o.error || '任务执行失败');
    if (Date.now() > deadline) throw new Error('任务超时（请确认本地采集器/桥接在运行）');
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, interval));
  }
}

// 智能采集器调用：先直连本机采集器，失败/忙则下发任务由底座执行并回传
export const collectorSmart = {
  // 中心服务器不直接控制采集，所有真实操作都由采集器从本地执行：直接走任务队列
  reveal: async (collectorShopId, orderId) => {
    const n = await collectorApi.createTask('reveal_sensitive', collectorShopId, { orderId: String(orderId) });
    return pollCollectorTask(n.id, { timeout: 120000 });
  },
  overview: async (collectorShopId) => {
    try {
      const n = await collectorApi.overview(collectorShopId);
      if (!isCollectorBusy(n)) return n;
    } catch { /* 直连不可用，转任务队列 */ }
    const t = await collectorApi.createTask('overview', collectorShopId, {});
    return pollCollectorTask(t.id, { timeout: 150000 });
  },
};

export const orderApi = {
  list: (params) => request.get('/orders', { params }),
  summary: (params) => request.get('/orders/summary', { params }),
  create: (data) => request.post('/orders', data),
  update: (id, data) => request.put(`/orders/${id}`, data),
  batchUpdateStatus: (data) => request.patch('/orders/batch/status', data),
  delete: (id) => request.delete(`/orders/${id}`),
  // 工厂协作（管理端）
  factories: () => request.get('/orders/factories'),
  pushFactory: (id, data) => request.post(`/orders/${id}/push-factory`, data),
  approveQuote: (id) => request.post(`/orders/${id}/approve-quote`),
  cancelFactory: (id) => request.post(`/orders/${id}/cancel-factory`),
  // 订单分类（成品/定制）
  productSuggestions: (id) => request.get(`/orders/${id}/product-suggestions`),
  classify: (id, data) => request.post(`/orders/${id}/classify`, data),
  markCustom: (id) => request.post(`/orders/${id}/mark-custom`),
  saveAsProduct: (id, data) => request.post(`/orders/${id}/save-as-product`, data),
  saveReceiver: (id, data) => request.post(`/orders/${id}/save-receiver`, data),
};

// 成品库（仅管理员）
export const productApi = {
  list: () => request.get('/products'),
  create: (data) => request.post('/products', data),
  update: (id, data) => request.put(`/products/${id}`, data),
  delete: (id) => request.delete(`/products/${id}`),
  addAlias: (id, data) => request.post(`/products/${id}/aliases`, data),
  deleteAlias: (aliasId) => request.delete(`/products/aliases/${aliasId}`),
};

// 工厂门户（工厂账号专用）—— 简化：仅查看 + 发货回传单号 + 下载生产包
export const factoryApi = {
  orders: (params) => request.get('/factory/orders', { params }),
  summary: () => request.get('/factory/summary'),
  ship: (id, data) => request.post(`/factory/orders/${id}/ship`, data),
  packageUrl: (id) => `/factory/orders/${id}/package`,
  downloadPackage: (id) => request.get(`/factory/orders/${id}/package`, { responseType: 'blob' }),
};

// 图片上传，返回 { url }
export const uploadApi = {
  image: (dataUrl) => request.post('/uploads', { image: dataUrl }),
};

export const expenseApi = {
  list: (params) => request.get('/expenses', { params }),
  create: (data) => request.post('/expenses', data),
  update: (id, data) => request.put(`/expenses/${id}`, data),
  delete: (id) => request.delete(`/expenses/${id}`),
};

export const reportApi = {
  overview: (params) => request.get('/reports/overview', { params }),
  byShop: (params) => request.get('/reports/by-shop', { params }),
  shopDaily: (params) => request.get('/reports/shop-daily', { params }),
  byHandler: (params) => request.get('/reports/by-handler', { params }),
  daily: (params) => request.get('/reports/daily', { params }),
};

export const ocrApi = {
  analyze: (data) => request.post('/ocr/analyze', data),
};

// 千牛采集数据（经营指标 / 店铺信用 / 商品诊断），由桌面连接器推送入库
export const qianniuApi = {
  overview: () => request.get('/qianniu/overview'),
  credit: () => request.get('/qianniu/credit'),
  diagnosis: (params) => request.get('/qianniu/diagnosis', { params }),
  shopStatus: () => request.get('/qianniu/shop-status'),
};

export const settingsApi = {
  get: () => request.get('/settings'),
  save: (data) => request.post('/settings', data),
  tokenUsage: (params) => request.get('/settings/token-usage', { params }),
};
