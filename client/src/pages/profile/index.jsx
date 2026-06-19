import { useState } from 'react';
import { Card, Form, Input, Button, message, Descriptions, List } from 'antd';
import { LockOutlined, ShopOutlined, TeamOutlined, BarChartOutlined, SettingOutlined, ApiOutlined } from '@ant-design/icons';
import { authApi } from '../../api';
import { useNavigate } from 'react-router-dom';
import { useResponsive } from '../../hooks/useResponsive';

export default function Profile() {
  const user = JSON.parse(localStorage.getItem('user') || '{}');
  const { isMobile } = useResponsive();
  const [form] = Form.useForm();
  const navigate = useNavigate();

  const handleChangePassword = async () => {
    const values = await form.validateFields();
    if (values.newPassword !== values.confirmPassword) {
      return message.error('两次密码不一致');
    }
    await authApi.changePassword({
      oldPassword: values.oldPassword,
      newPassword: values.newPassword,
    });
    message.success('密码修改成功，请重新登录');
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    navigate('/login');
  };

  const adminActions = [
    { title: '店铺管理', icon: <ShopOutlined />, path: '/shops', desc: '管理店铺信息' },
    { title: '用户管理', icon: <TeamOutlined />, path: '/users', desc: '管理用户账号' },
    { title: '数据报表', icon: <BarChartOutlined />, path: '/reports', desc: '查看详细报表' },
    { title: '系统设置', icon: <SettingOutlined />, path: '/settings', desc: '配置OCR等系统参数' },
    { title: 'Token统计', icon: <ApiOutlined />, path: '/token-usage', desc: '查看AI调用Token用量' },
  ];

  return (
    <div>
      <Card title="个人信息">
        <Descriptions column={1}>
          <Descriptions.Item label="用户名">{user.username}</Descriptions.Item>
          <Descriptions.Item label="昵称">{user.nickname}</Descriptions.Item>
          <Descriptions.Item label="角色">{user.role === 'admin' ? '管理员' : '录入员'}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="修改密码" style={{ marginTop: 16 }}>
        <Form form={form} layout="vertical" style={{ maxWidth: 400 }}>
          <Form.Item name="oldPassword" label="原密码" rules={[{ required: true, message: '请输入原密码' }]}>
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item name="newPassword" label="新密码" rules={[{ required: true, message: '请输入新密码' }]}>
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item name="confirmPassword" label="确认新密码" rules={[{ required: true, message: '请确认新密码' }]}>
            <Input.Password prefix={<LockOutlined />} />
          </Form.Item>
          <Form.Item>
            <Button type="primary" onClick={handleChangePassword}>
              修改密码
            </Button>
          </Form.Item>
        </Form>
      </Card>

      {user.role === 'admin' && (
        <Card title="管理功能" style={{ marginTop: 16 }}>
          <List
            dataSource={adminActions}
            renderItem={(item) => (
              <List.Item
                style={{ cursor: 'pointer' }}
                onClick={() => navigate(item.path)}
              >
                <List.Item.Meta avatar={item.icon} title={item.title} description={item.desc} />
              </List.Item>
            )}
          />
        </Card>
      )}
    </div>
  );
}
