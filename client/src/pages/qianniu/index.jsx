import { useEffect, useState } from 'react';
import { Card, Table, Tabs, Tag, Statistic, Row, Col, Space, Typography, Image, message, Button } from 'antd';
import { ReloadOutlined, RiseOutlined, FallOutlined } from '@ant-design/icons';
import { qianniuApi } from '../../api';

const { Text } = Typography;

function ChangeTag({ value }) {
  const text = String(value || '').trim();
  if (!text || text === '0%') return <Text type="secondary">—</Text>;
  const down = text.startsWith('-');
  return (
    <Tag color={down ? 'red' : 'green'} icon={down ? <FallOutlined /> : <RiseOutlined />}>
      {text}
    </Tag>
  );
}

function MetricCell({ today, yesterday, change }) {
  return (
    <Space direction="vertical" size={0}>
      <Text strong>{today ?? '—'}</Text>
      <Space size={4}>
        <Text type="secondary" style={{ fontSize: 12 }}>昨 {yesterday ?? '—'}</Text>
        <ChangeTag value={change} />
      </Space>
    </Space>
  );
}

function platformTag(p) {
  if (p === 'taobao') return <Tag color="orange">淘宝</Tag>;
  if (p === 'jd') return <Tag color="red">京东</Tag>;
  return <Tag>{p || '—'}</Tag>;
}

function OverviewTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try {
      const res = await qianniuApi.overview();
      setRows(res?.shops || []);
    } catch { message.error('加载经营指标失败'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const columns = [
    { title: '店铺', dataIndex: 'shop_name', render: (v, r) => <Space>{platformTag(r.platform)}<Text strong>{v}</Text></Space> },
    { title: '支付金额', render: (_, r) => <MetricCell today={r.pay_amt_today} yesterday={r.pay_amt_yesterday} change={r.pay_amt_change} /> },
    { title: '访客数', render: (_, r) => <MetricCell today={r.uv_today} yesterday={r.uv_yesterday} change={r.uv_change} /> },
    { title: '浏览量', render: (_, r) => <MetricCell today={r.pv_today} yesterday={r.pv_yesterday} change={r.pv_change} /> },
    { title: '支付件数', render: (_, r) => <MetricCell today={r.pay_cnt_today} yesterday={r.pay_cnt_yesterday} change={r.pay_cnt_change} /> },
    { title: '采集时间', dataIndex: 'collected_at', render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '—'}</Text> },
  ];
  return (
    <>
      <Space style={{ marginBottom: 12 }}>
        <Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button>
        <Text type="secondary">数据由桌面连接器从千牛采集后推送，此处展示最新一次。</Text>
      </Space>
      <Table rowKey="shop_id" columns={columns} dataSource={rows} loading={loading} pagination={false} size="small" />
    </>
  );
}

function CreditTab() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const load = async () => {
    setLoading(true);
    try { const res = await qianniuApi.credit(); setRows(res?.shops || []); }
    catch { message.error('加载店铺信用失败'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const columns = [
    { title: '店铺', dataIndex: 'shop_name', render: (v, r) => <Space>{platformTag(r.platform)}<Text strong>{v}</Text></Space> },
    { title: '信用等级', dataIndex: 'credit_level_text', render: (v, r) => <Tag color="gold">{v || '—'}{r.credit_level ? ` (${r.credit_level})` : ''}</Tag> },
    { title: '卖家昵称', dataIndex: 'seller_nick', render: (v) => v || '—' },
    { title: '店铺ID', dataIndex: 'shop_taobao_id', render: (v) => <Text type="secondary">{v || '—'}</Text> },
    { title: '更新时间', dataIndex: 'updated_at', render: (v) => <Text type="secondary" style={{ fontSize: 12 }}>{v || '—'}</Text> },
  ];
  return (
    <>
      <Space style={{ marginBottom: 12 }}><Button icon={<ReloadOutlined />} onClick={load} loading={loading}>刷新</Button></Space>
      <Table rowKey="shop_id" columns={columns} dataSource={rows} loading={loading} pagination={false} size="small" />
    </>
  );
}

function DiagnosisTab() {
  const [summaries, setSummaries] = useState([]);
  const [items, setItems] = useState([]);
  const [activeShop, setActiveShop] = useState(null);
  const [loading, setLoading] = useState(false);
  const load = async (shopId) => {
    setLoading(true);
    try {
      const res = await qianniuApi.diagnosis(shopId ? { shop_id: shopId } : undefined);
      setSummaries(res?.summaries || []);
      setItems(res?.items || []);
    } catch { message.error('加载商品诊断失败'); } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  const sumCols = [
    { title: '店铺', dataIndex: 'shop_name', render: (v, r) => <Space>{platformTag(r.platform)}<Text strong>{v}</Text></Space> },
    { title: '流量加速商品', dataIndex: 'flow_accelerated_count', render: (v) => <Tag color="green">{v}</Tag> },
    { title: '流量受限商品', dataIndex: 'flow_limited_count', render: (v) => <Tag color="red">{v}</Tag> },
    { title: '已诊断', dataIndex: 'diagnosed_items' },
    { title: '操作', render: (_, r) => <Button size="small" onClick={() => { setActiveShop(r.shop_id); load(r.shop_id); }}>查看问题商品</Button> },
  ];
  const itemCols = [
    { title: '主图', dataIndex: 'main_pic', width: 64, render: (v) => v ? <Image width={48} src={v.startsWith('//') ? `https:${v}` : v} /> : '—' },
    { title: '商品ID', dataIndex: 'item_id' },
    { title: '基础分', dataIndex: 'basic_score', render: (v) => <Tag color={v >= 80 ? 'green' : v >= 60 ? 'orange' : 'red'}>{v}</Tag> },
    { title: '问题', dataIndex: 'issues', render: (v) => (v || []).map((x) => <Tag key={x} color="red">{x}</Tag>) },
    { title: '指标', dataIndex: 'metrics', render: (v) => (v || []).map((m) => <Tag key={m.name}>{m.name}: {m.value}</Tag>) },
  ];
  return (
    <>
      <Space style={{ marginBottom: 12 }}><Button icon={<ReloadOutlined />} onClick={() => { setActiveShop(null); load(); }} loading={loading}>刷新</Button></Space>
      <Table rowKey="shop_id" columns={sumCols} dataSource={summaries} loading={loading} pagination={false} size="small" style={{ marginBottom: 16 }} />
      {activeShop && (
        <Card size="small" title={`问题商品（店铺 #${activeShop}）`}>
          <Table rowKey="item_id" columns={itemCols} dataSource={items} pagination={false} size="small" />
        </Card>
      )}
    </>
  );
}

export default function QianniuData() {
  return (
    <Card title="千牛采集数据" bordered={false}>
      <Tabs
        defaultActiveKey="overview"
        items={[
          { key: 'overview', label: '经营指标', children: <OverviewTab /> },
          { key: 'credit', label: '店铺信用', children: <CreditTab /> },
          { key: 'diagnosis', label: '商品诊断', children: <DiagnosisTab /> },
        ]}
      />
    </Card>
  );
}
