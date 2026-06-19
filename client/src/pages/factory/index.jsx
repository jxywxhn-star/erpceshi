import { useEffect, useState } from 'react';
import {
  Badge, Button, Card, Descriptions, Empty, Form, Image, Input,
  Modal, Segmented, Space, Spin, Tag, Typography, message,
} from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { factoryApi } from '../../api';
import {
  FACTORY_STATUS_META, factoryStatusLabel, factoryStatusColor, parseImages,
} from '../../constants/factory';

const { Text, Title } = Typography;

const FILTERS = [
  { value: 'pushed', label: '待发货' },
  { value: 'shipped', label: '已发货' },
];

function ImageWall({ title, images, accent }) {
  if (!images.length) return null;
  return (
    <div style={{ marginBottom: 12 }}>
      <Text strong style={{ color: accent, fontSize: 15 }}>{title}（{images.length}）</Text>
      <div style={{ marginTop: 8 }}>
        <Image.PreviewGroup>
          <Space size={10} wrap>
            {images.map((url) => (
              <Image key={url} src={url} width={140} height={140} style={{ objectFit: 'cover', borderRadius: 8, border: `2px solid ${accent}` }} />
            ))}
          </Space>
        </Image.PreviewGroup>
      </div>
    </div>
  );
}

function packageFilename(order) {
  const raw = order.platform_created_at || order.created_at || '';
  const m = String(raw).match(/(\d{4})-(\d{2})-(\d{2})/);
  const date = m ? `${Number(m[2])}-${Number(m[3])}` : '';
  const qty = order.factory_quantity > 0 ? order.factory_quantity : order.quantity;
  const name = `${date} ${qty}件 ${order.receiver_name || ''}--夏天`.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return `${name || `订单${order.id}`}.zip`;
}

export default function FactoryWorkbench() {
  const [filter, setFilter] = useState('pushed');
  const [list, setList] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);
  const [downloading, setDownloading] = useState(0);

  const [shipOrder, setShipOrder] = useState(null);
  const [form] = Form.useForm();
  const [submitting, setSubmitting] = useState(false);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [res, sum] = await Promise.all([factoryApi.orders({ status: filter }), factoryApi.summary()]);
      setList(res?.list || []);
      setSummary(sum || {});
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filter]);

  const openShip = (order) => {
    form.resetFields();
    setShipOrder(order);
  };

  const submitShip = async () => {
    const values = await form.validateFields();
    setSubmitting(true);
    try {
      await factoryApi.ship(shipOrder.id, { tracking_no: values.tracking_no });
      message.success('已发货，单号已回传');
      setShipOrder(null);
      fetchData();
    } catch { /* 拦截器已提示 */ } finally {
      setSubmitting(false);
    }
  };

  const handleDownload = async (order) => {
    setDownloading(order.id);
    try {
      const blob = await factoryApi.downloadPackage(order.id);
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = packageFilename(order);
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch {
      message.error('下载失败，请稍后重试');
    } finally {
      setDownloading(0);
    }
  };

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <Title level={4} style={{ margin: 0 }}>工厂工作台</Title>
        <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>刷新</Button>
      </div>

      <Segmented
        value={filter}
        onChange={setFilter}
        options={FILTERS.map((f) => ({
          value: f.value,
          label: (
            <Badge count={summary[f.value] || 0} size="small" offset={[8, -2]} color={FACTORY_STATUS_META[f.value]?.color}>
              <span style={{ padding: '0 4px' }}>{f.label}</span>
            </Badge>
          ),
        }))}
      />

      <Spin spinning={loading}>
        {list.length === 0 ? (
          <Empty description="暂无订单" />
        ) : (
          <Space direction="vertical" size={16} style={{ width: '100%' }}>
            {list.map((order) => {
              const effect = parseImages(order.factory_effect_images);
              const base = parseImages(order.factory_base_images);
              const qty = order.factory_quantity > 0 ? order.factory_quantity : order.quantity;
              return (
                <Card
                  key={order.id}
                  size="small"
                  title={(
                    <Space>
                      <Tag color={factoryStatusColor(order.factory_status)}>{factoryStatusLabel(order.factory_status)}</Tag>
                      <Text strong>订单 {order.order_no}</Text>
                    </Space>
                  )}
                  extra={(
                    <Space>
                      <Button icon={<DownloadOutlined />} loading={downloading === order.id} onClick={() => handleDownload(order)}>
                        下载生产包
                      </Button>
                      {order.factory_status === 'pushed' && (
                        <Button type="primary" onClick={() => openShip(order)}>发货并填单号</Button>
                      )}
                    </Space>
                  )}
                >
                  {(effect.length > 0 || base.length > 0) ? (
                    <>
                      <ImageWall title="效果图" images={effect} accent="#1677ff" />
                      <ImageWall title="底图" images={base} accent="#fa8c16" />
                    </>
                  ) : (
                    <Text type="secondary" style={{ display: 'block', marginBottom: 12 }}>（本单未附图）</Text>
                  )}

                  <Descriptions size="small" column={1} bordered>
                    <Descriptions.Item label="款式">{order.factory_spec || '-'}</Descriptions.Item>
                    <Descriptions.Item label="码数">{order.factory_size || '-'}</Descriptions.Item>
                    <Descriptions.Item label="印花">{order.factory_print || '-'}</Descriptions.Item>
                    <Descriptions.Item label="合计数量">{qty}</Descriptions.Item>
                    <Descriptions.Item label="收件人">
                      {order.receiver_name || '-'}　{order.receiver_phone || ''}
                    </Descriptions.Item>
                    <Descriptions.Item label="收件地址">
                      {order.receiver_address || order.receiver_raw || '-'}
                    </Descriptions.Item>
                    {order.factory_status === 'shipped' && (
                      <Descriptions.Item label="物流单号">{order.factory_tracking_no}</Descriptions.Item>
                    )}
                  </Descriptions>
                </Card>
              );
            })}
          </Space>
        )}
      </Spin>

      <Modal
        title="发货并回传单号"
        open={Boolean(shipOrder)}
        onOk={submitShip}
        confirmLoading={submitting}
        onCancel={() => setShipOrder(null)}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="tracking_no" label="物流单号" rules={[{ required: true, message: '请填写物流单号' }]}>
            <Input placeholder="填写发货物流单号" />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
