// 工厂协作状态：标签文案 + Tag 颜色，前端各页统一引用
export const FACTORY_STATUS_META = {
  pushed: { label: '待发货', color: 'blue' },
  shipped: { label: '已发货', color: 'green' },
};

export function factoryStatusLabel(status) {
  return FACTORY_STATUS_META[status]?.label || (status ? status : '未推送');
}

export function factoryStatusColor(status) {
  return FACTORY_STATUS_META[status]?.color || 'default';
}

// 工厂工作台分组顺序（待办在前）
export const FACTORY_BOARD_ORDER = ['pushed', 'shipped'];

// 订单分类：成品 / 定制 / 待确认
export const ORDER_CATEGORY_META = {
  finished: { label: '成品', color: 'green' },
  custom: { label: '定制', color: 'orange' },
  unclassified: { label: '待确认', color: 'default' },
};

export function orderCategoryKey(order) {
  if (order?.order_category === 'finished') return 'finished';
  if (order?.order_category === 'custom') return 'custom';
  return 'unclassified';
}

// 安全解析图片 JSON 数组字段
export function parseImages(value) {
  if (Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return [];
  try {
    const arr = JSON.parse(value);
    return Array.isArray(arr) ? arr.filter((x) => typeof x === 'string' && x) : [];
  } catch {
    return [];
  }
}
