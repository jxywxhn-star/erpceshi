import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Modal,
  Popconfirm,
  Select,
  Space,
  Table,
  Tag,
  Typography,
  message,
} from 'antd';
import { CheckCircleOutlined, CloudUploadOutlined, DeleteOutlined, EyeOutlined, ReloadOutlined } from '@ant-design/icons';
import { collectorApi } from '../../api';
import { useResponsive } from '../../hooks/useResponsive';

const { Text } = Typography;

const LEVEL_MAP = {
  error: { text: '错误', color: 'red' },
  warning: { text: '警告', color: 'orange' },
  info: { text: '信息', color: 'blue' },
};

const LOCAL_TIME_ZONE = Intl.DateTimeFormat().resolvedOptions().timeZone || 'Asia/Shanghai';
const SERVER_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?$/;

function parseServerTime(value) {
  if (!value) return null;
  const text = String(value).trim();
  const normalized = text.replace(' ', 'T');
  return new Date(SERVER_TIMESTAMP_PATTERN.test(normalized) ? `${normalized}Z` : normalized);
}

function formatTime(value) {
  if (!value) return '-';
  const date = parseServerTime(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: LOCAL_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date).replace(/\//g, '-');
}

function prettyDetails(value) {
  if (!value) return '';
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return String(value);
  }
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

function issueShopLabel(record) {
  const name = meaningfulShopName(record?.shop_name);
  const platform = platformLabel(record?.display_platform || record?.platform);
  const suffix = [platform, shortCollectorId(record?.collector_shop_id)].filter(Boolean).join(' \u00b7 ');
  if (name) return suffix ? `${name}\uff08${suffix}\uff09` : name;
  if (suffix) return `\u5e97\u94fa\uff08${suffix}\uff09`;
  return '-';
}

export default function CollectorIssues() {
  const [issues, setIssues] = useState([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [uploadingLogs, setUploadingLogs] = useState(false);
  const [resolved, setResolved] = useState('0');
  const [level, setLevel] = useState('');
  const [detail, setDetail] = useState(null);
  const { isMobile } = useResponsive();

  const fetchIssues = async (nextPage = page) => {
    setLoading(true);
    try {
      const res = await collectorApi.issues({
        page: nextPage,
        pageSize: isMobile ? 10 : 20,
        resolved,
        level: level || undefined,
      });
      setIssues(res.list || []);
      setTotal(res.total || 0);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchIssues(1);
    setPage(1);
  }, [resolved, level, isMobile]);

  const resolveIssue = async (id) => {
    await collectorApi.resolveIssue(id);
    message.success('已标记处理');
    fetchIssues();
  };

  const deleteIssue = async (id) => {
    await collectorApi.deleteIssue(id);
    message.success('已删除');
    fetchIssues();
  };

  const uploadLogs = async () => {
    setUploadingLogs(true);
    try {
      const res = await collectorApi.uploadLogs();
      if (res?.ok) {
        message.success(`日志已上传：${res.files || 0} 个文件`);
        fetchIssues(1);
        setPage(1);
      } else {
        message.warning(res?.message || res?.error || '日志上传未完成');
      }
    } finally {
      setUploadingLogs(false);
    }
  };

  const columns = [
    {
      title: '级别',
      dataIndex: 'level',
      key: 'level',
      width: 90,
      render: (value) => {
        const item = LEVEL_MAP[value] || LEVEL_MAP.error;
        return <Tag color={item.color}>{item.text}</Tag>;
      },
    },
    {
      title: '问题',
      key: 'issue',
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <Text strong>{record.title || '采集异常'}</Text>
          <Text type="secondary" ellipsis style={{ maxWidth: 520 }}>{record.message || '-'}</Text>
        </Space>
      ),
    },
    {
      title: '店铺',
      key: 'shop',
      width: 190,
      render: (_, record) => (
        <Space direction="vertical" size={0}>
          <span>{issueShopLabel(record)}</span>
          <Text type="secondary" style={{ fontSize: 12 }}>{record.collector_shop_id || '-'}</Text>
        </Space>
      ),
    },
    { title: '来源', dataIndex: 'source', key: 'source', width: 150 },
    {
      title: '状态',
      dataIndex: 'resolved',
      key: 'resolved',
      width: 90,
      render: (value) => (value ? <Tag color="green">已处理</Tag> : <Tag color="red">待处理</Tag>),
    },
    { title: '时间', dataIndex: 'created_at', key: 'created_at', width: 170, render: formatTime },
    {
      title: '操作',
      key: 'action',
      width: 210,
      render: (_, record) => (
        <Space wrap size={4}>
          <Button size="small" icon={<EyeOutlined />} onClick={() => setDetail(record)}>详情</Button>
          {!record.resolved && (
            <Button size="small" icon={<CheckCircleOutlined />} onClick={() => resolveIssue(record.id)}>标记处理</Button>
          )}
          <Popconfirm title="确定删除这条诊断记录？" onConfirm={() => deleteIssue(record.id)}>
            <Button size="small" danger icon={<DeleteOutlined />} />
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <Space direction="vertical" size={16} style={{ width: '100%' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <Button icon={<CloudUploadOutlined />} loading={uploadingLogs} onClick={uploadLogs}>上传本机日志</Button>
        <div>
          <h3 style={{ margin: 0 }}>采集诊断</h3>
          <Text type="secondary">只对管理员显示，用于查看本地采集端同步失败、安全验证、接口异常等问题</Text>
        </div>
        <Button icon={<ReloadOutlined />} loading={loading} onClick={() => fetchIssues()}>刷新</Button>
      </div>

      <Card size="small">
        <Space wrap>
          <Select
            value={resolved}
            style={{ width: 130 }}
            options={[
              { value: '0', label: '待处理' },
              { value: '1', label: '已处理' },
              { value: 'all', label: '全部' },
            ]}
            onChange={setResolved}
          />
          <Select
            allowClear
            placeholder="级别"
            value={level || undefined}
            style={{ width: 130 }}
            options={[
              { value: 'error', label: '错误' },
              { value: 'warning', label: '警告' },
              { value: 'info', label: '信息' },
            ]}
            onChange={(value) => setLevel(value || '')}
          />
        </Space>
      </Card>

      <Table
        columns={columns}
        dataSource={issues}
        rowKey="id"
        loading={loading}
        size="small"
        scroll={{ x: 1100 }}
        pagination={{
          current: page,
          total,
          pageSize: isMobile ? 10 : 20,
          onChange: (next) => {
            setPage(next);
            fetchIssues(next);
          },
          showTotal: (value) => `共 ${value} 条`,
        }}
      />

      <Modal
        title="采集诊断详情"
        open={Boolean(detail)}
        onCancel={() => setDetail(null)}
        footer={null}
        width={isMobile ? '95%' : 820}
      >
        {detail && (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <div><Text strong>标题：</Text>{detail.title}</div>
            <div><Text strong>信息：</Text>{detail.message || '-'}</div>
            <div><Text strong>店铺：</Text>{issueShopLabel(detail)}</div>
            <div><Text strong>时间：</Text>{formatTime(detail.created_at)}</div>
            <pre style={{ maxHeight: 460, overflow: 'auto', background: '#111827', color: '#e5e7eb', padding: 12, borderRadius: 6 }}>
              {prettyDetails(detail.details)}
            </pre>
          </Space>
        )}
      </Modal>
    </Space>
  );
}
