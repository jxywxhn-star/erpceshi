import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { Alert, Avatar, Button, Dropdown, Layout, Menu, Space, Tag, Typography, message as antdMessage } from 'antd';
import {
  AppstoreOutlined,
  BarChartOutlined,
  CloudOutlined,
  DashboardOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  RiseOutlined,
  SettingOutlined,
  ShopOutlined,
  ShoppingOutlined,
  WarningOutlined,
  TeamOutlined,
  ToolOutlined,
  UserOutlined,
} from '@ant-design/icons';
import { useResponsive } from '../hooks/useResponsive';

const { Header, Sider, Content } = Layout;
const { Text } = Typography;

const primaryMenu = [
  { key: '/', icon: <DashboardOutlined />, label: '运营总览' },
  { key: '/orders', icon: <ShoppingOutlined />, label: '订单中心' },
  { key: '/shops', icon: <ShopOutlined />, label: '店铺同步' },
  { key: '/qianniu', icon: <CloudOutlined />, label: '千牛数据' },
  { key: '/reports', icon: <BarChartOutlined />, label: '数据报表' },
];

const adminMenu = [
  { key: '/products', icon: <AppstoreOutlined />, label: '成品库' },
  { key: '/users', icon: <TeamOutlined />, label: '账号权限' },
  { key: '/settings', icon: <SettingOutlined />, label: '系统设置' },
];

const factoryMenu = [
  { key: '/factory', icon: <ToolOutlined />, label: '工厂工作台' },
];

const factoryMobileMenu = [
  { key: '/factory', icon: <ToolOutlined />, label: '工作台' },
  { key: '/profile', icon: <UserOutlined />, label: '我的' },
];

function menuForRole(role) {
  if (role === 'admin') return [...primaryMenu, ...adminMenu];
  if (role === 'factory') return factoryMenu;
  return primaryMenu;
}

const SECURITY_ISSUE_PATTERN = /\u5b89\u5168\u9a8c\u8bc1|\u6ed1\u5757|\u9a8c\u8bc1\u7801|x5sec|verify|captcha|security/i;

const mobileMenu = [
  { key: '/', icon: <DashboardOutlined />, label: '总览' },
  { key: '/orders', icon: <ShoppingOutlined />, label: '订单' },
  { key: '/shops', icon: <ShopOutlined />, label: '店铺' },
  { key: '/reports', icon: <BarChartOutlined />, label: '报表' },
  { key: '/profile', icon: <UserOutlined />, label: '我的' },
];

function currentMenuKey(pathname) {
  if (pathname === '/') return '/';
  const matched = [...primaryMenu, ...adminMenu, ...factoryMenu, { key: '/profile' }]
    .find((item) => pathname.startsWith(item.key) && item.key !== '/');
  return matched?.key || '/';
}

function platformLabel(platform) {
  if (platform === 'taobao') return '\u6dd8\u5b9d';
  if (platform === 'jd') return '\u4eac\u4e1c';
  return platform || '';
}

function shortCollectorId(value) {
  const text = String(value || '').trim();
  return text ? text.slice(-6) : '';
}

const PLACEHOLDER_SHOP_NAME_KEYS = new Set([
  '\u6dd8\u5b9d',
  '\u6dd8\u5b9d\u5e97\u94fa',
  '\u6dd8\u5b9d\u5356\u5bb6\u4e2d\u5fc3',
  '\u5343\u725b',
  '\u5343\u725b\u5de5\u4f5c\u53f0',
  '\u4eac\u4e1c',
  '\u4eac\u4e1c\u5e97\u94fa',
  '\u4eac\u9ea6',
  'jdm\u4eac\u9ea6',
  '\u5546\u5bb6\u540e\u53f0',
  '\u672a\u8bc6\u522b\u5e97\u94fa\u540d',
  'taobao',
  'jd',
  'jdm',
].map((name) => String(name).normalize('NFKC').replace(/\s+/g, '').toLowerCase()));

function meaningfulShopName(value) {
  const text = String(value || '').normalize('NFKC').replace(/\s+/g, ' ').trim();
  const key = text.replace(/\s+/g, '').toLowerCase();
  return text && !PLACEHOLDER_SHOP_NAME_KEYS.has(key) ? text : '';
}

function issueShopLabel(issue) {
  const name = meaningfulShopName(issue?.shop_name);
  const platform = platformLabel(issue?.display_platform || issue?.platform);
  const suffix = [platform, shortCollectorId(issue?.collector_shop_id)].filter(Boolean).join(' \u00b7 ');
  if (name) return suffix ? `${name}\uff08${suffix}\uff09` : name;
  if (suffix) return `\u672a\u8bc6\u522b\u5e97\u94fa\u540d\uff08${suffix}\uff09`;
  return '\u672a\u77e5\u5e97\u94fa';
}

export default function MainLayout({ user, onLogout }) {
  const navigate = useNavigate();
  const location = useLocation();
  const { isMobile } = useResponsive();
  const [collapsed, setCollapsed] = useState(false);
  const menuItems = menuForRole(user?.role);
  const activeMobileMenu = user?.role === 'factory' ? factoryMobileMenu : mobileMenu;
  const selectedKey = currentMenuKey(location.pathname);

  // 角色访问分流：工厂账号只能进工作台与个人中心；其他角色不进工厂工作台
  useEffect(() => {
    const role = user?.role;
    const path = location.pathname;
    if (role === 'factory' && !path.startsWith('/factory') && !path.startsWith('/profile')) {
      navigate('/factory', { replace: true });
    } else if (role && role !== 'factory' && path.startsWith('/factory')) {
      navigate('/', { replace: true });
    }
  }, [user?.role, location.pathname, navigate]);

  const accountMenu = {
    items: [
      { key: 'profile', icon: <UserOutlined />, label: '个人资料', onClick: () => navigate('/profile') },
      { type: 'divider' },
      { key: 'logout', icon: <LogoutOutlined />, label: '退出登录', onClick: onLogout },
    ],
  };

  if (isMobile) {
    return (
      <Layout style={{ minHeight: '100vh', background: '#f6f7f9' }}>
        <Content style={{ padding: 12, paddingBottom: 68 }}>
          <Outlet />
        </Content>
        <nav className="oms-mobile-tabs">
          {activeMobileMenu.map((item) => (
            <button
              key={item.key}
              type="button"
              className={selectedKey === item.key ? 'active' : ''}
              onClick={() => navigate(item.key)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </Layout>
    );
  }

  return (
    <Layout style={{ minHeight: '100vh', background: '#f4f6f8' }}>
      <Sider
        width={236}
        collapsedWidth={72}
        collapsed={collapsed}
        trigger={null}
        style={{
          background: '#111827',
          borderRight: '1px solid #1f2937',
        }}
      >
        <div className="oms-brand">
          <img src="/app-icon.png" alt="" />
          {!collapsed && (
            <div>
              <strong>爱夏天 OMS</strong>
              <span>采集数据中心</span>
            </div>
          )}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selectedKey]}
          items={menuItems}
          onClick={({ key }) => navigate(key)}
          style={{ background: 'transparent', border: 0, padding: '8px 10px' }}
        />
      </Sider>

      <Layout>
        <Header className="oms-header">
          <Space size={12}>
            <Button
              type="text"
              icon={collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
              onClick={() => setCollapsed((value) => !value)}
            />
            <div>
              <Text strong>订单同步管理台</Text>
              <div className="oms-header-subtitle">本地采集，服务器鉴权与数据汇总</div>
            </div>
          </Space>
          <Space size={12}>
            <Tag color="processing">中央数据</Tag>
            <Dropdown menu={accountMenu} placement="bottomRight">
              <Space className="oms-account">
                <Avatar size={32} icon={<UserOutlined />} />
                <span>{user?.nickname || user?.username || '用户'}</span>
              </Space>
            </Dropdown>
          </Space>
        </Header>
        <Content className="oms-content">
          <Outlet />
        </Content>
      </Layout>
    </Layout>
  );
}
