import { Card, Descriptions, Space, Typography, Alert } from 'antd';
import { CloudServerOutlined, SafetyCertificateOutlined, SyncOutlined } from '@ant-design/icons';

const { Text, Title } = Typography;

export default function Settings() {
  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>系统设置</Title>
        <Text type="secondary">服务器、本地千牛采集端与数据同步的工作边界</Text>
      </div>

      <Alert
        type="success"
        showIcon
        message="IP 规则"
        description="淘宝登录、页面访问、订单与地址采集全部由运行千牛客户端的电脑完成；服务器只负责账号鉴权、权限与接收同步后的业务数据。"
      />

      <Card title="当前运行模式" size="small">
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="服务角色">中央服务器：只接收数据</Descriptions.Item>
          <Descriptions.Item label="采集方式">千牛自驱动采集（桌面连接器推送到 ERP）</Descriptions.Item>
          <Descriptions.Item label="数据来源">本地千牛采集服务（多店铺自动发现、持续采集）</Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="数据流" size="small">
        <Space direction="vertical" size={12}>
          <Space><SafetyCertificateOutlined />用户在服务器账号体系登录，服务器签发并校验 Token。</Space>
          <Space><CloudServerOutlined />千牛客户端登录的店铺被自动发现并持续采集订单。</Space>
          <Space><SyncOutlined />桌面连接器将订单/地址/店铺数据同步写入中央数据库。</Space>
        </Space>
      </Card>
    </Space>
  );
}
