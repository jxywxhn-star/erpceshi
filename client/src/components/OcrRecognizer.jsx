import { useState } from 'react';
import { Upload, Button, Progress, Card, Alert, Input, InputNumber } from 'antd';
import { CameraOutlined, CheckOutlined } from '@ant-design/icons';
import { compressImage } from '../utils/imageCompress';
import { ocrApi } from '../api';
import { useResponsive } from '../hooks/useResponsive';

const FIELD_OPTIONS = [
  { key: 'order_no', label: '订单号' },
  { key: 'product_name', label: '商品名称' },
  { key: 'price', label: '售价' },
  { key: 'cost', label: '成本' },
  { key: 'quantity', label: '数量' },
  { key: 'tracking_no', label: '快递单号' },
];

export default function OcrRecognizer({ onRecognized }) {
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState(0);
  const [preview, setPreview] = useState(null);
  const [error, setError] = useState('');
  const [fieldValues, setFieldValues] = useState(createEmptyFields());
  const { isMobile } = useResponsive();

  function createEmptyFields() {
    return { order_no: '', product_name: '', price: '', cost: '', quantity: '', tracking_no: '' };
  }

  const handleFile = async (file) => {
    setLoading(true);
    setProgress(0);
    setError('');
    setFieldValues(createEmptyFields());

    try {
      setProgress(10);
      const compressed = await compressImage(file, 1200, 0.8);
      setPreview(compressed);
      setProgress(30);
      const result = await ocrApi.analyze({ image: compressed });
      setProgress(100);

      const fields = createEmptyFields();
      if (result.order_no) fields.order_no = result.order_no;
      if (result.product_name) fields.product_name = result.product_name;
      if (result.price) fields.price = result.price;
      if (result.cost) fields.cost = result.cost;
      if (result.quantity) fields.quantity = result.quantity;
      if (result.tracking_no) fields.tracking_no = result.tracking_no;
      setFieldValues(fields);
    } catch (err) {
      setError('识别失败：' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleFieldChange = (fieldKey, value) => {
    setFieldValues((prev) => ({ ...prev, [fieldKey]: value }));
  };

  const handleApply = () => {
    if (onRecognized) {
      const result = {};
      Object.entries(fieldValues).forEach(([k, v]) => {
        if (v !== '' && v !== null && v !== undefined) result[k] = v;
      });
      onRecognized(result);
      handleReset();
    }
  };

  const handleReset = () => {
    setPreview(null);
    setError('');
    setProgress(0);
    setFieldValues(createEmptyFields());
  };

  const assignedFields = new Set(
    Object.entries(fieldValues).filter(([, v]) => v !== '' && v !== null && v !== undefined).map(([k]) => k)
  );
  const hasAnyValue = assignedFields.size > 0;

  return (
    <div tabIndex={0} onPaste={(e) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault();
          handleFile(item.getAsFile());
          break;
        }
      }
    }} style={{ outline: 'none' }}>
      <Card size="small" style={{ marginBottom: 16 }}>
        {!hasAnyValue && !loading && !error && (
          <div>
            <Upload accept="image/*" showUploadList={false} onChange={(info) => {
              const file = info.file.originFileObj || info.file;
              if (file) handleFile(file);
              return false;
            }} beforeUpload={() => false}>
              <Button icon={<CameraOutlined />} style={{ marginRight: 8 }}>
                上传截图（AI识别）
              </Button>
            </Upload>
            <span style={{ color: '#999', fontSize: 12 }}>也可以 Ctrl+V 粘贴截图</span>
          </div>
        )}

        {loading && (
          <div style={{ marginTop: 8 }}>
            <Progress percent={progress} size="small" />
            <span style={{ color: '#999' }}>
              {progress < 30 ? '正在压缩图片...'
                : progress < 60 ? '正在调用通义千问AI...'
                : progress < 100 ? '等待AI响应...'
                : '识别完成'}
              {' '}{progress}%
            </span>
          </div>
        )}

        {error && <Alert type="error" message={error} style={{ marginTop: 8 }} />}

        {hasAnyValue && (
          <div>
            <Alert
              message="AI已识别完成，请核对下方信息"
              type="success"
              description="通义千问视觉模型识别完成，确认无误后点击「填入表单」"
              style={{ marginBottom: 12 }}
              showIcon
            />

            {preview && (
              <div style={{ marginBottom: 8 }}>
                <img src={preview} alt="" style={{
                  maxWidth: '100%', maxHeight: isMobile ? 100 : 140,
                  borderRadius: 4, border: '1px solid #f0f0f0',
                }} />
              </div>
            )}

            <div style={{ marginTop: 12 }}>
              <span style={{ fontWeight: 'bold', fontSize: 13 }}>识别结果（可手动修改）：</span>
              <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', gap: '8px 16px', marginTop: 8 }}>
                {FIELD_OPTIONS.map((f) => (
                  <div key={f.key}>
                    <label style={{ fontSize: 12, color: '#666', display: 'block', marginBottom: 2 }}>
                      {f.label} {assignedFields.has(f.key) && <CheckOutlined style={{ color: '#52c41a' }} />}
                    </label>
                    {(f.key === 'price' || f.key === 'cost') ? (
                      <InputNumber size="small" value={fieldValues[f.key] || undefined}
                        onChange={(v) => handleFieldChange(f.key, v)}
                        min={0} precision={2} prefix="¥" style={{ width: '100%' }}
                        placeholder="未识别到" />
                    ) : f.key === 'quantity' ? (
                      <InputNumber size="small" value={fieldValues[f.key] || undefined}
                        onChange={(v) => handleFieldChange(f.key, v)}
                        min={1} style={{ width: '100%' }} placeholder="未识别到" />
                    ) : (
                      <Input size="small" value={fieldValues[f.key]}
                        onChange={(e) => handleFieldChange(f.key, e.target.value)}
                        placeholder="未识别到" />
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div style={{ marginTop: 12, display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <Button size="small" onClick={handleReset}>重新识别</Button>
              <Button type="primary" size="small" onClick={handleApply} disabled={!hasAnyValue}>
                填入表单
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
