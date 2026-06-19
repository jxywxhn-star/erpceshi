import { useEffect, useState } from 'react';
import {
  Table, Button, Modal, Form, Input, InputNumber, Select, Space, Popconfirm, message, Tag,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { expenseApi, shopApi } from '../../api';
import { useResponsive } from '../../hooks/useResponsive';

const CATEGORIES = {
  shipping: { text: '运费', color: 'blue' },
  packaging: { text: '包装费', color: 'green' },
  platform: { text: '平台费', color: 'orange' },
  other: { text: '其他', color: 'default' },
};

export default function Expenses() {
  const [expenses, setExpenses] = useState([]);
  const [shops, setShops] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState(null);
  const { isMobile } = useResponsive();
  const [form] = Form.useForm();

  const fetchData = async (p = page) => {
    setLoading(true);
    try {
      const res = await expenseApi.list({ page: p, pageSize: 20 });
      setExpenses(res.list);
      setTotal(res.total);
    } finally {
      setLoading(false);
    }
  };

  const fetchShops = async () => {
    const res = await shopApi.list();
    setShops(res);
  };

  useEffect(() => {
    fetchShops();
  }, []);

  useEffect(() => {
    fetchData();
  }, [page]);

  const handleAdd = () => {
    setEditingItem(null);
    form.resetFields();
    form.setFieldsValue({ category: 'other' });
    setModalOpen(true);
  };

  const handleEdit = (record) => {
    setEditingItem(record);
    form.setFieldsValue(record);
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (editingItem) {
      await expenseApi.update(editingItem.id, values);
      message.success('开支更新成功');
    } else {
      await expenseApi.create(values);
      message.success('开支创建成功');
    }
    setModalOpen(false);
    fetchData();
  };

  const handleDelete = async (id) => {
    await expenseApi.delete(id);
    message.success('删除成功');
    fetchData();
  };

  const columns = [
    { title: '店铺', dataIndex: 'shop_name', key: 'shop_name', width: 120 },
    {
      title: '类别',
      dataIndex: 'category',
      key: 'category',
      width: 100,
      render: (v) => {
        const c = CATEGORIES[v] || { text: v, color: 'default' };
        return <Tag color={c.color}>{c.text}</Tag>;
      },
    },
    { title: '金额', dataIndex: 'amount', key: 'amount', width: 100, render: (v) => `¥${Number(v).toFixed(2)}` },
    { title: '说明', dataIndex: 'description', key: 'description', ellipsis: true },
    { title: '经手人', dataIndex: 'handler_name', key: 'handler_name', width: 80 },
    { title: '日期', dataIndex: 'created_at', key: 'created_at', width: 160 },
    {
      title: '操作',
      key: 'action',
      width: 120,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const mobileColumns = [
    {
      title: '开支信息',
      key: 'info',
      render: (_, r) => {
        const c = CATEGORIES[r.category] || { text: r.category, color: 'default' };
        return (
          <div style={{ padding: '4px 0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between' }}>
              <Tag color={c.color}>{c.text}</Tag>
              <strong style={{ color: '#ff4d4f' }}>¥{Number(r.amount).toFixed(2)}</strong>
            </div>
            <div style={{ color: '#666', fontSize: 12, marginTop: 4 }}>
              {r.shop_name} · {r.handler_name}
            </div>
            {r.description && <div style={{ color: '#999', fontSize: 12 }}>{r.description}</div>}
          </div>
        );
      },
    },
    {
      title: '',
      key: 'action',
      width: 80,
      render: (_, record) => (
        <Space direction="vertical">
          <Button type="link" size="small" onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除？" onConfirm={() => handleDelete(record.id)}>
            <Button type="link" size="small" danger>删除</Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0 }}>其他开支</h3>
        <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>
          新增开支
        </Button>
      </div>

      <Table
        columns={isMobile ? mobileColumns : columns}
        dataSource={expenses}
        rowKey="id"
        loading={loading}
        pagination={{
          current: page,
          total,
          pageSize: 20,
          onChange: (p) => setPage(p),
          showTotal: (t) => `共 ${t} 条`,
        }}
        size="small"
      />

      <Modal
        title={editingItem ? '编辑开支' : '新增开支'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={isMobile ? '95%' : 500}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="shop_id" label="店铺" rules={[{ required: true, message: '请选择店铺' }]}>
            <Select options={shops.map((s) => ({ value: s.id, label: s.name }))} />
          </Form.Item>
          <Form.Item name="category" label="类别">
            <Select options={Object.entries(CATEGORIES).map(([k, v]) => ({ value: k, label: v.text }))} />
          </Form.Item>
          <Form.Item name="amount" label="金额" rules={[{ required: true, message: '请输入金额' }]}>
            <InputNumber min={0} precision={2} prefix="¥" style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="description" label="说明">
            <Input.TextArea rows={2} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
