import { Button, Card, Form, Input, Typography, message } from 'antd';
import { LockOutlined, UserOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { authApi } from '../../api';
import { useResponsive } from '../../hooks/useResponsive';

const { Text, Title } = Typography;

export default function Login({ onLogin }) {
  const navigate = useNavigate();
  const { isMobile } = useResponsive();
  const [form] = Form.useForm();

  const handleSubmit = async (values) => {
    try {
      const res = await authApi.login(values);
      localStorage.setItem('token', res.token);
      localStorage.setItem('user', JSON.stringify(res.user));
      message.success('登录成功');
      onLogin(res.user);
      navigate(res.user?.role === 'factory' ? '/factory' : '/');
    } catch {
      message.error('登录失败，请检查账号和密码');
    }
  };

  return (
    <div className="oms-login">
      <Card className="oms-login-card" bordered={!isMobile}>
        <div className="oms-login-brand">
          <img src="/app-icon.png" alt="" />
          <div>
            <Title level={3} style={{ margin: 0 }}>爱夏天 OMS</Title>
            <Text type="secondary">多店铺订单同步管理台</Text>
          </div>
        </div>

        <Form form={form} onFinish={handleSubmit} size="large" layout="vertical">
          <Form.Item name="username" label="账号" rules={[{ required: true, message: '请输入账号' }]}>
            <Input prefix={<UserOutlined />} placeholder="请输入账号" autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label="密码" rules={[{ required: true, message: '请输入密码' }]}>
            <Input.Password prefix={<LockOutlined />} placeholder="请输入密码" autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" block>
            登录
          </Button>
        </Form>
      </Card>
    </div>
  );
}
