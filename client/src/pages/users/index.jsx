import { useEffect, useState } from 'react';
import { Button, Form, Input, Modal, Popconfirm, Select, Space, Table, Tag, Typography, message } from 'antd';
import { PlusOutlined, ReloadOutlined } from '@ant-design/icons';
import { userApi } from '../../api';
import { useResponsive } from '../../hooks/useResponsive';

const { Text } = Typography;

export default function Users() {
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingUser, setEditingUser] = useState(null);
  const { isMobile } = useResponsive();
  const [form] = Form.useForm();

  const fetchUsers = async () => {
    setLoading(true);
    try {
      const res = await userApi.list();
      setUsers(res || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchUsers();
  }, []);

  const handleAdd = () => {
    setEditingUser(null);
    form.resetFields();
    form.setFieldsValue({ role: 'operator', status: 1 });
    setModalOpen(true);
  };

  const handleEdit = (record) => {
    setEditingUser(record);
    form.setFieldsValue({ ...record, password: undefined });
    setModalOpen(true);
  };

  const handleSubmit = async () => {
    const values = await form.validateFields();
    if (!values.password) delete values.password;
    if (editingUser) {
      await userApi.update(editingUser.id, values);
      message.success('账号已更新');
    } else {
      await userApi.create(values);
      message.success('账号已创建');
    }
    setModalOpen(false);
    fetchUsers();
  };

  const handleDelete = async (id) => {
    await userApi.delete(id);
    message.success('账号已删除');
    fetchUsers();
  };

  const columns = [
    { title: 'ID', dataIndex: 'id', key: 'id', width: 70 },
    { title: '账号', dataIndex: 'username', key: 'username', width: 150 },
    { title: '昵称', dataIndex: 'nickname', key: 'nickname', width: 150 },
    {
      title: '角色',
      dataIndex: 'role',
      key: 'role',
      width: 120,
      render: (value) => {
        if (value === 'admin') return <Tag color="blue">管理员</Tag>;
        if (value === 'factory') return <Tag color="purple">工厂</Tag>;
        return <Tag color="green">操作员</Tag>;
      },
    },
    {
      title: '状态',
      dataIndex: 'status',
      key: 'status',
      width: 100,
      render: (value) => (value === 1 ? <Tag color="green">启用</Tag> : <Tag color="red">停用</Tag>),
    },
    { title: '创建时间', dataIndex: 'created_at', key: 'created_at', width: 180 },
    {
      title: '操作',
      key: 'action',
      width: 150,
      render: (_, record) => (
        <Space>
          <Button type="link" size="small" onClick={() => handleEdit(record)}>编辑</Button>
          <Popconfirm title="确定删除该账号？" onConfirm={() => handleDelete(record.id)}>
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
          <h3 style={{ margin: 0 }}>账号权限</h3>
          <Text type="secondary">服务器统一管理用户登录和操作权限</Text>
        </div>
        <Space>
          <Button icon={<ReloadOutlined />} onClick={fetchUsers} loading={loading}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={handleAdd}>新增账号</Button>
        </Space>
      </div>

      <Table
        columns={columns}
        dataSource={users}
        rowKey="id"
        loading={loading}
        size="small"
        pagination={false}
        scroll={isMobile ? { x: 760 } : undefined}
      />

      <Modal
        title={editingUser ? '编辑账号' : '新增账号'}
        open={modalOpen}
        onOk={handleSubmit}
        onCancel={() => setModalOpen(false)}
        width={isMobile ? '95%' : 460}
        destroyOnHidden
      >
        <Form form={form} layout="vertical">
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input disabled={Boolean(editingUser)} />
          </Form.Item>
          <Form.Item
            name="password"
            label={editingUser ? '新密码（留空不修改）' : '密码'}
            rules={editingUser ? [] : [{ required: true, message: '请输入密码' }]}
          >
            <Input.Password />
          </Form.Item>
          <Form.Item name="nickname" label="昵称" rules={[{ required: true, message: '请输入昵称' }]}>
            <Input />
          </Form.Item>
          <Form.Item name="role" label="角色">
            <Select options={[{ value: 'admin', label: '管理员' }, { value: 'operator', label: '操作员' }, { value: 'factory', label: '工厂' }]} />
          </Form.Item>
          <Form.Item name="status" label="状态">
            <Select options={[{ value: 1, label: '启用' }, { value: 0, label: '停用' }]} />
          </Form.Item>
        </Form>
      </Modal>
    </Space>
  );
}
