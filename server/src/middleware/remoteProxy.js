export function normalizeRemoteBaseUrl(value) {
  const url = String(value || '').trim().replace(/\/+$/, '');
  return url || '';
}

export function createRemoteProxyMiddleware(remoteBaseUrl) {
  const baseUrl = normalizeRemoteBaseUrl(remoteBaseUrl);
  if (!baseUrl) {
    throw new Error('remoteBaseUrl is required');
  }

  return async function remoteProxy(req, res) {
    const targetUrl = `${baseUrl}${req.originalUrl}`;
    const headers = { ...req.headers };
    delete headers.host;
    delete headers['content-length'];

    let body;
    if (!['GET', 'HEAD'].includes(req.method.toUpperCase())) {
      body = req.body === undefined ? undefined : JSON.stringify(req.body);
      headers['content-type'] = headers['content-type'] || 'application/json';
    }

    try {
      const response = await fetch(targetUrl, {
        method: req.method,
        headers,
        body,
      });

      const contentType = response.headers.get('content-type');
      if (contentType) res.setHeader('content-type', contentType);

      const text = await response.text();
      res.status(response.status).send(text);
    } catch (err) {
      res.status(502).json({
        message: '无法连接远程 ERP 服务器',
        remote_base_url: baseUrl,
        detail: err.message,
      });
    }
  };
}
