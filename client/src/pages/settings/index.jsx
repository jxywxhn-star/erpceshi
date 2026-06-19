import { useEffect, useState } from 'react';
import { Alert, Card, Descriptions, Space, Typography } from 'antd';
import { CloudServerOutlined, SafetyCertificateOutlined, SyncOutlined } from '@ant-design/icons';
import { collectorApi } from '../../api';

const { Text, Title } = Typography;

export default function Settings() {
  const [collectorConfig, setCollectorConfig] = useState(null);

  useEffect(() => {
    collectorApi.config().then(setCollectorConfig).catch(() => setCollectorConfig(null));
  }, []);

  const centralMode = collectorConfig?.collector_control_enabled === false;
  const bridgeMode = collectorConfig?.bridge_mode === true;

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div>
        <Title level={4} style={{ margin: 0 }}>系统设置</Title>
        <Text type="secondary">确认服务器、本地采集端和数据同步的工作边界</Text>
      </div>

      <Alert
        type="success"
        showIcon
        message="IP 规则"
        description="淘宝和京东登录、页面访问、订单采集全部由运行本地 EXE 的电脑完成；服务器只负责账号鉴权、权限和接收同步后的业务数据。"
      />

      <Card title="当前运行模式" size="small">
        <Descriptions column={1} size="small" bordered>
          <Descriptions.Item label="服务角色">
            {centralMode ? '中央服务器：只接收数据' : bridgeMode ? '本地 EXE 桥接：控制本机采集器' : '本地单机模式'}
          </Descriptions.Item>
          <Descriptions.Item label="采集器控制">
            {collectorConfig?.collector_control_enabled === false ? '已关闭服务器直连采集' : '允许本机采集控制'}
          </Descriptions.Item>
          <Descriptions.Item label="本机采集器地址">
            {collectorConfig?.collector_base_url || 'http://127.0.0.1:5069'}
          </Descriptions.Item>
          <Descriptions.Item label="远程 ERP 服务器">
            {collectorConfig?.remote_erp_base_url || '当前服务本身'}
          </Descriptions.Item>
        </Descriptions>
      </Card>

      <Card title="数据流" size="small">
        <Space direction="vertical" size={12}>
          <Space><SafetyCertificateOutlined />用户在服务器账号体系登录，服务器签发并校验 Token。</Space>
          <Space><CloudServerOutlined />本地 EXE 内的页面调用本机采集器打开淘宝/京东店铺会话。</Space>
          <Space><SyncOutlined />采集器解析订单后，通过服务器同步接口写入中央数据库。</Space>
        </Space>
      </Card>
    </Space>
  );
}
