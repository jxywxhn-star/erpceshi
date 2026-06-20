import { useEffect, useState } from 'react';
import { Card, Table, Tag, Progress, Space, Typography, Button, Alert, message, Tooltip } from 'antd';
import { ReloadOutlined, CloudOutlined, WarningOutlined, CheckCircleOutlined } from '@ant-design/icons';
import { shopApi, qianniuApi } from '../../api';

const { Text } = Typography;

function platformTag(p) {
  if (p === 'taobao') return <Tag color="orange">淘宝</Tag>;
  if (p === 'jd') return <Tag color="red">京东</Tag>;
  return <Tag>{p || '其它'}</Tag>;
}

function phaseLabel(phase) {
  if (phase === 'full') return <Tag color="processing">全量分片中</Tag>;
  if (phase === 'incremental') return <Tag color="success">增量稳态</Tag>;
  return <Text type="secondary">—</Text>;
}

export default function Shops() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const [shops, statusRes] = await Promise.all([
        shopApi.list(),
        qianniuApi.shopStatus().catch(() => ({ shops: [] })),
      ]);
      const statusById = new Map((statusRes?.shops || []).map((s) => [s.shop_id, s]));
      const merged = (shops || []).map((shop) => ({ ...shop, qn: statusById.get(shop.id) || null }));
      merged.sort((a, b) => (b.qn ? 1 : 0) - (a.qn ? 1 : 0)); // 已接入千牛的排前
      setRows(merged);
    } catch {
      message.error('加载店铺状态失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    const timer = setInterval(load, 30000);  // 每30秒自动刷新, 实时监控
    return () => clearInterval(timer);
  }, []);

  const columns = [
    {
      title: '店铺',
      dataIndex: 'name',
      render: (v, r) => <Space>{platformTag(r.platform)}<Text strong>{r.real_name || r.name}</Text></Space>,
    },
    {
      title: '登录状态',
      key: 'login',
      width: 120,
      render: (_, r) => {
        if (!r.qn) return <Tag>未接入千牛</Tag>;
        return r.qn.login_ok ? <Tag color="green">已登录</Tag> : <Tag color="red">登录失效</Tag>;
      },
    },
    {
      title: '采集阶段',
      key: 'phase',
      width: 120,
      render: (_, r) => (r.qn ? phaseLabel(r.qn.phase) : <Text type="secondary">—</Text>),
    },
    {
      title: '采集进度',
      key: 'progress',
      width: 200,
      render: (_, r) => {
        if (!r.qn) return <Text type="secondary">—</Text>;
        const known = r.qn.total_known || 0;
        const total = r.qn.total_in_db || 0;
        const pct = total > 0 ? Math.min(100, Math.round((known / total) * 100)) : 0;
        return (
          <Space direction="vertical" size={0} style={{ width: 180 }}>
            <Text style={{ fontSize: 12 }}>已采 {known} / 共 {total} 单</Text>
            <Progress percent={pct} size="small" status={pct >= 100 ? 'success' : 'active'} />
          </Space>
        );
      },
    },
    {
      title: '最后采集',
      key: 'last_collect',
      width: 170,
      render: (_, r) => <Text type="secondary" style={{ fontSize: 12 }}>{r.qn?.last_collect || r.last_collect_at || '—'}</Text>,
    },
    {
      title: '下次采集',
      key: 'next_due',
      width: 100,
      render: (_, r) => <Text type="secondary" style={{ fontSize: 12 }}>{r.qn?.next_due || '—'}</Text>,
    },
    {
      title: '运行状态',
      key: 'health',
      width: 130,
      render: (_, r) => {
        if (!r.qn) return <Text type="secondary">—</Text>;
        const bad = r.qn.healthy === 0 || r.qn.login_ok === 0 || r.qn.login_ok === false;
        if (!bad) return <Tag color="green" icon={<CheckCircleOutlined />}>正常</Tag>;
        const msg = r.qn.last_error || (r.qn.login_ok ? '采集异常' : '登录失效');
        const risk = /失效|登录|login|验证|滑块|风控/i.test(msg);
        return (
          <Tooltip title={msg}>
            <Tag color="red" icon={<WarningOutlined />}>{risk ? '疑似风控/掉线' : '采集异常'}</Tag>
          </Tooltip>
        );
      },
    },
  ];

  const unhealthy = rows.filter((r) => r.qn && (r.qn.healthy === 0 || r.qn.login_ok === 0 || r.qn.login_ok === false));
  const linked = rows.filter((r) => r.qn);  // 已接入千牛的店
  const collectedSum = linked.reduce((a, r) => a + (r.qn.total_known || 0), 0);
  const totalSum = linked.reduce((a, r) => a + (r.qn.total_in_db || 0), 0);
  const lastUpd = linked.reduce((m, r) => (r.qn.updated_at && r.qn.updated_at > m ? r.qn.updated_at : m), '');

  const statCard = (label, value, color) => (
    <div style={{ background: '#fff', borderRadius: 10, padding: '12px 18px', boxShadow: '0 1px 3px rgba(0,0,0,.08)', minWidth: 120 }}>
      <div style={{ fontSize: 24, fontWeight: 700, color: color || '#1f2937' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#6b7280', marginTop: 2 }}>{label}</div>
    </div>
  );

  return (
    <Card
      title={<Space><CloudOutlined />店铺同步（千牛采集）</Space>}
      bordered={false}
      extra={<Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>}
    >
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginBottom: 14 }}>
        {statCard('已接入店铺', linked.length)}
        {statCard('正常', linked.length - unhealthy.length, '#16a34a')}
        {statCard('异常/风控', unhealthy.length, unhealthy.length ? '#dc2626' : '#16a34a')}
        {statCard('已采订单(合计)', `${collectedSum}/${totalSum}`)}
        {statCard('最后采集更新', lastUpd ? lastUpd.slice(5, 16) : '-')}
      </div>
      {unhealthy.length > 0 && (
        <Alert
          type="error"
          showIcon
          icon={<WarningOutlined />}
          style={{ marginBottom: 12 }}
          message={`有 ${unhealthy.length} 个店铺疑似风控/掉线，请去千牛客户端处理`}
          description={
            <Space direction="vertical" size={2}>
              {unhealthy.slice(0, 10).map((r) => (
                <Text key={r.id}>
                  <Text strong>{r.real_name || r.name}</Text>
                  {'：'}{r.qn.last_error || (r.qn.login_ok ? '采集异常' : '登录失效')}
                </Text>
              ))}
              {unhealthy.length > 10 && <Text type="secondary">…还有 {unhealthy.length - 10} 个</Text>}
            </Space>
          }
        />
      )}
      <Alert
        type="info"
        showIcon
        style={{ marginBottom: 16 }}
        message="千牛自驱动采集，无需手动操作"
        description="在千牛客户端登录的店铺会被自动发现并持续采集（新店首次全量、之后增量）。本页只读展示各店真实采集状态与进度；订单与地址由后台连接器自动同步到 ERP。出现风控/掉线会在上方红色提示并在该店标红。"
      />
      <Table
        rowKey="id"
        columns={columns}
        dataSource={rows}
        loading={loading}
        pagination={false}
        size="small"
        rowClassName={(r) => (r.qn && (r.qn.healthy === 0 || r.qn.login_ok === 0 || r.qn.login_ok === false) ? 'oms-row-danger' : '')}
      />
    </Card>
  );
}
