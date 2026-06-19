import axios from 'axios';
import { message } from 'antd';

function getDesktopLocalApiBase() {
  if (typeof window === 'undefined') return '';
  const injected = window.__AIXIATIAN_LOCAL_API_BASE__;
  if (typeof injected === 'string' && /^https?:\/\/(127\.0\.0\.1|localhost):\d+\/api\/?$/.test(injected)) {
    return injected.replace(/\/+$/, '');
  }

  const stored = window.localStorage?.getItem('aixiatian_local_api_base');
  if (typeof stored === 'string' && /^https?:\/\/(127\.0\.0\.1|localhost):\d+\/api\/?$/.test(stored)) {
    return stored.replace(/\/+$/, '');
  }

  return '';
}

function attachCommonInterceptors(instance) {
  instance.interceptors.request.use((config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  });

  instance.interceptors.response.use(
    (response) => response.data,
    (error) => {
      const msg = error.response?.data?.message || '请求失败';
      message.error(msg);
      if (error.response?.status === 401) {
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login';
      }
      return Promise.reject(error);
    }
  );
}

function createRequest(baseURL = '/api') {
  const instance = axios.create({
    baseURL,
    timeout: 60000,
  });
  attachCommonInterceptors(instance);
  return instance;
}

const request = createRequest('/api');

export const collectorRequest = createRequest('/api');
collectorRequest.interceptors.request.use((config) => {
  const localApiBase = getDesktopLocalApiBase();
  if (localApiBase) {
    config.baseURL = localApiBase;
  }
  return config;
});

export default request;
