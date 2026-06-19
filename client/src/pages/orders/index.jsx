import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  DatePicker,
  Form,
  Image,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  Upload,
  message,
} from 'antd';
import { EditOutlined, EyeOutlined, PlusOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { useSearchParams } from 'react-router-dom';
import { collectorApi, collectorSmart, orderApi, shopApi, uploadApi } from '../../api';
import { useResponsive } from '../../hooks/useResponsive';
import { factoryStatusLabel, factoryStatusColor, parseImages, orderCategoryKey, ORDER_CATEGORY_META } from '../../constants/factory';

// 高清优先：素材图直接读原图为 dataURL，不压缩
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

function urlsToFileList(urls) {
  return urls.map((url, idx) => ({ uid: `saved-${idx}-${url}`, name: `图片${idx + 1}`, status: 'done', url }));
}

// 从采集数据带出"码数"默认值（颜色：尺码-数量件）
function deriveSize(record) {
  try {
    const j = JSON.parse(record.raw_json || '{}');
    const it = (j.Items && j.Items[0]) || {};
    const t = it.SkuText;
    if (!t) return '';
    if (typeof t === 'string') return t;
    const color = t['颜色分类'] || t.color || '';
    const size = t['尺码'] || t.size || '';
    const qty = record.factory_quantity > 0 ? record.factory_quantity : (record.quantity || 1);
    if (color || size) return `${color}${color && size ? '：' : ''}${size}-${qty}件`;
    return '';
  } catch {
    return '';
  }
}

// 从采集数据带出商品规格(颜色/码数)用于展示。兼容千牛(SkuName) 与旧采集器(SkuText)。
function getSku(record) {
  try {
    const j = JSON.parse(record.raw_json || '{}');
    const it = (j.Items && j.Items[0]) || {};
    let s = it.SkuName || it.SkuText || it.sku || '';
    if (s && typeof s === 'object') {
      const color = s['颜色分类'] || s.color || '';
      const size = s['尺码'] || s.size || '';
      s = [size, color].filter(Boolean).join(' / ');
    }
    return String(s || '').replace(/\s+/g, ' ').trim();
  } catch {
    return '';
  }
}

function fileListToUrls(fileList) {
  return (fileList || [])
    .filter((f) => f.status === 'done')
    .map((f) => f.url || f.response?.url)
    .filter(Boolean);
}

// 素材图上传区（多图、不压缩）
function ImageUploader({ fileList, onChange }) {
  const customRequest = async ({ file, onSuccess, onError }) => {
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await uploadApi.image(dataUrl);
      onSuccess(res, file);
    } catch (err) {
      onError(err);
    }
  };

  const onPreview = (file) => {
    const url = file.url || file.response?.url;
    if (url) window.open(url, '_blank', 'noopener');
  };

  return (
    <Upload
      listType="picture-card"
      fileList={fileList}
      accept="image/*"
      multiple
      customRequest={customRequest}
      onChange={({ fileList: fl }) => onChange(fl)}
      onPreview={onPreview}
    >
      <div>
        <PlusOutlined />
        <div style={{ marginTop: 4 }}>上传</div>
      </div>
    </Upload>
  );
}

const { RangePicker } = DatePicker;
const { Text } = Typography;

const STATUS_MAP = {
  unpaid: { text: '未付款', color: 'default' },
  unprocessed: { text: '未处理', color: 'red' },
  ordered_not_uploaded: { text: '已拍单未上传安抚单', color: 'orange' },
  ordered_waiting_tracking: { text: '已拍单等待同步单号', color: 'blue' },
  completed: { text: '处理完成', color: 'green' },
};

const imageFallback =
  'data:image/svg+xml;utf8,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" width="92" height="92" viewBox="0 0 92 92"><rect width="92" height="92" rx="8" fill="#f3f4f6"/><path d="M25 61l12-14 10 10 8-9 12 13H25z" fill="#cbd5e1"/><circle cx="35" cy="34" r="7" fill="#cbd5e1"/></svg>',
  );

const SHIP_DEADLINE_HOURS = 48;

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function parseOrderTime(record) {
  const value = record.platform_created_at || record.created_at;
  if (!value) return null;
  const text = String(value);
  const date = /^\d{13}$/.test(text)
    ? dayjs(Number(text))
    : /^\d{10}$/.test(text)
      ? dayjs(Number(text) * 1000)
      : dayjs(text);
  return date.isValid() ? date : null;
}

function formatOrderTime(record) {
  const date = parseOrderTime(record);
  if (date) return date.format('YYYY-MM-DD HH:mm:ss');
  return record.platform_created_at || record.created_at || '-';
}

function normalizeWorkflowStatus(status) {
  return STATUS_MAP[status] ? status : 'unprocessed';
}

function isUnpaidOrder(record) {
  const statusText = `${record.platform_status || ''} ${record.status_description || ''}`;
  const status = normalizeWorkflowStatus(record.status);
  return status === 'unpaid'
    || (!STATUS_MAP[record.status] && /待付款|未付款|待支付|等待付款|等待买家付款|买家未付款/.test(statusText));
}

function isClosedOrCancelledOrder(record) {
  const statusText = `${record.platform_status || ''} ${record.status_description || ''}`;
  return /取消|已取消|关闭|交易关闭|作废|退款|售后/.test(statusText);
}

function isWorkflowCompleted(record) {
  return normalizeWorkflowStatus(record.status) === 'completed';
}

function isShippedOrder(record) {
  const statusText = `${record.platform_status || ''} ${record.status_description || ''}`;
  return Boolean(record.tracking_no)
    || /已出库|已发货|待买家确认|待收货|交易成功|已完成|已签收|签收|已完结/.test(statusText);
}

function formatDuration(ms) {
  const totalMinutes = Math.max(1, Math.ceil(Math.abs(ms) / 60000));
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${days}天${hours}小时`;
  if (hours > 0) return `${hours}小时${minutes}分`;
  return `${minutes}分`;
}

function getShippingRisk(record) {
  if (isWorkflowCompleted(record)) {
    return { level: 'completed' };
  }
  if (isUnpaidOrder(record)) {
    return { level: 'unpaid' };
  }
  if (isClosedOrCancelledOrder(record)) {
    return { level: 'not_required' };
  }
  if (isShippedOrder(record)) {
    return { level: 'shipped' };
  }

  const orderTime = parseOrderTime(record);
  if (!orderTime) return { level: 'unknown' };

  const deadline = orderTime.add(SHIP_DEADLINE_HOURS, 'hour');
  const diff = deadline.diff(dayjs());
  if (diff < 0) return { level: 'overdue', deadline, diff };
  if (diff <= 6 * 60 * 60 * 1000) return { level: 'due_soon', deadline, diff };
  return { level: 'normal', deadline, diff };
}

function renderShipDeadline(record) {
  const risk = getShippingRisk(record);
  if (risk.level === 'unpaid') {
    return <Text type="secondary">未付款</Text>;
  }
  if (risk.level === 'shipped') {
    return <Tag color="green">已发货</Tag>;
  }
  if (risk.level === 'completed') {
    return <Tag color="green">处理完成</Tag>;
  }
  if (risk.level === 'not_required') {
    return <Text type="secondary">无需发货</Text>;
  }
  if (!risk.deadline) return '-';

  return (
    <Space direction="vertical" size={2}>
      <Tag color={risk.level === 'overdue' ? 'red' : risk.level === 'due_soon' ? 'orange' : 'blue'}>
        {risk.level === 'overdue' ? `已超时${formatDuration(risk.diff)}` : `${formatDuration(risk.diff)}内需发货`}
      </Tag>
      <Text type="secondary" style={{ fontSize: 12 }}>
        截止 {risk.deadline.format('MM-DD HH:mm')}
      </Text>
    </Space>
  );
}

function renderMoneyInfo(record, onSave) {
  const profit = Number(record.price || 0) - Number(record.refund_amount || 0) - Number(record.cost || 0);

  return (
    <Space direction="vertical" size={1} style={{ width: '100%' }}>
      <div className="money-stack-row">
        <Text type="secondary">金额</Text>
        <EditableCell record={record} field="price" type="number" onSave={onSave} />
      </div>
      <div className="money-stack-row">
        <Text type="secondary">成本</Text>
        <EditableCell record={record} field="cost" type="number" onSave={onSave} />
      </div>
      <div className="money-stack-row">
        <Text type="secondary">利润</Text>
        {isUnpaidOrder(record) ? (
          <Text type="secondary">未付款</Text>
        ) : (
          <Text type={profit >= 0 ? 'success' : 'danger'}>{money(profit)}</Text>
        )}
      </div>
    </Space>
  );
}

function getPlatformMeta(record) {
  const value = [
    record.shop_platform,
    record.platform,
    record.collector_shop_id,
    record.shop_real_name,
    record.shop_name,
    record.order_no,
  ].map((item) => String(item || '').toLowerCase()).join(' ');
  if (value.includes('jd') || value.includes('jingdong') || value.includes('京东')) {
    return { key: 'jd', text: '京东', color: '#d4380d', className: 'platform-jd' };
  }
  if (value.includes('taobao') || value.includes('tb') || value.includes('淘宝')) {
    return { key: 'taobao', text: '淘宝', color: '#d46b08', className: 'platform-taobao' };
  }
  return { key: 'other', text: '平台', color: '#4b5563', className: 'platform-other' };
}

function renderOrderTitle(record, openDetail, onSave) {
  const platform = getPlatformMeta(record);
  const shopName = record.shop_real_name || record.shop_name || '-';
  const sku = getSku(record);

  return (
    <div className={`order-platform-cell ${platform.className}`}>
      <Image
        width={54}
        height={54}
        src={record.main_image_url || imageFallback}
        fallback={imageFallback}
        referrerPolicy="no-referrer"
        preview={Boolean(record.main_image_url)}
        style={{ objectFit: 'cover', borderRadius: 4 }}
      />
      <div className="order-platform-main">
        <div className="order-platform-meta">
          <Tag color={platform.color}>{platform.text}</Tag>
          <Tooltip title="查看订单详情">
            <Button type="link" size="small" className="order-no-link" onClick={() => openDetail(record)}>
              {record.order_no}
            </Button>
          </Tooltip>
          <Text type="secondary" className="order-time-text">{formatOrderTime(record)}</Text>
        </div>
        <div className="order-product-line">
          <EditableCell record={record} field="product_name" onSave={onSave} />
        </div>
        <div className="order-platform-sub">
          <span>店铺：{shopName}</span>
          <span>买家：{record.buyer_nick || '-'}</span>
          <span>数量：{record.quantity || 1}</span>
          {sku && <span>规格：{sku}</span>}
        </div>
        {(record.receiver_address || record.receiver_raw || record.receiver_name) && (
          <div className="order-receiver-line" style={{ fontSize: 12, color: '#0958d9', marginTop: 2 }}>
            📍 {[record.receiver_name, record.receiver_phone, record.receiver_address || record.receiver_raw].filter(Boolean).join(' ')}
          </div>
        )}
      </div>
    </div>
  );
}

function renderWorkflow(record, statusOptions, onSave) {
  const status = displayWorkflowStatus(record);
  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <Select
        size="small"
        value={status}
        options={statusOptions}
        className="order-status-select"
        onChange={(value) => onSave(record.id, { status: value })}
      />
      {status === 'unprocessed' && <Tag color="red">需要处理</Tag>}
      {status === 'ordered_not_uploaded' && <Tag color="orange">等待安抚单</Tag>}
      {status === 'ordered_waiting_tracking' && <Tag color="blue">等待单号</Tag>}
      {status === 'completed' && <Tag color="green">已完结</Tag>}
      {status === 'unpaid' && <Tag color="default">未付款不计报表</Tag>}
    </Space>
  );
}

function renderLogisticsInfo(record, onSave) {
  return (
    <div className="order-logistics-grid">
      <Text type="secondary">平台</Text>
      <Text ellipsis title={record.tracking_no || ''}>{record.tracking_no || '-'}</Text>
      <Text type="secondary">上家</Text>
      <EditableCell record={record} field="supplier_tracking_no" onSave={onSave} />
      <Text type="secondary">安抚</Text>
      <EditableCell record={record} field="comfort_tracking_no" onSave={onSave} />
    </div>
  );
}

function renderPlatformState(record) {
  return (
    <Space direction="vertical" size={4} style={{ width: '100%' }}>
      <div>{renderShipDeadline(record)}</div>
      <Text className="platform-status-text" type="secondary">
        {record.status_description || record.platform_status || '-'}
      </Text>
    </Space>
  );
}

function displayWorkflowStatus(record) {
  return isUnpaidOrder(record) ? 'unpaid' : normalizeWorkflowStatus(record.status);
}

function EditableCell({ record, field, type, options, onSave }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(field === 'status' ? normalizeWorkflowStatus(record[field]) : record[field]);

  const save = async () => {
    setEditing(false);
    if (value === record[field]) return;
    await onSave(record.id, { [field]: value });
  };

  if (!editing) {
    let display = record[field] || '-';
    if (field === 'status') {
      const item = STATUS_MAP[normalizeWorkflowStatus(record[field])];
      display = <Tag color={item.color}>{item.text}</Tag>;
    }
    if (['price', 'cost', 'refund_amount'].includes(field)) display = money(record[field]);

    return (
      <button type="button" className="inline-edit" onClick={() => setEditing(true)}>
        <span>{display}</span>
        <EditOutlined />
      </button>
    );
  }

  if (type === 'select') {
    return (
      <Select
        size="small"
        autoFocus
        open
        value={value}
        options={options}
        style={{ width: '100%' }}
        onChange={(next) => { setValue(next); setTimeout(save, 0); }}
        onBlur={() => setEditing(false)}
      />
    );
  }

  if (type === 'number') {
    return (
      <InputNumber
        size="small"
        autoFocus
        min={0}
        precision={field === 'quantity' ? 0 : 2}
        value={value}
        style={{ width: '100%' }}
        onChange={setValue}
        onBlur={save}
        onPressEnter={save}
      />
    );
  }

  return (
    <Input
      size="small"
      autoFocus
      value={value || ''}
      onChange={(event) => setValue(event.target.value)}
      onBlur={save}
      onPressEnter={save}
    />
  );
}

export default function Orders() {
  const [orders, setOrders] = useState([]);
  const [shops, setShops] = useState([]);
  const [total, setTotal] = useState(0);
  const [summary, setSummary] = useState({});
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [editingOrder, setEditingOrder] = useState(null);
  const [detailOpen, setDetailOpen] = useState(false);
  const [searchKeyword, setSearchKeyword] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDelivery, setFilterDelivery] = useState('');
  const [filterShop, setFilterShop] = useState('');
  const [dateRange, setDateRange] = useState(null);
  const [selectedRowKeys, setSelectedRowKeys] = useState([]);
  const [bulkStatus, setBulkStatus] = useState('unprocessed');
  const [bulkUpdating, setBulkUpdating] = useState(false);
  // 订单解密：网页下发任务→采集器执行→回传，解出收件人(可编辑后保存)
  const [reveal, setReveal] = useState({ open: false, loading: false, record: null, name: '', phone: '', address: '', raw: '', error: '' });
  const { isMobile } = useResponsive();
  const [searchParams] = useSearchParams();
  const [form] = Form.useForm();

  // 工厂协作
  const [factories, setFactories] = useState([]);
  const [pushOpen, setPushOpen] = useState(false);
  const [pushOrder, setPushOrder] = useState(null);
  const [pushForm] = Form.useForm();
  const [effectList, setEffectList] = useState([]);
  const [baseList, setBaseList] = useState([]);
  const [pushing, setPushing] = useState(false);

  // 订单分类
  const [filterCategory, setFilterCategory] = useState('');
  const [classifyOpen, setClassifyOpen] = useState(false);
  const [classifyOrder, setClassifyOrder] = useState(null);
  const [suggestions, setSuggestions] = useState([]);
  const [classifyProductId, setClassifyProductId] = useState(null);
  const [saveProductOpen, setSaveProductOpen] = useState(false);
  const [saveProductOrder, setSaveProductOrder] = useState(null);
  const [saveProductForm] = Form.useForm();

  const fetchOrders = async (nextPage = page) => {
    setLoading(true);
    try {
      const params = { page: nextPage, pageSize: isMobile ? 10 : 20 };
      if (searchKeyword) params.keyword = searchKeyword;
      if (filterStatus) params.status = filterStatus;
      if (filterDelivery) params.delivery_status = filterDelivery;
      if (filterCategory) params.order_category = filterCategory;
      if (filterShop) params.shop_id = filterShop;
      if (dateRange?.length === 2) {
        params.start_date = dateRange[0].format('YYYY-MM-DD');
        params.end_date = dateRange[1].format('YYYY-MM-DD');
      }
      const summaryParams = { ...params };
      delete summaryParams.page;
      delete summaryParams.pageSize;
      delete summaryParams.status;
      delete summaryParams.delivery_status;

      const [res, summaryRes] = await Promise.all([
        orderApi.list(params),
        orderApi.summary(summaryParams),
      ]);
      setOrders(res.list || []);
      setTotal(res.total || 0);
      setSummary(summaryRes || {});
    } finally {
      setLoading(false);
    }
  };

  const fetchShops = async () => {
    const res = await shopApi.list();
    setShops(res || []);
  };

  const fetchFactories = async () => {
    try {
      const res = await orderApi.factories();
      setFactories(res || []);
    } catch {
      setFactories([]);
    }
  };

  useEffect(() => {
    fetchShops();
    fetchFactories();
  }, []);

  useEffect(() => {
    const queryStatus = searchParams.get('status');
    const queryDelivery = searchParams.get('delivery_status');
    if (queryStatus) {
      setFilterStatus(queryStatus);
      setPage(1);
    }
    if (queryDelivery) {
      setFilterDelivery(queryDelivery);
      setPage(1);
    }
  }, [searchParams]);

  useEffect(() => {
    setSelectedRowKeys([]);
    fetchOrders();
  }, [page, filterStatus, filterDelivery, filterCategory, filterShop, dateRange, isMobile]);

  const openDetail = (record) => {
    setEditingOrder(record);
    form.setFieldsValue({ ...record, status: displayWorkflowStatus(record) });
    setDetailOpen(true);
  };

  const handleSaveDetail = async () => {
    const values = await form.validateFields();
    await orderApi.update(editingOrder.id, values);
    message.success('订单已更新');
    setDetailOpen(false);
    fetchOrders();
  };

  const handleDelete = async (id) => {
    await orderApi.delete(id);
    message.success('订单已删除，并加入同步忽略列表');
    fetchOrders();
  };

  const handleInlineSave = useCallback(async (id, updates) => {
    await orderApi.update(id, updates);
    setOrders((prev) => prev.map((order) => (order.id === id ? { ...order, ...updates } : order)));
    message.success('已更新');
    if (updates.status !== undefined) {
      fetchOrders(page);
    }
  }, [page]);

  const openPush = (record) => {
    setPushOrder(record);
    pushForm.setFieldsValue({
      factory_id: record.factory_id || undefined,
      factory_spec: record.factory_spec || '',
      factory_size: record.factory_size || deriveSize(record),
      factory_print: record.factory_print || '',
      factory_quantity: record.factory_quantity || undefined,
    });
    setEffectList(urlsToFileList(parseImages(record.factory_effect_images)));
    setBaseList(urlsToFileList(parseImages(record.factory_base_images)));
    setPushOpen(true);
  };

  const handlePushSubmit = async () => {
    const values = await pushForm.validateFields();
    setPushing(true);
    try {
      await orderApi.pushFactory(pushOrder.id, {
        factory_id: values.factory_id,
        factory_spec: values.factory_spec || '',
        factory_size: values.factory_size || '',
        factory_print: values.factory_print || '',
        factory_quantity: values.factory_quantity || 0,
        factory_effect_images: fileListToUrls(effectList),
        factory_base_images: fileListToUrls(baseList),
      });
      message.success('已推送给工厂');
      setPushOpen(false);
      fetchOrders(page);
    } finally {
      setPushing(false);
    }
  };

  // 解密：网页下发任务→采集器执行→回传，解出收件人（含真实地址），可人工编辑后保存
  const handleReveal = async (record) => {
    if (!record?.collector_shop_id || !record?.order_no) {
      message.warning('该订单缺少采集器店铺ID或平台订单号，无法解密');
      return;
    }
    setReveal({ open: true, loading: true, record, name: '', phone: '', address: '', raw: '', error: '' });
    try {
      const res = await collectorSmart.reveal(record.collector_shop_id, record.order_no);
      const d = res?.result || res || {};
      const name = d.receiver_name || d.name || '';
      const phone = d.receiver_phone || d.phone || '';
      const raw = d.receiver_raw || d.decrypted_raw || '';
      let address = d.receiver_address || d.address || '';
      if (!address && raw) address = raw;
      if (name || phone || address || raw) {
        setReveal({ open: true, loading: false, record, name, phone, address, raw, error: '' });
      } else {
        setReveal({ open: true, loading: false, record, name: '', phone: '', address: '', raw: '', error: d?.reason || d?.message || '未解出收件人信息（请确认该订单为待发货/待出库状态且采集器已登录）' });
      }
    } catch (err) {
      setReveal({ open: true, loading: false, record, name: '', phone: '', address: '', raw: '', error: err?.response?.data?.message || err?.message || '解密失败，请确认采集器在运行' });
    }
  };

  // 保存（可编辑后的）收件信息到订单，供推送工厂代发货 + 列表展示
  const handleSaveReceiver = async () => {
    const { record, name, phone, address } = reveal;
    if (!record) return;
    if (!name && !phone && !address) { message.warning('请至少填写地址'); return; }
    await orderApi.saveReceiver(record.id, {
      receiver_name: name || '',
      receiver_phone: phone || '',
      receiver_address: address || '',
      receiver_raw: [name, phone, address].filter(Boolean).join(' '),
    });
    message.success('已保存收件信息到订单');
    setReveal((s) => ({ ...s, open: false }));
    fetchOrders(page);
  };

  const openClassify = async (record) => {
    setClassifyOrder(record);
    setClassifyProductId(null);
    setSuggestions([]);
    setClassifyOpen(true);
    try {
      const res = await orderApi.productSuggestions(record.id);
      setSuggestions(res || []);
      if (res && res.length && res[0].score > 0) setClassifyProductId(res[0].id);
    } catch { /* 拦截器提示 */ }
  };

  const handleClassifySubmit = async () => {
    if (!classifyProductId) { message.warning('请选择要归入的成品'); return; }
    await orderApi.classify(classifyOrder.id, { product_id: classifyProductId });
    message.success('已归类为成品');
    setClassifyOpen(false);
    fetchOrders(page);
  };

  const handleMarkCustom = async (record) => {
    await orderApi.markCustom(record.id);
    message.success('已标为定制');
    fetchOrders(page);
  };

  const handlePushFinished = async (record) => {
    await orderApi.pushFactory(record.id, {});
    message.success('成品已推送，直接进入待制作');
    fetchOrders(page);
  };

  const handleSaveProductSubmit = async () => {
    const values = await saveProductForm.validateFields();
    await orderApi.saveAsProduct(saveProductOrder.id, values);
    message.success('已存为成品，后续同商品自动套用');
    setSaveProductOpen(false);
    fetchOrders(page);
  };

  const handleCancelFactory = async (record) => {
    await orderApi.cancelFactory(record.id);
    message.success('已撤回工厂推送');
    fetchOrders(page);
  };

  const handleSearch = () => {
    setPage(1);
    fetchOrders(1);
  };

  const statusOptions = Object.entries(STATUS_MAP).map(([value, item]) => ({ value, label: item.text }));
  const statusFilterOptions = [
    { value: 'not_completed', label: '全部未完成处理' },
    ...statusOptions,
  ];
  const deliveryFilterOptions = [
    { value: 'unshipped', label: '全部未发货' },
    { value: 'due_soon', label: '6小时内到期' },
    { value: 'overdue', label: '已超时' },
  ];

  const handleBatchUpdateStatus = async () => {
    if (selectedRowKeys.length === 0) {
      message.warning('请先勾选订单');
      return;
    }
    setBulkUpdating(true);
    try {
      const res = await orderApi.batchUpdateStatus({ ids: selectedRowKeys, status: bulkStatus });
      message.success(`已批量更新 ${res.updated || 0} 个订单`);
      setSelectedRowKeys([]);
      fetchOrders(page);
    } finally {
      setBulkUpdating(false);
    }
  };

  const rowSelection = {
    selectedRowKeys,
    onChange: (keys) => setSelectedRowKeys(keys),
  };

  const rowClassName = (record) => {
    const risk = getShippingRisk(record);
    if (risk.level === 'overdue') return 'order-row-overdue';
    if (risk.level === 'due_soon') return 'order-row-due-soon';
    return '';
  };

  const columns = [
    {
      title: '平台订单',
      key: 'product',
      width: 520,
      fixed: isMobile ? false : 'left',
      render: (_, record) => renderOrderTitle(record, openDetail, handleInlineSave),
    },
    {
      title: '业务处理',
      dataIndex: 'status',
      key: 'status',
      width: 210,
      fixed: isMobile ? false : 'left',
      render: (_, record) => renderWorkflow(record, statusOptions, handleInlineSave),
    },
    {
      title: '金额 / 成本 / 利润',
      key: 'money_info',
      width: 170,
      render: (_, record) => renderMoneyInfo(record, handleInlineSave),
    },
    {
      title: '物流单号',
      key: 'tracking',
      width: 230,
      render: (_, record) => renderLogisticsInfo(record, handleInlineSave),
    },
    {
      title: '时限 / 平台状态',
      key: 'platform_state',
      width: 190,
      render: (_, record) => renderPlatformState(record),
    },
    {
      title: '分类 / 工厂',
      key: 'factory',
      width: 150,
      fixed: isMobile ? false : 'right',
      render: (_, record) => {
        const s = record.factory_status;
        const cat = orderCategoryKey(record);
        const catMeta = ORDER_CATEGORY_META[cat];
        const factoryName = factories.find((f) => f.id === record.factory_id)?.nickname;

        // 未推送：分类标签 + 对应动作
        if (!s) {
          return (
            <Space direction="vertical" size={2} style={{ width: '100%' }}>
              <Tag color={catMeta.color} style={{ marginInlineEnd: 0 }}>{catMeta.label}</Tag>
              {cat === 'unclassified' && (
                <Space size={4} wrap>
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openClassify(record)}>归类成品</Button>
                  <Popconfirm title="标为定制？（每单需传图、工厂报价）" onConfirm={() => handleMarkCustom(record)}>
                    <Button type="link" size="small" style={{ padding: 0 }}>定制</Button>
                  </Popconfirm>
                </Space>
              )}
              {cat === 'finished' && (
                <Space size={4} wrap>
                  <Popconfirm title="推送给工厂（待发货）？复用成品库素材" onConfirm={() => handlePushFinished(record)}>
                    <Button type="link" size="small" style={{ padding: 0 }}>推送成品</Button>
                  </Popconfirm>
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openClassify(record)}>改</Button>
                </Space>
              )}
              {cat === 'custom' && (
                <Space size={4} wrap>
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openPush(record)}>推送工厂</Button>
                  <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openClassify(record)}>归类</Button>
                </Space>
              )}
            </Space>
          );
        }

        // 已推送：待发货 / 已发货
        return (
          <Space direction="vertical" size={2} style={{ width: '100%' }}>
            <Tag color={factoryStatusColor(s)} style={{ marginInlineEnd: 0 }}>{factoryStatusLabel(s)}</Tag>
            {factoryName && <Text type="secondary" style={{ fontSize: 12 }}>{factoryName}</Text>}
            {s === 'shipped' && (
              <Text type="secondary" style={{ fontSize: 12 }} ellipsis title={record.factory_tracking_no}>
                单号 {record.factory_tracking_no}
              </Text>
            )}
            {s !== 'shipped' && (
              <Space size={4} wrap>
                <Button type="link" size="small" style={{ padding: 0 }} onClick={() => openPush(record)}>修改</Button>
                <Popconfirm title="撤回工厂推送？" onConfirm={() => handleCancelFactory(record)}>
                  <Button type="link" size="small" danger style={{ padding: 0 }}>撤回</Button>
                </Popconfirm>
              </Space>
            )}
          </Space>
        );
      },
    },
    {
      title: '操作',
      key: 'action',
      width: 90,
      fixed: isMobile ? false : 'right',
      render: (_, record) => (
        <Space direction="vertical" size={2}>
          <Button type="link" size="small" onClick={() => openDetail(record)}>详情</Button>
          <Tooltip title="解密收件人地址（代发货用）">
            <Button type="link" size="small" icon={<EyeOutlined />} onClick={() => handleReveal(record)}>解密</Button>
          </Tooltip>
          <Popconfirm title="删除后再次同步不会自动恢复该订单，确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const pressureItems = [
    {
      key: 'not_completed',
      label: '未完成处理',
      value: Number(summary.not_completed_count || 0),
      color: 'red',
      onClick: () => {
        setFilterStatus('not_completed');
        setFilterDelivery('');
        setPage(1);
      },
    },
    {
      key: 'overdue',
      label: '发货已超时',
      value: Number(summary.shipping_overdue_count || 0),
      color: 'red',
      onClick: () => {
        setFilterDelivery('overdue');
        setFilterStatus('');
        setPage(1);
      },
    },
    {
      key: 'due_soon',
      label: '6小时内到期',
      value: Number(summary.shipping_due_soon_count || 0),
      color: 'orange',
      onClick: () => {
        setFilterDelivery('due_soon');
        setFilterStatus('');
        setPage(1);
      },
    },
    {
      key: 'unpaid',
      label: '未付款',
      value: Number(summary.unpaid_count || 0),
      color: 'default',
      onClick: () => {
        setFilterStatus('unpaid');
        setFilterDelivery('');
        setPage(1);
      },
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>订单中心</h3>
          <Text type="secondary">查看本地采集端同步到服务器的淘宝/京东订单</Text>
        </div>
        <Button icon={<ReloadOutlined />} onClick={() => fetchOrders()} loading={loading}>刷新</Button>
      </div>

      {Number(summary.not_completed_count || 0) > 0 && (
        <Alert
          type="error"
          showIcon
          message={`当前还有 ${summary.not_completed_count || 0} 个订单未完成处理`}
          description="新采集入库的订单都会先进入未处理流程；发货时限按下单后 48 小时计算，超时和临近到期订单会优先提示。"
          action={(
            <Button
              danger
              size="small"
              onClick={() => {
                setFilterStatus('not_completed');
                setPage(1);
              }}
            >
              立即查看
            </Button>
          )}
        />
      )}

      <Card size="small" bodyStyle={{ padding: 12 }}>
        <Space wrap>
          {pressureItems.map((item) => (
            <Button
              key={item.key}
              size="small"
              type={item.value > 0 && item.key !== 'unpaid' ? 'primary' : 'default'}
              danger={item.color === 'red' && item.value > 0}
              onClick={item.onClick}
            >
              {item.label} <Tag color={item.color} style={{ marginInlineStart: 6, marginInlineEnd: 0 }}>{item.value}</Tag>
            </Button>
          ))}
        </Space>
      </Card>

      <Card size="small">
        <Space wrap>
          <Input
            placeholder="搜索订单号、商品"
            value={searchKeyword}
            onChange={(event) => setSearchKeyword(event.target.value)}
            onPressEnter={handleSearch}
            style={{ width: isMobile ? '100%' : 240 }}
            prefix={<SearchOutlined />}
          />
          <Select
            placeholder="店铺"
            allowClear
            value={filterShop || undefined}
            onChange={(value) => { setFilterShop(value || ''); setPage(1); }}
            style={{ width: 170 }}
            options={shops.map((shop) => ({ value: String(shop.id), label: shop.real_name || shop.name }))}
          />
          <Select
            placeholder="处理状态"
            allowClear
            value={filterStatus || undefined}
            onChange={(value) => { setFilterStatus(value || ''); setPage(1); }}
            style={{ width: 180 }}
            options={statusFilterOptions}
          />
          <Select
            placeholder="发货风险"
            allowClear
            value={filterDelivery || undefined}
            onChange={(value) => { setFilterDelivery(value || ''); setPage(1); }}
            style={{ width: 160 }}
            options={deliveryFilterOptions}
          />
          <Select
            placeholder="订单分类"
            allowClear
            value={filterCategory || undefined}
            onChange={(value) => { setFilterCategory(value || ''); setPage(1); }}
            style={{ width: 150 }}
            options={[
              { value: 'unclassified', label: '待确认' },
              { value: 'finished', label: '成品' },
              { value: 'custom', label: '定制' },
            ]}
          />
          <RangePicker
            value={dateRange}
            onChange={(value) => { setDateRange(value); setPage(1); }}
            allowClear
            style={{ width: isMobile ? '100%' : 260 }}
          />
          <Button type="primary" onClick={handleSearch}>查询</Button>
        </Space>
      </Card>

      <Card
        size="small"
        bodyStyle={{
          padding: 12,
          borderLeft: selectedRowKeys.length > 0 ? '4px solid #dc2626' : '4px solid transparent',
        }}
      >
        <Space wrap>
          <Text strong>已勾选 {selectedRowKeys.length} 个订单</Text>
          <Select
            value={bulkStatus}
            options={statusOptions}
            style={{ width: 220 }}
            onChange={setBulkStatus}
          />
          <Button
            type="primary"
            danger={bulkStatus === 'unprocessed'}
            disabled={selectedRowKeys.length === 0}
            loading={bulkUpdating}
            onClick={handleBatchUpdateStatus}
          >
            批量更新处理状态
          </Button>
          <Button disabled={selectedRowKeys.length === 0} onClick={() => setSelectedRowKeys([])}>
            清空选择
          </Button>
        </Space>
      </Card>

      <Table
        className="orders-platform-table"
        rowSelection={rowSelection}
        columns={columns}
        dataSource={orders}
        rowKey="id"
        rowClassName={rowClassName}
        loading={loading}
        scroll={{ x: 1460 }}
        size="small"
        pagination={{
          current: page,
          total,
          pageSize: isMobile ? 10 : 20,
          onChange: setPage,
          showTotal: (value) => `共 ${value} 条`,
          size: isMobile ? 'small' : 'default',
        }}
      />

      <Modal
        title="订单详情"
        open={detailOpen}
        onOk={handleSaveDetail}
        onCancel={() => setDetailOpen(false)}
        width={isMobile ? '95%' : 720}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="order_no" label="订单号">
            <Input disabled />
          </Form.Item>
          <Form.Item name="product_name" label="商品名称">
            <Input />
          </Form.Item>
          <Space style={{ width: '100%' }} direction={isMobile ? 'vertical' : 'horizontal'}>
            <Form.Item name="quantity" label="数量" style={{ width: isMobile ? '100%' : 120 }}>
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="price" label="金额">
              <InputNumber min={0} precision={2} prefix="¥" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="cost" label="总成本">
              <InputNumber min={0} precision={2} prefix="¥" style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item name="refund_amount" label="退款金额">
              <InputNumber min={0} precision={2} prefix="¥" style={{ width: '100%' }} />
            </Form.Item>
          </Space>
          <Form.Item name="status" label="处理状态">
            <Select options={statusOptions} />
          </Form.Item>
          <Space style={{ width: '100%' }} direction={isMobile ? 'vertical' : 'horizontal'}>
            <Form.Item name="supplier_tracking_no" label="上家快递" style={{ flex: 1 }}>
              <Input placeholder="上家快递单号" />
            </Form.Item>
            <Form.Item name="comfort_tracking_no" label="安抚单快递" style={{ flex: 1 }}>
              <Input placeholder="安抚单快递单号" />
            </Form.Item>
          </Space>
          <Space style={{ width: '100%' }} direction={isMobile ? 'vertical' : 'horizontal'}>
            <Form.Item name="receiver_name" label="收件人" style={{ flex: 1 }}>
              <Input placeholder="解密后可在此修正" />
            </Form.Item>
            <Form.Item name="receiver_phone" label="收件电话" style={{ flex: 1 }}>
              <Input />
            </Form.Item>
          </Space>
          <Form.Item name="receiver_address" label="收件地址">
            <Input.TextArea rows={2} placeholder="地址不准时可手动编辑，工厂代发以此为准" />
          </Form.Item>
          <Form.Item name="refund_note" label="退款备注">
            <Input />
          </Form.Item>
          <Form.Item name="note" label="处理备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="推送订单到工厂"
        open={pushOpen}
        onOk={handlePushSubmit}
        confirmLoading={pushing}
        onCancel={() => setPushOpen(false)}
        width={isMobile ? '95%' : 640}
        okText="推送给工厂"
        destroyOnHidden
      >
        {pushOrder && (
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            订单 {pushOrder.order_no}　{pushOrder.product_name || ''}
          </Text>
        )}
        <Form form={pushForm} layout="vertical">
          <Form.Item
            name="factory_id"
            label="选择工厂"
            rules={[{ required: true, message: '请选择工厂' }]}
          >
            <Select
              placeholder={factories.length ? '选择推送给哪家工厂' : '暂无工厂账号，请先到账号权限新增'}
              options={factories.map((f) => ({ value: f.id, label: f.nickname || f.username }))}
            />
          </Form.Item>
          <Form.Item name="factory_spec" label="款式（货号/名称，导出txt用）">
            <Input placeholder="如：货号 黑色POLO衫拼色" />
          </Form.Item>
          <Space style={{ width: '100%' }} direction={isMobile ? 'vertical' : 'horizontal'}>
            <Form.Item name="factory_size" label="码数" style={{ flex: 1 }}>
              <Input placeholder="如：XL-1件（已按SKU带出，可改）" />
            </Form.Item>
            <Form.Item name="factory_print" label="印花" style={{ width: isMobile ? '100%' : 160 }}>
              <Input placeholder="如：栖头鸭" />
            </Form.Item>
          </Space>
          <Form.Item name="factory_quantity" label="合计数量（留空＝用订单数量）">
            <InputNumber min={0} precision={0} style={{ width: '100%' }} placeholder={`订单数量 ${pushOrder?.quantity || 1}`} />
          </Form.Item>
          <Form.Item label="效果图（高清，非必传）">
            <ImageUploader fileList={effectList} onChange={setEffectList} />
          </Form.Item>
          <Form.Item label="底图（高清，非必传）">
            <ImageUploader fileList={baseList} onChange={setBaseList} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="归类为成品"
        open={classifyOpen}
        onOk={handleClassifySubmit}
        onCancel={() => setClassifyOpen(false)}
        width={isMobile ? '95%' : 520}
        okText="归入成品"
        destroyOnHidden
      >
        {classifyOrder && (
          <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
            订单 {classifyOrder.order_no}　商品ID {classifyOrder.item_id || '无'}
          </Text>
        )}
        {suggestions.length === 0 ? (
          <Text type="secondary">成品库暂无可选成品。请先到「成品库」新建，或对该单「标为定制」。</Text>
        ) : (
          <Select
            style={{ width: '100%' }}
            placeholder="选择要归入的成品（带★为推荐）"
            value={classifyProductId}
            onChange={setClassifyProductId}
            options={suggestions.map((p) => ({
              value: p.id,
              label: `${p.score > 0 ? '★ ' : ''}${p.name}　¥${Number(p.factory_quote || 0).toFixed(2)}`,
            }))}
          />
        )}
        <Text type="secondary" style={{ display: 'block', marginTop: 12, fontSize: 12 }}>
          归类后，该商品ID（含其它店铺/链接同ID）的订单将自动套用成品报价与素材。
        </Text>
      </Modal>

      <Modal
        title="存为成品"
        open={saveProductOpen}
        onOk={handleSaveProductSubmit}
        onCancel={() => setSaveProductOpen(false)}
        width={isMobile ? '95%' : 480}
        okText="存为成品"
        destroyOnHidden
      >
        <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>
          把刚确认的报价与素材存入成品库，以后同商品（任意店铺/链接）订单自动套用、免报价免传图。
        </Text>
        <Form form={saveProductForm} layout="vertical">
          <Form.Item name="name" label="成品名称" rules={[{ required: true, message: '请填写名称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="product_code" label="货号（可选）">
            <Input placeholder="内部货号" />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title="收件人解密"
        open={reveal.open}
        onCancel={() => setReveal((s) => ({ ...s, open: false }))}
        footer={[
          <Button
            key="copy"
            disabled={reveal.loading || Boolean(reveal.error)}
            onClick={() => {
              const t = [reveal.name, reveal.phone, reveal.address].filter(Boolean).join(' ');
              if (t) { navigator.clipboard?.writeText(t); message.success('已复制'); }
            }}
          >
            复制
          </Button>,
          <Button
            key="save"
            type="primary"
            disabled={reveal.loading || Boolean(reveal.error)}
            onClick={handleSaveReceiver}
          >
            保存到订单（推送工厂用）
          </Button>,
          <Button key="close" onClick={() => setReveal((s) => ({ ...s, open: false }))}>关闭</Button>,
        ]}
        destroyOnHidden
      >
        {reveal.record && (
          <div style={{ marginBottom: 8, color: '#888', fontSize: 12 }}>
            订单：{reveal.record.order_no} ｜ 店铺：{reveal.record.shop_real_name || reveal.record.shop_name || '-'}
          </div>
        )}
        {reveal.loading ? (
          <div style={{ padding: '16px 0' }}>正在解密（采集器执行中，约需 5-15 秒）…</div>
        ) : reveal.error ? (
          <Alert type="warning" showIcon message={reveal.error} />
        ) : (
          <Space direction="vertical" size={8} style={{ width: '100%' }}>
            <Text type="secondary" style={{ fontSize: 12 }}>地址常有误差，可直接修改后再保存：</Text>
            <Input
              addonBefore="姓名"
              value={reveal.name}
              onChange={(e) => setReveal((s) => ({ ...s, name: e.target.value }))}
            />
            <Input
              addonBefore="电话"
              value={reveal.phone}
              onChange={(e) => setReveal((s) => ({ ...s, phone: e.target.value }))}
            />
            <Input.TextArea
              placeholder="收货地址"
              value={reveal.address}
              autoSize={{ minRows: 2, maxRows: 6 }}
              onChange={(e) => setReveal((s) => ({ ...s, address: e.target.value }))}
            />
          </Space>
        )}
      </Modal>
    </Space>
  );
}
