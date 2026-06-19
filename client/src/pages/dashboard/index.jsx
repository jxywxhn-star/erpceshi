import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, Card, Col, DatePicker, Row, Space, Statistic, Table, Tag, Typography } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  FieldTimeOutlined,
  InboxOutlined,
  RiseOutlined,
  ShopOutlined,
  ShoppingOutlined,
} from '@ant-design/icons';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import dayjs from 'dayjs';
import { useNavigate } from 'react-router-dom';
import { reportApi } from '../../api';
import { useResponsive } from '../../hooks/useResponsive';

const { RangePicker } = DatePicker;
const { Text, Title } = Typography;

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function defaultRange() {
  return [dayjs().subtract(14, 'day'), dayjs()];
}

export default function Dashboard() {
  const navigate = useNavigate();
  const [dateRange, setDateRange] = useState(defaultRange());
  const [overview, setOverview] = useState({});
  const [dailyData, setDailyData] = useState([]);
  const [shopRows, setShopRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const { isMobile } = useResponsive();

  const params = useMemo(() => ({
    start_date: dateRange?.[0]?.format('YYYY-MM-DD'),
    end_date: dateRange?.[1]?.format('YYYY-MM-DD'),
  }), [dateRange]);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [overviewRes, dailyRes, shopDailyRes] = await Promise.all([
        reportApi.overview(params),
        reportApi.daily(params),
        reportApi.shopDaily({ ...params, group_by: 'shop' }),
      ]);
      setOverview(overviewRes || {});
      setDailyData((dailyRes || []).map((item) => ({
        ...item,
        profit: Number(item.total_sales || 0) - Number(item.total_refund || 0) - Number(item.total_cost || 0),
      })));
      setShopRows(shopDailyRes || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [params.start_date, params.end_date]);

  const totals = shopRows.reduce((acc, row) => ({
    sold: acc.sold + Number(row.sold_order_count || 0),
    completed: acc.completed + Number(row.completed_order_count || 0),
    unshipped: acc.unshipped + Number(row.unshipped_order_count || 0),
    unprocessed: acc.unprocessed + Number(row.unprocessed_order_count || 0),
    orderedNotUploaded: acc.orderedNotUploaded + Number(row.ordered_not_uploaded_count || 0),
    waitingTracking: acc.waitingTracking + Number(row.ordered_waiting_tracking_count || 0),
    unpaid: acc.unpaid + Number(row.unpaid_order_count || 0),
    overdue: acc.overdue + Number(row.shipping_overdue_count || 0),
    dueSoon: acc.dueSoon + Number(row.shipping_due_soon_count || 0),
  }), { sold: 0, completed: 0, unshipped: 0, unprocessed: 0, orderedNotUploaded: 0, waitingTracking: 0, unpaid: 0, overdue: 0, dueSoon: 0 });

  const metrics = [
    { title: '有效订单', value: overview.order_count || 0, icon: <ShoppingOutlined />, color: '#1677ff' },
    { title: '销售额', value: overview.total_sales || 0, icon: <RiseOutlined />, color: '#16a34a', money: true },
    { title: '处理完成', value: totals.completed, icon: <CheckCircleOutlined />, color: '#0891b2' },
    { title: '未发货', value: totals.unshipped, icon: <InboxOutlined />, color: '#d97706', link: '/orders?delivery_status=unshipped' },
    { title: '发货超时', value: totals.overdue, icon: <ClockCircleOutlined />, color: '#dc2626', urgent: true, link: '/orders?delivery_status=overdue' },
    { title: '6小时内到期', value: totals.dueSoon, icon: <ClockCircleOutlined />, color: '#f59e0b', urgent: true, link: '/orders?delivery_status=due_soon' },
    { title: '未完成处理', value: totals.unprocessed, icon: <ClockCircleOutlined />, color: '#dc2626', urgent: true, link: '/orders?status=not_completed' },
    { title: '未付款', value: totals.unpaid, icon: <ClockCircleOutlined />, color: '#6b7280', link: '/orders?status=unpaid' },
    { title: '店铺数', value: shopRows.length, icon: <ShopOutlined />, color: '#4f46e5' },
  ];

  const shopColumns = [
    {
      title: '店铺',
      dataIndex: 'shop_name',
      key: 'shop_name',
      ellipsis: true,
      render: (value) => <Text strong>{value || '-'}</Text>,
    },
    { title: '卖出单数', dataIndex: 'sold_order_count', key: 'sold_order_count', width: 100 },
    {
      title: '未付款',
      dataIndex: 'unpaid_order_count',
      key: 'unpaid_order_count',
      width: 90,
      render: (value) => <Tag color={Number(value) > 0 ? 'default' : 'green'}>{value || 0}</Tag>,
    },
    { title: '处理完成', dataIndex: 'completed_order_count', key: 'completed_order_count', width: 100 },
    {
      title: '已拍单未传安抚单',
      dataIndex: 'ordered_not_uploaded_count',
      key: 'ordered_not_uploaded_count',
      width: 150,
      render: (value) => <Tag color={Number(value) > 0 ? 'orange' : 'default'}>{value || 0}</Tag>,
    },
    {
      title: '等待同步单号',
      dataIndex: 'ordered_waiting_tracking_count',
      key: 'ordered_waiting_tracking_count',
      width: 130,
      render: (value) => <Tag color={Number(value) > 0 ? 'blue' : 'default'}>{value || 0}</Tag>,
    },
    {
      title: '未发货',
      dataIndex: 'unshipped_order_count',
      key: 'unshipped_order_count',
      width: 90,
      render: (value) => <Tag color={Number(value) > 0 ? 'orange' : 'default'}>{value || 0}</Tag>,
    },
    {
      title: '发货超时',
      dataIndex: 'shipping_overdue_count',
      key: 'shipping_overdue_count',
      width: 100,
      render: (value) => <Tag color={Number(value) > 0 ? 'red' : 'default'}>{value || 0}</Tag>,
    },
    {
      title: '6小时内到期',
      dataIndex: 'shipping_due_soon_count',
      key: 'shipping_due_soon_count',
      width: 120,
      render: (value) => <Tag color={Number(value) > 0 ? 'orange' : 'default'}>{value || 0}</Tag>,
    },
    {
      title: '未完成处理',
      dataIndex: 'unprocessed_order_count',
      key: 'unprocessed_order_count',
      width: 110,
      render: (value) => <Tag color={Number(value) > 0 ? 'red' : 'green'}>{value || 0}</Tag>,
    },
    { title: '销售额', dataIndex: 'total_sales', key: 'total_sales', width: 120, render: money },
    {
      title: '最近订单',
      dataIndex: 'last_order_at',
      key: 'last_order_at',
      width: 150,
      render: (value) => (value ? dayjs(value).format('MM-DD HH:mm') : '-'),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <Title level={4} style={{ margin: 0 }}>运营总览</Title>
          <Text type="secondary">服务器汇总所有本地采集端同步的数据</Text>
        </div>
        <RangePicker value={dateRange} onChange={(value) => setDateRange(value || defaultRange())} />
      </div>

      {totals.unprocessed > 0 && (
        <Alert
          type={totals.overdue > 0 ? 'error' : 'warning'}
          showIcon
          message={`当前还有 ${totals.unprocessed} 个订单未完成处理`}
          description={`其中 ${totals.overdue} 个发货已超时，${totals.dueSoon} 个 6 小时内到期，${totals.orderedNotUploaded} 个已拍单未上传安抚单，${totals.waitingTracking} 个已拍单等待同步单号。`}
          action={(
            <Button danger size="small" onClick={() => navigate('/orders?status=not_completed')}>
              去处理
            </Button>
          )}
        />
      )}

      <Row gutter={[12, 12]}>
        {metrics.map((item) => (
          <Col xs={12} sm={8} xl={4} key={item.title}>
            <Card
              size="small"
              loading={loading}
              bodyStyle={{ minHeight: 92 }}
              onClick={item.link ? () => navigate(item.link) : undefined}
              style={item.urgent && Number(item.value) > 0 ? { borderColor: '#dc2626', boxShadow: '0 0 0 1px rgba(220,38,38,0.18)' } : undefined}
            >
              <Space align="start" style={{ width: '100%', justifyContent: 'space-between' }}>
                <Statistic
                  title={item.title}
                  value={item.money ? Number(item.value || 0) : item.value}
                  precision={item.money ? 2 : 0}
                  prefix={item.money ? '¥' : undefined}
                  valueStyle={{ color: item.color, fontSize: isMobile ? 18 : 22 }}
                />
                <span style={{ color: item.color, fontSize: 22 }}>{item.icon}</span>
              </Space>
            </Card>
          </Col>
        ))}
      </Row>

      <Row gutter={[16, 16]}>
        <Col xs={24} xl={15}>
          <Card title="近日报表趋势" size="small" loading={loading}>
            <ResponsiveContainer width="100%" height={320}>
              <LineChart data={dailyData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip formatter={(value, name) => (name === '订单数' ? value : money(value))} />
                <Legend />
                <Line type="monotone" dataKey="total_sales" name="销售额" stroke="#1677ff" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="profit" name="毛利" stroke="#16a34a" strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="order_count" name="订单数" stroke="#d97706" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </Card>
        </Col>
        <Col xs={24} xl={9}>
          <Card title="店铺处理压力" size="small" loading={loading}>
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={shopRows.slice(0, 8)}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                <XAxis dataKey="shop_name" hide />
                <YAxis />
                <Tooltip />
                <Legend />
                <Bar dataKey="unprocessed_order_count" name="未完成处理" fill="#dc2626" />
                <Bar dataKey="shipping_overdue_count" name="发货超时" fill="#991b1b" />
                <Bar dataKey="shipping_due_soon_count" name="6小时内到期" fill="#f59e0b" />
                <Bar dataKey="unshipped_order_count" name="未发货" fill="#d97706" />
                <Bar dataKey="completed_order_count" name="处理完成" fill="#0891b2" />
              </BarChart>
            </ResponsiveContainer>
          </Card>
        </Col>
      </Row>

      <Card
        title="店铺今日/区间数据"
        size="small"
        extra={<Space><FieldTimeOutlined /><Text type="secondary">按店铺维度查看</Text></Space>}
      >
        <Table
          columns={shopColumns}
          dataSource={shopRows}
          rowKey="shop_id"
          loading={loading}
          size="small"
          scroll={{ x: 1340 }}
          pagination={{ pageSize: 10 }}
        />
      </Card>
    </Space>
  );
}
