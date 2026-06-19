import { useEffect, useState } from 'react';
import { Card, DatePicker, Select, Space, Table, Tag, Typography } from 'antd';
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
import { reportApi } from '../../api';
import { useResponsive } from '../../hooks/useResponsive';

const { RangePicker } = DatePicker;
const { Text } = Typography;

function money(value) {
  return `¥${Number(value || 0).toFixed(2)}`;
}

function defaultRange() {
  return [dayjs().subtract(30, 'day'), dayjs()];
}

export default function Reports() {
  const [dateRange, setDateRange] = useState(defaultRange());
  const [tab, setTab] = useState('daily');
  const [dailyData, setDailyData] = useState([]);
  const [shopData, setShopData] = useState([]);
  const [shopDailyData, setShopDailyData] = useState([]);
  const [handlerData, setHandlerData] = useState([]);
  const [loading, setLoading] = useState(false);
  const { isMobile } = useResponsive();
  const user = JSON.parse(localStorage.getItem('user') || '{}');

  const params = () => ({
    start_date: dateRange?.[0]?.format('YYYY-MM-DD'),
    end_date: dateRange?.[1]?.format('YYYY-MM-DD'),
  });

  const fetchData = async () => {
    setLoading(true);
    try {
      const baseParams = params();
      const [daily, byShop, shopDaily, byHandler] = await Promise.all([
        reportApi.daily(baseParams),
        reportApi.byShop(baseParams),
        reportApi.shopDaily({ ...baseParams, group_by: 'shop' }),
        user.role === 'admin' ? reportApi.byHandler(baseParams) : Promise.resolve([]),
      ]);
      setDailyData((daily || []).map((item) => ({
        ...item,
        profit: Number(item.total_sales || 0) - Number(item.total_refund || 0) - Number(item.total_cost || 0),
      })));
      setShopData((byShop || []).map((item) => ({
        ...item,
        profit: Number(item.total_sales || 0) - Number(item.total_refund || 0) - Number(item.total_cost || 0),
      })));
      setShopDailyData(shopDaily || []);
      setHandlerData((byHandler || []).map((item) => ({
        ...item,
        profit: Number(item.total_sales || 0) - Number(item.total_refund || 0) - Number(item.total_cost || 0),
      })));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, [dateRange]);

  const shopColumns = [
    { title: '店铺', dataIndex: 'shop_name', key: 'shop_name', ellipsis: true },
    { title: '订单数', dataIndex: 'order_count', key: 'order_count', width: 90 },
    { title: '销售额', dataIndex: 'total_sales', key: 'total_sales', width: 120, render: money },
    { title: '成本', dataIndex: 'total_cost', key: 'total_cost', width: 110, render: money },
    { title: '退款', dataIndex: 'total_refund', key: 'total_refund', width: 110, render: money },
    { title: '毛利', dataIndex: 'profit', key: 'profit', width: 110, render: money },
  ];

  const shopDailyColumns = [
    { title: '店铺', dataIndex: 'shop_name', key: 'shop_name', ellipsis: true },
    { title: '卖出单数', dataIndex: 'sold_order_count', key: 'sold_order_count', width: 100 },
    { title: '未付款', dataIndex: 'unpaid_order_count', key: 'unpaid_order_count', width: 90, render: (value) => <Tag>{value || 0}</Tag> },
    { title: '处理完成', dataIndex: 'completed_order_count', key: 'completed_order_count', width: 100 },
    { title: '已拍单未传安抚单', dataIndex: 'ordered_not_uploaded_count', key: 'ordered_not_uploaded_count', width: 150, render: (value) => <Tag color={Number(value) > 0 ? 'orange' : 'default'}>{value || 0}</Tag> },
    { title: '等待同步单号', dataIndex: 'ordered_waiting_tracking_count', key: 'ordered_waiting_tracking_count', width: 130, render: (value) => <Tag color={Number(value) > 0 ? 'blue' : 'default'}>{value || 0}</Tag> },
    { title: '未发货', dataIndex: 'unshipped_order_count', key: 'unshipped_order_count', width: 90, render: (value) => <Tag color={Number(value) > 0 ? 'orange' : 'default'}>{value || 0}</Tag> },
    { title: '发货超时', dataIndex: 'shipping_overdue_count', key: 'shipping_overdue_count', width: 100, render: (value) => <Tag color={Number(value) > 0 ? 'red' : 'default'}>{value || 0}</Tag> },
    { title: '6小时内到期', dataIndex: 'shipping_due_soon_count', key: 'shipping_due_soon_count', width: 120, render: (value) => <Tag color={Number(value) > 0 ? 'orange' : 'default'}>{value || 0}</Tag> },
    { title: '未完成处理', dataIndex: 'unprocessed_order_count', key: 'unprocessed_order_count', width: 110, render: (value) => <Tag color={Number(value) > 0 ? 'red' : 'green'}>{value || 0}</Tag> },
    { title: '销售额', dataIndex: 'total_sales', key: 'total_sales', width: 120, render: money },
    { title: '最近订单', dataIndex: 'last_order_at', key: 'last_order_at', width: 150, render: (value) => (value ? dayjs(value).format('YYYY-MM-DD HH:mm') : '-') },
  ];

  const dailyColumns = [
    { title: '日期', dataIndex: 'date', key: 'date', width: 120 },
    { title: '订单数', dataIndex: 'order_count', key: 'order_count', width: 90 },
    { title: '销售额', dataIndex: 'total_sales', key: 'total_sales', width: 120, render: money },
    { title: '成本', dataIndex: 'total_cost', key: 'total_cost', width: 110, render: money },
    { title: '退款', dataIndex: 'total_refund', key: 'total_refund', width: 110, render: money },
    { title: '毛利', dataIndex: 'profit', key: 'profit', width: 110, render: money },
  ];

  const handlerColumns = [
    { title: '人员', dataIndex: 'handler_name', key: 'handler_name' },
    { title: '订单数', dataIndex: 'order_count', key: 'order_count', width: 90 },
    { title: '销售额', dataIndex: 'total_sales', key: 'total_sales', width: 120, render: money },
    { title: '成本', dataIndex: 'total_cost', key: 'total_cost', width: 110, render: money },
    { title: '毛利', dataIndex: 'profit', key: 'profit', width: 110, render: money },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>数据报表</h3>
          <Text type="secondary">未付款、买家取消、关闭订单不计入销售和利润</Text>
        </div>
        <Space wrap>
          <Select
            value={tab}
            onChange={setTab}
            style={{ width: 132 }}
            options={[
              { value: 'daily', label: '每日趋势' },
              { value: 'shop', label: '店铺销售' },
              { value: 'shopDaily', label: '店铺处理' },
              ...(user.role === 'admin' ? [{ value: 'handler', label: '人员统计' }] : []),
            ]}
          />
          <RangePicker value={dateRange} onChange={(value) => setDateRange(value || defaultRange())} />
        </Space>
      </div>

      {tab === 'daily' && (
        <Card title="每日趋势" size="small" loading={loading}>
          <ResponsiveContainer width="100%" height={isMobile ? 280 : 360}>
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
          <Table columns={dailyColumns} dataSource={dailyData} rowKey="date" size="small" pagination={{ pageSize: 10 }} scroll={{ x: 660 }} style={{ marginTop: 16 }} />
        </Card>
      )}

      {tab === 'shop' && (
        <Card title="店铺销售对比" size="small" loading={loading}>
          <ResponsiveContainer width="100%" height={isMobile ? 260 : 340}>
            <BarChart data={shopData.slice(0, 12)}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
              <XAxis dataKey="shop_name" hide />
              <YAxis />
              <Tooltip />
              <Legend />
              <Bar dataKey="total_sales" name="销售额" fill="#1677ff" />
              <Bar dataKey="profit" name="毛利" fill="#16a34a" />
            </BarChart>
          </ResponsiveContainer>
          <Table columns={shopColumns} dataSource={shopData} rowKey="shop_id" size="small" pagination={{ pageSize: 10 }} scroll={{ x: 660 }} style={{ marginTop: 16 }} />
        </Card>
      )}

      {tab === 'shopDaily' && (
        <Card title="店铺处理数据" size="small">
          <Table columns={shopDailyColumns} dataSource={shopDailyData} rowKey="shop_id" size="small" loading={loading} scroll={{ x: 1460 }} pagination={{ pageSize: 20 }} />
        </Card>
      )}

      {tab === 'handler' && user.role === 'admin' && (
        <Card title="人员统计" size="small" loading={loading}>
          <Table columns={handlerColumns} dataSource={handlerData} rowKey="handler_id" size="small" scroll={{ x: 540 }} pagination={false} />
        </Card>
      )}
    </Space>
  );
}
