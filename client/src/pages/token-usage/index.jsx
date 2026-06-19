import { useEffect, useState, useCallback } from 'react';
import { Card, DatePicker, Statistic, Row, Col, Table, Tag, Space } from 'antd';
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { settingsApi } from '../../api';
import { useResponsive } from '../../hooks/useResponsive';
import dayjs from 'dayjs';

const { RangePicker } = DatePicker;

export default function TokenUsage() {
  const [dateRange, setDateRange] = useState(null);
  const [summary, setSummary] = useState({ call_count: 0, total_prompt_tokens: 0, total_completion_tokens: 0, total_tokens: 0, estimated_cost: 0 });
  const [dailyStats, setDailyStats] = useState([]);
  const [recentCalls, setRecentCalls] = useState([]);
  const [loading, setLoading] = useState(false);
  const { isMobile } = useResponsive();

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (dateRange) {
        params.start_date = dateRange[0].format('YYYY-MM-DD');
        params.end_date = dateRange[1].format('YYYY-MM-DD');
      } else {
        params.start_date = dayjs().subtract(30, 'day').format('YYYY-MM-DD');
        params.end_date = dayjs().format('YYYY-MM-DD');
      }
      const data = await settingsApi.tokenUsage(params);
      setSummary(data.summary || {});
      setDailyStats(data.dailyStats || []);
      setRecentCalls(data.recentCalls || []);
    } catch {}
    setLoading(false);
  }, [dateRange]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  const realCost = dailyStats.reduce((sum, d) => sum + d.total_tokens, 0) > 0
    ? summary.estimated_cost
    : 0;

  const columns = [
    {
      title: '时间',
      dataIndex: 'created_at',
      key: 'created_at',
      width: 170,
      render: (v) => dayjs(v).format('MM-DD HH:mm:ss'),
    },
    { title: '模型', dataIndex: 'model', key: 'model', render: (v) => <Tag color="blue">{v}</Tag> },
    {
      title: '输入Token',
      dataIndex: 'prompt_tokens',
      key: 'prompt_tokens',
      align: 'right',
      render: (v) => v?.toLocaleString(),
    },
    {
      title: '输出Token',
      dataIndex: 'completion_tokens',
      key: 'completion_tokens',
      align: 'right',
      render: (v) => v?.toLocaleString(),
    },
    {
      title: '总计',
      dataIndex: 'total_tokens',
      key: 'total_tokens',
      align: 'right',
      render: (v) => <span style={{ fontWeight: 'bold' }}>{v?.toLocaleString()}</span>,
    },
    { title: '操作人', dataIndex: 'nickname', key: 'nickname', width: 80 },
  ];

  return (
    <div>
      <Card title="Token 用量统计" style={{ marginBottom: 16 }}>
        <Space style={{ marginBottom: 16 }}>
          <RangePicker
            value={dateRange}
            onChange={setDateRange}
            placeholder={['开始日期', '结束日期']}
            allowClear
          />
        </Space>

        <Row gutter={[16, 16]}>
          <Col xs={12} sm={6}>
            <Statistic title="调用次数" value={summary.call_count || 0} suffix="次" />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic title="总Token" value={(summary.total_tokens || 0).toLocaleString()} />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic
              title="输入Token"
              value={(summary.total_prompt_tokens || 0).toLocaleString()}
              valueStyle={{ color: '#1677ff' }}
            />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic
              title="输出Token"
              value={(summary.total_completion_tokens || 0).toLocaleString()}
              valueStyle={{ color: '#52c41a' }}
            />
          </Col>
        </Row>

        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={12} sm={6}>
            <Statistic
              title="预估费用"
              value={realCost > 0 ? realCost.toFixed(4) : '0.0000'}
              prefix="¥"
              valueStyle={{ color: '#faad14' }}
            />
          </Col>
          <Col xs={12} sm={6}>
            <Statistic
              title="平均每次Token"
              value={summary.call_count > 0 ? Math.round((summary.total_tokens || 0) / summary.call_count).toLocaleString() : 0}
            />
          </Col>
        </Row>
      </Card>

      {dailyStats.length > 0 && (
        <Card title="每日Token用量趋势" style={{ marginBottom: 16 }}>
          <ResponsiveContainer width="100%" height={isMobile ? 250 : 320}>
            <BarChart data={dailyStats.slice().reverse()}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip />
              <Bar dataKey="prompt_tokens" name="输入Token" fill="#1677ff" />
              <Bar dataKey="completion_tokens" name="输出Token" fill="#52c41a" />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      )}

      <Card title="最近调用记录">
        <Table
          dataSource={recentCalls}
          columns={columns}
          rowKey="id"
          loading={loading}
          size="small"
          scroll={isMobile ? { x: 600 } : undefined}
          pagination={{ pageSize: 10, size: 'small' }}
        />
      </Card>
    </div>
  );
}
