import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Card,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import {
  CheckCircleOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  QrcodeOutlined,
  ReloadOutlined,
  SyncOutlined,
  WarningOutlined,
} from '@ant-design/icons';
import { collectorApi, shopApi } from '../../api';
import { useResponsive } from '../../hooks/useResponsive';

const { Text } = Typography;

const PLATFORM_TEXT = {
  taobao: '淘宝',
  jd: '京东',
};

const STATUS_MAP = {
  online: { text: '会话有效', color: 'green' },
  synced: { text: '已同步', color: 'blue' },
  login_required: { text: '需登录', color: 'orange' },
  security_paused: { text: '需人工验证', color: 'red' },
  collect_failed: { text: '采集失败', color: 'red' },
  created: { text: '待登录', color: 'default' },
  unknown: { text: '未接入', color: 'default' },
};

function formatDateTime(value) {
  if (!value) return '-';
  const date = new Date(String(value).replace(' ', 'T'));
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '-');
}

function formatPollingError(error) {
  if (!error?.message) return '';
  const at = error.at ? `（${formatDateTime(error.at)}）` : '';
  return `${error.message}${at}`;
}

function shortCollectorId(value) {
  const text = String(value || '').trim();
  return text ? text.slice(-6) : '';
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
  '\u672a\u8bc6\u522b\u5e97\u94fa\u540d',
  'taobao',
  'jd',
  'jdm',
].map((name) => String(name).normalize('NFKC').replace(/\s+/g, '').toLowerCase()));

function meaningfulShopName(value) {
  const text = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const key = text.replace(/\s+/g, '').toLowerCase();
  return text && !PLACEHOLDER_SHOP_NAME_KEYS.has(key) ? text : '';
}

function shopDisplayName(record) {
  const name = meaningfulShopName(record?.real_name) || meaningfulShopName(record?.name);
  if (name) return name;
  const platform = PLATFORM_TEXT[record?.platform] || record?.platform || '';
  const suffix = [platform, shortCollectorId(record?.collector_shop_id)].filter(Boolean).join(' \u00b7 ');
  return suffix ? `\u672a\u8bc6\u522b\u5e97\u94fa\u540d\uff08${suffix}\uff09` : '\u672a\u8bc6\u522b\u5e97\u94fa\u540d';
}

export default function Shops() {
  const [shops, setShops] = useState([]);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState('');
  const [addOpen, setAddOpen] = useState(false);
  const [logModal, setLogModal] = useState({ open: false, title: '', lines: [] });
  const [collectorConfig, setCollectorConfig] = useState(null);
  const [collectorStatus, setCollectorStatus] = useState(null);
  const [pollingState, setPollingState] = useState(null);
  const [pollIntervalMinutes, setPollIntervalMinutes] = useState(30);
  const [openIssues, setOpenIssues] = useState({ list: [], total: 0 });
  const { isMobile } = useResponsive();

  const collectorControlEnabled = collectorConfig?.collector_control_enabled !== false;
  const nextRunByShop = new Map((pollingState?.next_runs || []).map((item) => [item.collector_shop_id, item]));
  const securityShops = shops.filter((shop) => shop.collector_status === 'security_paused');
  const securityIssues = (openIssues.list || []).filter((issue) => (
    `${issue.title || ''} ${issue.message || ''}`.match(/安全验证|滑块|验证码|x5sec|verify|captcha|security/i)
  ));
  const securityAlertCount = Math.max(securityShops.length, securityIssues.length);
  const firstSecurityShop = securityShops[0];

  const fetchShops = async (showLoading = true) => {
    if (showLoading) setLoading(true);
    try {
      const res = await shopApi.list();
      setShops(res || []);
    } finally {
      if (showLoading) setLoading(false);
    }
  };

  const refreshCollector = async (showMessage = false) => {
    if (!collectorControlEnabled) return null;
    try {
      const status = await collectorApi.status();
      setCollectorStatus(status);
      if (showMessage) message.success('本机采集器连接正常');
      return status;
    } catch {
      setCollectorStatus(null);
      return null;
    }
  };

  const fetchPolling = async () => {
    if (!collectorControlEnabled) return null;
    try {
      const res = await collectorApi.polling();
      setPollingState(res);
      setPollIntervalMinutes(res?.interval_minutes || 30);
      return res;
    } catch {
      setPollingState(null);
      return null;
    }
  };

  const fetchOpenIssues = async () => {
    try {
      const res = await collectorApi.issues({ resolved: '0', page: 1, pageSize: 50 });
      setOpenIssues({ list: res?.list || [], total: res?.total || 0 });
      return res;
    } catch {
      setOpenIssues({ list: [], total: 0 });
      return null;
    }
  };

  const syncShops = async (showMessage = false) => {
    if (!collectorControlEnabled) return null;
    const result = await collectorApi.syncShops();
    if (showMessage) {
      message.success(`店铺同步完成：新增 ${result?.sync?.inserted || 0}，更新 ${result?.sync?.updated || 0}`);
    }
    return result;
  };

  const refreshAll = async (showLoading = true) => {
    const config = await collectorApi.config().catch(() => null);
    setCollectorConfig(config);
    await fetchOpenIssues();
    if (config?.collector_control_enabled === false) {
      await fetchShops(showLoading);
      return;
    }
    await refreshCollector(false);
    await syncShops(false).catch(() => null);
    await fetchPolling();
    await fetchShops(showLoading);
  };

  useEffect(() => {
    refreshAll(true);
  }, []);

  useEffect(() => {
    if (!collectorControlEnabled) return undefined;
    const timer = window.setInterval(async () => {
      await fetchPolling();
      await fetchShops(false);
      await fetchOpenIssues();
    }, pollingState?.enabled ? 10000 : 60000);
    return () => window.clearInterval(timer);
  }, [collectorControlEnabled, pollingState?.enabled]);

  const runAction = async (key, fn, successText) => {
    setActionLoading(key);
    try {
      const result = await fn();
      if (successText) message.success(successText);
      await fetchShops(false);
      await fetchOpenIssues();
      await fetchPolling();
      return result;
    } finally {
      setActionLoading('');
    }
  };

  const collectorShopMeta = (record) => ({
    platform: record.platform,
    name: record.name,
    real_name: record.real_name,
    shop_name: meaningfulShopName(record.real_name) || meaningfulShopName(record.name),
  });

  const createCollectorShop = async (platform) => {
    await runAction(`create-${platform}`, async () => {
      const result = await collectorApi.createShop(platform);
      await syncShops(false).catch(() => null);
      return result;
    }, `${PLATFORM_TEXT[platform]} 登录窗口已打开，请扫码登录`);
    setAddOpen(false);
  };

  const handleLoginCheck = async (record) => {
    const result = await runAction(`check-${record.id}`, () => collectorApi.loginCheck(record.collector_shop_id, collectorShopMeta(record)));
    await syncShops(false).catch(() => null);
    await fetchShops(false);
    if (result?.session_valid) {
      message.success(result?.shop_name ? `登录有效：${result.shop_name}` : '登录有效');
    } else {
      message.warning('暂未确认登录成功，请在店铺窗口完成扫码');
    }
  };

  const handleCollectOrders = async (record, full = false) => {
    const result = await runAction(
      `collect-${record.id}-${full ? 'full' : 'normal'}`,
      () => collectorApi.collectOrders(record.collector_shop_id, full, collectorShopMeta(record)),
      '订单采集同步完成',
    );
    const modeText = result?.mode === 'initial_full'
      ? '首次全量'
      : (result?.collect_all_pages || full ? '全量' : '增量');
    message.info(`${modeText}采集 ${result?.order_count || 0} 条，新增 ${result?.sync?.inserted || 0} 条，更新 ${result?.sync?.updated || 0} 条`);
  };

  const handleDelete = async (record) => {
    if (record.collector_shop_id && collectorControlEnabled) {
      await collectorApi.deleteShop(record.collector_shop_id).catch(() => null);
    }
    await shopApi.delete(record.id, true);
    message.success('店铺已删除');
    await fetchShops(false);
  };

  const handleLogs = async (record) => {
    const result = await runAction(`logs-${record.id}`, () => collectorApi.logs(record.collector_shop_id, 100));
    setLogModal({
      open: true,
      title: `${shopDisplayName(record)} 采集日志`,
      lines: Array.isArray(result) ? result : result?.logs || result?.lines || [],
    });
  };

  const handleTogglePolling = async () => {
    const enabled = !pollingState?.enabled;
    const result = await runAction(
      'toggle-polling',
      () => collectorApi.savePolling({ enabled, interval_minutes: pollIntervalMinutes }),
      enabled ? '轮询已开启' : '轮询已停止',
    );
    setPollingState(result);
  };

  const handleSavePollingInterval = async (value) => {
    setPollIntervalMinutes(value);
    if (!pollingState?.enabled) return;
    const result = await collectorApi.savePolling({ enabled: true, interval_minutes: value });
    setPollingState(result);
    message.success('轮询间隔已更新');
  };

  const handlePollingSelfTest = async () => {
    const result = await runAction(
      'polling-test',
      () => collectorApi.runPollingOnce({ force: true }),
    );
    if (result?.skipped) {
      message.info(result.message || '轮询检查完成，当前没有到期店铺');
      return;
    }
    message.success(`轮询自检完成：${result?.name || result?.collector_shop_id || '店铺'}，采集 ${result?.order_count || 0} 条`);
  };

  const handleSchedulePollingTest = async () => {
    const result = await runAction(
      'polling-schedule-test',
      () => collectorApi.schedulePollingTest({ delay_seconds: 60 }),
    );
    const nextAt = result?.next_run_at ? formatDateTime(result.next_run_at) : '1 分钟后';
    message.success(`已安排 ${result?.name || '一个店铺'} 在 ${nextAt} 自动轮询，请不要手动采集，等待“最近轮询”变化`);
  };

  const statusTag = (value) => {
    const item = STATUS_MAP[value || 'unknown'] || STATUS_MAP.unknown;
    return <Tag color={item.color}>{item.text}</Tag>;
  };

  const columns = [
    {
      title: '店铺',
      key: 'shop',
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{shopDisplayName(record)}</Text>
          {record.collector_status === 'security_paused' && (
            <Text type="danger" style={{ fontSize: 12 }}>平台安全验证已触发，轮询暂停</Text>
          )}
          <Text type="secondary" style={{ fontSize: 12 }}>{record.collector_shop_id || '服务器手工店铺'}</Text>
        </Space>
      ),
    },
    {
      title: '平台',
      dataIndex: 'platform',
      key: 'platform',
      width: 90,
      render: (value) => (value ? <Tag>{PLATFORM_TEXT[value] || value}</Tag> : <Tag>手工</Tag>),
    },
    {
      title: '采集状态',
      dataIndex: 'collector_status',
      key: 'collector_status',
      width: 110,
      render: statusTag,
    },
    { title: '最近登录检查', dataIndex: 'last_login_check_at', key: 'last_login_check_at', width: 170, render: formatDateTime },
    { title: '最近采集', dataIndex: 'last_collect_at', key: 'last_collect_at', width: 170, render: formatDateTime },
    {
      title: '下次轮询',
      key: 'next_poll',
      width: 170,
      render: (_, record) => {
        if (!pollingState?.enabled) return '-';
        if (record.collector_status === 'security_paused') return <Tag color="red">已暂停</Tag>;
        const nextRun = nextRunByShop.get(record.collector_shop_id)?.next_run_at;
        return nextRun ? formatDateTime(nextRun) : '-';
      },
    },
    {
      title: '操作',
      key: 'action',
      width: collectorControlEnabled ? 450 : 120,
      render: (_, record) => {
        const disabled = !collectorControlEnabled || !record.collector_shop_id;
        const securityPaused = record.collector_status === 'security_paused';
        return (
          <Space wrap size={4}>
            {collectorControlEnabled && (
              <>
                {securityPaused && (
                  <Button size="small" danger icon={<WarningOutlined />} disabled={disabled} loading={actionLoading === `open-${record.id}`} onClick={() => runAction(`open-${record.id}`, () => collectorApi.openShop(record.collector_shop_id, collectorShopMeta(record)), '店铺页面已唤起，请先完成安全验证')}>
                    处理验证
                  </Button>
                )}
                <Button size="small" icon={<FolderOpenOutlined />} disabled={disabled} loading={actionLoading === `open-${record.id}`} onClick={() => runAction(`open-${record.id}`, () => collectorApi.openShop(record.collector_shop_id, collectorShopMeta(record)), '店铺页面已唤起')}>
                  唤起店铺页面
                </Button>
                <Button size="small" icon={<CheckCircleOutlined />} disabled={disabled} loading={actionLoading === `check-${record.id}`} onClick={() => handleLoginCheck(record)}>
                  确认登录
                </Button>
                <Button size="small" type="primary" icon={<SyncOutlined />} disabled={disabled} loading={actionLoading === `collect-${record.id}-normal`} onClick={() => handleCollectOrders(record)}>
                  采集订单
                </Button>
                <Button size="small" icon={<SyncOutlined />} disabled={disabled} loading={actionLoading === `collect-${record.id}-full`} onClick={() => handleCollectOrders(record, true)}>
                  全量
                </Button>
                <Button size="small" icon={<FileTextOutlined />} disabled={disabled} loading={actionLoading === `logs-${record.id}`} onClick={() => handleLogs(record)}>
                  日志
                </Button>
              </>
            )}
            <Popconfirm title="确定删除该店铺及该店铺订单？" onConfirm={() => handleDelete(record)}>
              <Button type="link" size="small" danger>删除</Button>
            </Popconfirm>
          </Space>
        );
      },
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>店铺同步</h3>
          <Text type="secondary">本地 EXE 维护店铺会话，服务器保存店铺和订单数据</Text>
        </div>
        <Space wrap>
          <Button icon={<ReloadOutlined />} onClick={() => refreshAll(false)} loading={loading}>刷新</Button>
          {collectorControlEnabled && (
            <Button type="primary" icon={<PlusOutlined />} onClick={() => setAddOpen(true)}>
              新增店铺登录
            </Button>
          )}
        </Space>
      </div>

      <Card size="small">
        <Space direction="vertical" size={12} style={{ width: '100%' }}>
          <Space style={{ width: '100%', justifyContent: 'space-between' }} wrap>
            <Space direction="vertical" size={0}>
              <Text strong>{collectorControlEnabled ? '本机采集器' : '本机采集器与轮询'}</Text>
              <Text type="secondary">
                {collectorControlEnabled
                  ? (collectorConfig?.collector_base_url || 'http://127.0.0.1:5069')
                  : '服务器网页只展示数据；在本地 EXE 内打开后，这些按钮会自动连接本机采集器并启用'}
              </Text>
            </Space>
            <Space wrap>
              <Button disabled={!collectorControlEnabled} onClick={() => refreshCollector(true)}>测试连接</Button>
              <Button disabled={!collectorControlEnabled} icon={<SyncOutlined />} onClick={() => syncShops(true)}>同步店铺</Button>
              <Select
                value={pollIntervalMinutes}
                disabled={!collectorControlEnabled || !pollingState?.enabled}
                style={{ width: 116 }}
                options={[
                  { value: 30, label: '30 分钟' },
                  { value: 60, label: '60 分钟' },
                ]}
                onChange={handleSavePollingInterval}
              />
              <Button
                disabled={!collectorControlEnabled}
                type={pollingState?.enabled ? 'default' : 'primary'}
                icon={<SyncOutlined />}
                loading={actionLoading === 'toggle-polling'}
                onClick={handleTogglePolling}
              >
                {pollingState?.enabled ? '停止轮询' : '开启轮询'}
              </Button>
              <Button
                icon={<PlayCircleOutlined />}
                disabled={!collectorControlEnabled || !pollingState?.enabled}
                loading={actionLoading === 'polling-test'}
                onClick={handlePollingSelfTest}
              >
                轮询自检
              </Button>
              <Button
                icon={<PlayCircleOutlined />}
                disabled={!collectorControlEnabled || !pollingState?.enabled}
                loading={actionLoading === 'polling-schedule-test'}
                onClick={handleSchedulePollingTest}
              >
                1分钟实测
              </Button>
            </Space>
          </Space>
          {collectorControlEnabled ? (
            collectorStatus?.ok ? (
            <Alert
              type="success"
              showIcon
              message={`采集器正常：店铺 ${collectorStatus.shops || 0} 个，会话 ${collectorStatus.active_sessions || 0} 个`}
              description={(
                <Space direction="vertical" size={2}>
                  <span>
                    轮询：{pollingState?.enabled ? `已开启，约每 ${pollingState.interval_minutes} 分钟错峰同步一次，实际会加入随机延迟避免同时请求` : '未开启'}。
                    需处理店铺 {pollingState?.paused_shop_count || securityShops.length || 0} 个，平台登录和采集请求都从这台电脑发出。
                  </span>
                  {pollingState?.last_run && (
                    <span>
                      最近轮询：{pollingState.last_run.name || pollingState.last_run.collector_shop_id}
                      ，{formatDateTime(pollingState.last_run.at)}
                      ，采集 {pollingState.last_run.order_count || 0} 条。
                    </span>
                  )}
                  {pollingState?.last_check && (
                    <span>
                      最近检查：{formatDateTime(pollingState.last_check.at)}
                      ，{pollingState.last_check.due ? '已执行采集' : (pollingState.last_check.message || '暂无到期店铺')}。
                    </span>
                  )}
                  {pollingState?.last_error && (
                    <Text type="danger">轮询错误：{formatPollingError(pollingState.last_error)}</Text>
                  )}
                </Space>
              )}
            />
            ) : (
              <Alert type="warning" showIcon message="本机采集器未连接" description="请确认本地 EXE 已启动，采集器地址通常是 http://127.0.0.1:5069。" />
            )
          ) : (
            <Alert
              type="info"
              showIcon
              message="中央服务器数据模式"
              description="这里展示店铺、订单和采集状态，但不会直接打开淘宝/京东。请在本地 EXE 内使用新增店铺、采集订单和轮询功能，平台看到的登录与采集 IP 仍然是本地电脑或云电脑 IP。"
            />
          )}
        </Space>
      </Card>

      {securityAlertCount > 0 && (
        <Alert
          type="error"
          showIcon
          icon={<WarningOutlined />}
          message={`有 ${securityAlertCount} 个店铺需要人工处理`}
          description="平台出现安全验证、滑块或验证码后，该店铺轮询会自动暂停，避免继续请求导致风控加重。请唤起店铺页面处理验证，然后点击“确认登录”恢复。"
          action={(
            <Space wrap>
              {collectorControlEnabled && firstSecurityShop?.collector_shop_id && (
                <Button
                  danger
                  size="small"
                  onClick={() => runAction(`open-${firstSecurityShop.id}`, () => collectorApi.openShop(firstSecurityShop.collector_shop_id, collectorShopMeta(firstSecurityShop)), '店铺页面已唤起，请先完成安全验证')}
                >
                  处理第一个
                </Button>
              )}
              <Button size="small" onClick={() => { window.location.href = '/collector-issues'; }}>
                查看诊断
              </Button>
            </Space>
          )}
        />
      )}

      <Table
        columns={columns}
        dataSource={shops}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={isMobile ? { x: 900 } : undefined}
        pagination={{ pageSize: 20 }}
      />

      <Modal
        title="新增店铺登录"
        open={addOpen}
        footer={null}
        onCancel={() => setAddOpen(false)}
        width={isMobile ? '95%' : 460}
        destroyOnHidden
      >
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Alert type="info" showIcon message="选择平台后会打开扫码登录窗口" description="扫码完成后会自动检测会话并同步真实店铺名称。" />
          <Button block size="large" type="primary" icon={<QrcodeOutlined />} loading={actionLoading === 'create-taobao'} onClick={() => createCollectorShop('taobao')}>
            淘宝扫码登录
          </Button>
          <Button block size="large" icon={<QrcodeOutlined />} loading={actionLoading === 'create-jd'} onClick={() => createCollectorShop('jd')}>
            京东扫码登录
          </Button>
        </Space>
      </Modal>

      <Modal
        title={logModal.title}
        open={logModal.open}
        onCancel={() => setLogModal({ open: false, title: '', lines: [] })}
        footer={null}
        width={isMobile ? '95%' : 760}
      >
        <pre style={{ maxHeight: 480, overflow: 'auto', whiteSpace: 'pre-wrap', background: '#111827', color: '#e5e7eb', padding: 12, borderRadius: 6 }}>
          {logModal.lines.map((line) => (typeof line === 'string' ? line : JSON.stringify(line))).join('\n') || '暂无日志'}
        </pre>
      </Modal>
    </Space>
  );
}
