import { Router } from 'express';
import { getDb } from '../db/init.js';
import { authMiddleware } from '../middleware/auth.js';
import { z } from 'zod';

const router = Router();

router.use(authMiddleware);

const OrderOcrSchema = z.object({
  order_no: z.string().describe('订单号，如淘宝19位纯数字订单编号'),
  product_name: z.string().describe('完整的商品标题，包含规格属性'),
  price: z.number().describe('买家实付金额，取右侧最大加粗的总额数字'),
  cost: z.number().nullable().default(null).describe('商品单价或成本价，通常左侧较小的价格数字'),
  quantity: z.number().default(1).describe('购买数量'),
  tracking_no: z.string().default('').describe('快递单号，如果有的话'),
});

const SYSTEM_PROMPT = `你是一个精通国内电商后台的专业数据清洗专家。
请仔细阅读用户上传的订单截图，提取以下字段：

【提取规则】：
1. order_no: 寻找"订单号"或长串纯数字（通常16-19位）
2. product_name: 提取完整的商品标题，包含规格属性，严禁截断
3. price: 【核心防错】忽略左侧较小的商品单价，精准提取右侧字号最大、加粗的买家最终实付总额
4. cost: 商品单价或成本价，通常是左侧较小的价格数字，没有则填null
5. quantity: 购买数量
6. tracking_no: 快递/物流单号，没有则填空字符串

【格式要求】：
- price和cost必须是纯数字类型，禁止带¥符号或引号
- order_no必须是纯数字不带空格
- 所有文本字段去除首尾空格`;

router.post('/analyze', async (req, res) => {
  console.log('[OCR] analyze request received');
  try {
    const { image } = req.body;

    const db = getDb();

    const apiKey = db.prepare("SELECT value FROM settings WHERE key = 'ocr_api_key'").get()?.value;
    const modelName = db.prepare("SELECT value FROM settings WHERE key = 'ocr_model'").get()?.value || 'qwen-vl-ocr';
    const baseUrl = db.prepare("SELECT value FROM settings WHERE key = 'ocr_base_url'").get()?.value || 'https://dashscope.aliyuncs.com/compatible-mode/v1';

    if (!apiKey) {
      return res.status(400).json({ message: '请先在系统设置中配置百炼API Key', needConfig: true });
    }

    if (!image || typeof image !== 'string') {
      return res.status(400).json({ message: '请提供图片数据' });
    }

    const base64Image = image.replace(/^data:image\/\w+;base64,/, '');

    const endpoint = `${baseUrl}/chat/completions`;
    console.log('[OCR] calling:', endpoint, 'model:', modelName);

    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: modelName,
        temperature: 0.1,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:image/png;base64,${base64Image}` } },
              { type: 'text', text: SYSTEM_PROMPT },
            ],
          },
        ],
      }),
    });

    const resultText = await response.text();
    console.log('[OCR] API status:', response.status);

    if (!response.ok) {
      console.error('[OCR] API error response:', resultText.substring(0, 500));
      let errMsg = `API调用失败(${response.status})`;
      try {
        const errJson = JSON.parse(resultText);
        errMsg = errJson.error?.message || errJson.message || errMsg;
      } catch {}
      return res.status(500).json({ message: '识别失败：' + errMsg });
    }

    let result;
    try {
      result = JSON.parse(resultText);
    } catch {
      return res.status(500).json({ message: 'API返回内容无法解析', raw: resultText.substring(0, 200) });
    }

    const usage = result.usage;
    if (usage) {
      try {
        db.prepare(
          'INSERT INTO token_usage (model, prompt_tokens, completion_tokens, total_tokens, user_id) VALUES (?, ?, ?, ?, ?)'
        ).run(modelName, usage.prompt_tokens || 0, usage.completion_tokens || 0, usage.total_tokens || 0, req.user.id);
      } catch (e) {
        console.error('[OCR] save token usage error:', e.message);
      }
    }

    const content = result.choices?.[0]?.message?.content;
    if (!content) {
      return res.status(500).json({ message: 'AI未返回有效数据' });
    }

    console.log('[OCR] AI response:', content.substring(0, 300));

    let rawData;
    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      rawData = JSON.parse(jsonMatch ? jsonMatch[0] : content);
    } catch {
      return res.status(500).json({ message: 'AI返回内容无法解析为JSON', raw: content.substring(0, 200) });
    }

    if (rawData.price != null) rawData.price = Number(rawData.price) || 0;
    if (rawData.cost != null && rawData.cost !== 'null' && rawData.cost !== '') rawData.cost = Number(rawData.cost) || 0;
    else rawData.cost = null;
    if (rawData.quantity != null) rawData.quantity = Number(rawData.quantity) || 1;

    const parsed = OrderOcrSchema.safeParse(rawData);
    if (!parsed.success) {
      return res.status(500).json({
        message: 'AI返回数据格式校验失败',
        errors: parsed.error.issues.map((i) => `[${i.path.join('.')}] ${i.message}`),
        raw: rawData,
      });
    }

    const data = parsed.data;

    if (data.order_no) {
      data.order_no = data.order_no.replace(/\s+/g, '').replace(/[^0-9]/g, '');
    }

    res.json({
      order_no: data.order_no || '',
      product_name: data.product_name || '',
      price: data.price || 0,
      cost: data.cost || 0,
      quantity: data.quantity || 1,
      tracking_no: data.tracking_no || '',
    });
  } catch (err) {
    console.error('[OCR] analyze error:', err);
    res.status(500).json({ message: '识别失败：' + (err.message || '未知错误') });
  }
});

export default router;
