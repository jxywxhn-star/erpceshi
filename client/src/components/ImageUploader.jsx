import { Upload } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { uploadApi } from '../api';

// 高清优先：读原图为 dataURL，不压缩
function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error('文件读取失败'));
    reader.readAsDataURL(file);
  });
}

export function urlsToFileList(urls) {
  return (urls || []).map((url, idx) => ({ uid: `saved-${idx}-${url}`, name: `图片${idx + 1}`, status: 'done', url }));
}

export function fileListToUrls(fileList) {
  return (fileList || [])
    .filter((f) => f.status === 'done')
    .map((f) => f.url || f.response?.url)
    .filter(Boolean);
}

export default function ImageUploader({ fileList, onChange }) {
  const customRequest = async ({ file, onSuccess, onError }) => {
    try {
      const dataUrl = await fileToDataUrl(file);
      const res = await uploadApi.image(dataUrl);
      onSuccess(res, file);
    } catch (err) {
      onError(err);
    }
  };

  const onPreview = (file) => {
    const url = file.url || file.response?.url;
    if (url) window.open(url, '_blank', 'noopener');
  };

  return (
    <Upload
      listType="picture-card"
      fileList={fileList}
      accept="image/*"
      multiple
      customRequest={customRequest}
      onChange={({ fileList: fl }) => onChange(fl)}
      onPreview={onPreview}
    >
      <div>
        <PlusOutlined />
        <div style={{ marginTop: 4 }}>上传</div>
      </div>
    </Upload>
  );
}
