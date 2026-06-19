import { useEffect, useState } from 'react';
import {
  Button, Card, Form, Image, Input, InputNumber, Modal, Popconfirm, Select,
  Space, Table, Tag, Typography, message,
} from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { productApi, orderApi } from '../../api';
import ImageUploader, { urlsToFileList, fileListToUrls } from '../../components/ImageUploader';
import { parseImages } from '../../constants/factory';
import { useResponsive } from '../../hooks/useResponsive';

const { Text } = Typography;

export default function Products() {
  const [list, setList] = useState([]);
  const [factories, setFactories] = useState([]);
  const [loading, setLoading] = useState(false);
  const { isMobile } = useResponsive();

  const [editOpen, setEditOpen] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form] = Form.useForm();
  const [effectList, setEffectList] = useState([]);
  const [baseList, setBaseList] = useState([]);
  const [saving, setSaving] = useState(false);

  const [aliasOpen, setAliasOpen] = useState(false);
  const [aliasProduct, setAliasProduct] = useState(null);
  const [aliasForm] = Form.useForm();

  const fetchData = async () => {
    setLoading(true);
    try {
      const [res, fac] = await Promise.all([productApi.list(), orderApi.factories().catch(() => [])]);
      setList(res || []);
      setFactories(fac || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { fetchData(); }, []);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    setEffectList([]);
    setBaseList([]);
    setEditOpen(true);
  };

  const openEdit = (record) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      product_code: record.product_code,
      factory_id: record.factory_id || undefined,
      factory_quote: record.factory_quote || undefined,
      note: record.note,
    });
    setEffectList(urlsToFileList(parseImages(record.effect_images)));
    setBaseList(urlsToFileList(parseImages(record.base_images)));
    setEditOpen(true);
  };

  const handleSave = async () => {
    const values = await form.validateFields();
    const payload = {
      ...values,
      effect_images: fileListToUrls(effectList),
      base_images: fileListToUrls(baseList),
    };
    setSaving(true);
    try {
      if (editing) {
        await productApi.update(editing.id, payload);
        message.success('成品已更新');
      } else {
        await productApi.create(payload);
        message.success('成品已创建');
      }
      setEditOpen(false);
      fetchData();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    await productApi.delete(id);
    message.success('成品已删除');
    fetchData();
  };

  const openAlias = (record) => {
    setAliasProduct(record);
    aliasForm.resetFields();
    setAliasOpen(true);
  };

  const addAlias = async () => {
    const values = await aliasForm.validateFields();
    const res = await productApi.addAlias(aliasProduct.id, values);
    message.success(res.message || '已绑定');
    aliasForm.resetFields();
    const fresh = await productApi.list();
    setList(fresh || []);
    setAliasProduct((fresh || []).find((p) => p.id === aliasProduct.id) || aliasProduct);
  };

  const removeAlias = async (aliasId) => {
    await productApi.deleteAlias(aliasId);
    message.success('已解绑');
    const fresh = await productApi.list();
    setList(fresh || []);
    setAliasProduct((fresh || []).find((p) => p.id === aliasProduct.id) || aliasProduct);
  };

  const columns = [
    {
      title: '成品',
      key: 'name',
      render: (_, r) => (
        <Space>
          <Image
            width={48}
            height={48}
            src={r.main_image || (parseImages(r.effect_images)[0]) || ''}
            style={{ objectFit: 'cover', borderRadius: 4 }}
            fallback="data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='48' height='48'><rect width='48' height='48' fill='%23f0f0f0'/></svg>"
          />
          <div>
            <div><Text strong>{r.name}</Text></div>
            {r.product_code && <Text type="secondary" style={{ fontSize: 12 }}>货号 {r.product_code}</Text>}
          </div>
        </Space>
      ),
    },
    { title: '工厂', dataIndex: 'factory_name', key: 'factory_name', width: 120, render: (v) => v || '-' },
    { title: '报价', dataIndex: 'factory_quote', key: 'factory_quote', width: 100, render: (v) => `¥${Number(v || 0).toFixed(2)}` },
    {
      title: '素材',
      key: 'imgs',
      width: 100,
      render: (_, r) => `效${parseImages(r.effect_images).length}/底${parseImages(r.base_images).length}`,
    },
    {
      title: '绑定商品ID',
      key: 'alias',
      width: 130,
      render: (_, r) => (
        <Button type="link" size="small" onClick={() => openAlias(r)}>
          {r.alias_count || 0} 个链接
        </Button>
      ),
    },
    { title: '关联订单', dataIndex: 'order_count', key: 'order_count', width: 90, render: (v) => v || 0 },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, r) => (
        <Space>
          <Button type="link" size="small" onClick={() => openEdit(r)}>编辑</Button>
          <Popconfirm title="删除成品？关联订单将退回未分类" onConfirm={() => handleDelete(r.id)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ margin: 0 }}>成品库 / 素材库</h3>
          <Text type="secondary">成品报价与素材一次录入，多店铺/多链接同款自动套用</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchData} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={openCreate}>新增成品</Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={list}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={false}
        scroll={isMobile ? { x: 720 } : undefined}
      />

      <Modal
        title={editing ? '编辑成品' : '新增成品'}
        open={editOpen}
        onOk={handleSave}
        confirmLoading={saving}
        onCancel={() => setEditOpen(false)}
        width={isMobile ? '95%' : 600}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="成品名称" rules={[{ required: true, message: '请填写名称' }]}>
            <Input placeholder="如：纯色蜡烛礼盒A款" />
          </Form.Item>
          <Space style={{ width: '100%' }} direction={isMobile ? 'vertical' : 'horizontal'}>
            <Form.Item name="product_code" label="货号（可选）">
              <Input placeholder="内部货号" />
            </Form.Item>
            <Form.Item name="factory_id" label="默认工厂">
              <Select
                style={{ width: 180 }}
                allowClear
                placeholder="选择工厂"
                options={factories.map((f) => ({ value: f.id, label: f.nickname || f.username }))}
              />
            </Form.Item>
            <Form.Item name="factory_quote" label="成品报价(元)" rules={[{ required: true, message: '请填写报价' }]}>
              <InputNumber min={0} precision={2} style={{ width: 140 }} />
            </Form.Item>
          </Space>
          <Form.Item label="效果图（高清，复用）">
            <ImageUploader fileList={effectList} onChange={setEffectList} />
          </Form.Item>
          <Form.Item label="底图（高清，复用）">
            <ImageUploader fileList={baseList} onChange={setBaseList} />
          </Form.Item>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        title={`绑定商品ID — ${aliasProduct?.name || ''}`}
        open={aliasOpen}
        footer={null}
        onCancel={() => setAliasOpen(false)}
        width={isMobile ? '95%' : 520}
        destroyOnHidden
      >
        <Text type="secondary">把各店铺/链接的平台商品ID绑到此成品，绑定后该商品订单自动套用报价与素材。</Text>
        <Card size="small" style={{ marginTop: 12 }}>
          <Form form={aliasForm} layout="inline" onFinish={addAlias}>
            <Form.Item name="item_id" rules={[{ required: true, message: '商品ID' }]}>
              <Input placeholder="平台商品ID(ItemId)" style={{ width: 200 }} />
            </Form.Item>
            <Form.Item name="sku_id">
              <Input placeholder="规格ID(可空=全规格)" style={{ width: 160 }} />
            </Form.Item>
            <Form.Item>
              <Button type="primary" htmlType="submit">绑定</Button>
            </Form.Item>
          </Form>
        </Card>
        <div style={{ marginTop: 12 }}>
          {(aliasProduct?.aliases || []).length === 0 ? (
            <Text type="secondary">尚未绑定任何商品ID</Text>
          ) : (
            <Space direction="vertical" style={{ width: '100%' }}>
              {(aliasProduct?.aliases || []).map((a) => (
                <Space key={a.id} style={{ justifyContent: 'space-between', width: '100%' }}>
                  <span>
                    <Tag>{a.item_id}</Tag>
                    {a.sku_id ? <Tag color="blue">SKU {a.sku_id}</Tag> : <Tag>全规格</Tag>}
                  </span>
                  <Popconfirm title="解绑该商品ID？" onConfirm={() => removeAlias(a.id)}>
                    <Button type="link" size="small" danger>解绑</Button>
                  </Popconfirm>
                </Space>
              ))}
            </Space>
          )}
        </div>
      </Modal>
    </Space>
  );
}
