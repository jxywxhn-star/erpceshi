import { useEffect, useState } from 'react';
import { Button, Card, Space, Table, Tag, Typography, message } from 'antd';
import { ReloadOutlined, RiseOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { collectorApi, collectorSmart, shopApi } from '../../api';

const { Text } = Typography;

// 从采集器概览导出里取某指标（兼容嵌套 metrics.metrics、以及淘宝/京东不同字段名）。
function pickMetric(exportData, keys) {
  const m = exportData?.metrics?.metrics || exportData?.metrics || {};
  for (const k of keys) {
    if (m && m[k] && (m[k].today != null)) return m[k];
  }
  return null;
}

function MetricCell({ metric, money }) {
  if (!metric) return <Text type="secondary">-</Text>;
  const sub = metric.yesterday != null ? `昨日 ${metric.yesterday}` : (metric.change != null ? `较昨 ${metric.change}` : '');
  return (
    <div>
      <div style={{ fontSize: 18, fontWeight: 700, lineHeight: 1.2 }}>{money ? `¥${metric.today}` : metric.today}</div>
      {sub && <div style={{ fontSize: 11, color: '#9ca3af' }}>{sub}</div>}
    </div>
  );
}

export default function ShopOverview() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState({});

  const loadCached = async () => {
    setLoading(true);
    try {
      // 用服务器店铺表取列表(任意浏览器可用)，缓存概览优先直连采集器(本机CEF)，失败则留空待刷新。
      const shops = await shopApi.list();
      const list = (Array.isArray(shops) ? shops : (shops?.shops || shops?.data || []))
        .filter((s) => s.collector_shop_id);
      const withData = await Promise.all(list.map(async (s) => {
        const id = s.collector_shop_id;
        let data = null;
        try { data = await collectorApi.overviewLatest(id); } catch { data = null; }
        return { id, platform: s.platform, name: s.real_name || s.name || data?.shop_name || id, data };
      }));
      setRows(withData);
    } catch {
      message.warning('读取店铺列表失败');
    } finally {
      setLoading(false);
    }
  };

  const refreshOne = async (row) => {
    setRefreshing((r) => ({ ...r, [row.id]: true }));
    try {
      const data = await collectorSmart.overview(row.id);
      setRows((rs) => rs.map((x) => (x.id === row.id ? { ...x, data } : x)));
      message.success(`${row.name} 概览已更新`);
    } catch {
      message.error(`${row.name} 概览采集失败（需采集器登录且未被风控）`);
    } finally {
      setRefreshing((r) => ({ ...r, [row.id]: false }));
    }
  };

  const refreshAll = async () => {
    for (const row of rows) {
      // 串行，避免并发实采互相抢会话/触发风控。
      // eslint-disable-next-line no-await-in-loop
      await refreshOne(row);
    }
  };

  useEffect(() => { loadCached(); }, []);

  const columns = [
    {
      title: '店铺', key: 'shop', width: 200,
      render: (_, r) => {
        const isJd = String(r.platform).includes('jd');
        return (
          <Space>
            <Tag color={isJd ? '#d4380d' : '#d46b08'}>{isJd ? '京东' : '淘宝'}</Tag>
            <span style={{ fontWeight: 600 }}>{r.name}</span>
          </Space>
        );
      },
    },
    { title: '访客数', key: 'uv', render: (_, r) => <MetricCell metric={pickMetric(r.data, ['访客数'])} /> },
    { title: '支付/成交金额', key: 'amt', render: (_, r) => <MetricCell metric={pickMetric(r.data, ['支付金额', '成交金额'])} money /> },
    { title: '浏览量', key: 'pv', render: (_, r) => <MetricCell metric={pickMetric(r.data, ['浏览量', '店铺浏览量'])} /> },
    { title: '支付/成交单量', key: 'cnt', render: (_, r) => <MetricCell metric={pickMetric(r.data, ['支付子订单数', '成交单量'])} /> },
    {
      title: '更新时间', key: 'time', width: 130,
      render: (_, r) => <Text type="secondary" style={{ fontSize: 12 }}>{r.data?.captured_at ? dayjs(r.data.captured_at).format('MM-DD HH:mm') : '未采集'}</Text>,
    },
    {
      title: '操作', key: 'op', width: 90,
      render: (_, r) => <Button size="small" type="link" icon={<ReloadOutlined />} loading={refreshing[r.id]} onClick={() => refreshOne(r)}>刷新</Button>,
    },
  ];

  return (
    <Card
      title="店铺实时概览（访客 / 支付金额 / 浏览量）"
      extra={(
        <Space>
          <Button size="small" icon={<RiseOutlined />} onClick={refreshAll}>全部刷新</Button>
          <Button size="small" onClick={loadCached} loading={loading}>重新读取</Button>
        </Space>
      )}
    >
      <Table
        rowKey="id"
        size="middle"
        loading={loading}
        columns={columns}
        dataSource={rows}
        pagination={false}
        locale={{ emptyText: '暂无店铺（请确认采集器已连接并添加店铺）' }}
      />
      <Text type="secondary" style={{ fontSize: 12, display: 'block', marginTop: 10 }}>
        数据来自店铺后台（淘宝千牛 / 京东商智）实时指标。「刷新」会触发一次实采（约 10-15 秒），平时显示最近一次缓存。
        「全部刷新」按店铺串行采集，避免并发触发风控。
      </Text>
    </Card>
  );
}
