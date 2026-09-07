---
name: frontend-screenshot-mock
description: 前端项目真实截图采集与 Mock 数据注入标准流程。当需要为软著材料、产品文档或演示目的采集前端运行截图时使用。
version: 1.0.0
author: desirecore
tags: [screenshot, playwright, mock, frontend, 软著]
triggers:
  - 截图
  - 软著配图
  - 真实运行截图
  - mock 数据
  - Playwright 截图
---

# 前端截图 + Mock 数据标准流程

## L0

用 Playwright 对运行中的前端进行真实截图，通过 axios interceptor 注入 mock 数据确保无报错，通过 addInitScript 注入 token 绕过登录。

## L1 执行步骤

### 第一步：注入 Mock 数据拦截器

在 `client/src/services/api.ts` 的 axios 响应错误拦截器中，当检测到网络错误时返回预置 mock 数据而非弹出错误 toast：

```typescript
// 在 response error interceptor 中添加 mock 降级
const MOCK_ENABLED = !window.__BACKEND_AVAILABLE__;

http.interceptors.response.use(
  (response) => { /* 正常处理 */ },
  (error: AxiosError) => {
    if (MOCK_ENABLED && !error.response) {
      // 根据 URL 返回对应 mock 数据
      const mockData = getMockData(error.config?.url);
      if (mockData) {
        return Promise.resolve({ data: { code: 0, data: mockData, message: 'ok' } });
      }
    }
    // 原有错误处理...
  }
);
```

### 第二步：启动 Dev Server

```bash
cd client
npx vite --port 5173 &
# 等待启动完成
sleep 3
curl -s http://localhost:5173 > /dev/null && echo "Server ready"
```

### 第三步：Playwright 截图脚本

```javascript
import { chromium } from 'playwright';
import path from 'path';
import fs from 'fs';

const BASE = 'http://localhost:5173';
const OUT = path.resolve('../docs/screenshots');

// 页面清单（根据实际路由调整）
const pages = [
  { name: '01-login', path: '/login', noAuth: true },
  { name: '02-dashboard', path: '/' },
  { name: '03-customer-list', path: '/customers' },
  // ... 根据项目路由补充
];

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch({ headless: true });

  // 带认证的 context
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => {
    localStorage.setItem('crm_token', 'mock-jwt-token-for-screenshots');
  });
  const page = await ctx.newPage();

  // 无认证的 context（用于登录页截图）
  const ctxNoAuth = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const loginPage = await ctxNoAuth.newPage();

  for (const p of pages) {
    try {
      const target = p.noAuth ? loginPage : page;
      await target.goto(`${BASE}${p.path}`, { waitUntil: 'networkidle', timeout: 15000 });
      await target.waitForTimeout(2000); // 等待动画和数据渲染
      const file = path.join(OUT, `${p.name}.png`);
      await target.screenshot({ path: file, fullPage: false });
      const size = fs.statSync(file).size;
      console.log(`✅ ${p.name}.png (${(size/1024).toFixed(0)}KB)`);
    } catch (e) {
      console.log(`❌ ${p.name}: ${e.message.split('\n')[0]}`);
    }
  }

  await browser.close();

  // 验证：检查文件大小是否各不相同
  const files = fs.readdirSync(OUT).filter(f => f.endsWith('.png'));
  const sizes = files.map(f => fs.statSync(path.join(OUT, f)).size);
  const uniqueSizes = new Set(sizes);
  if (uniqueSizes.size < files.length * 0.7) {
    console.log('⚠️ 警告：多个截图大小相同，可能 token 未生效！');
  }
})();
```

### 第四步：执行

```bash
cd client
NODE_PATH=./node_modules /Users/yige/.volta/tools/image/node/24.18.0/bin/node ../screenshot.mjs
```

### 第五步：验证

```bash
# 1. 文件数量
ls docs/screenshots/*.png | wc -l

# 2. 文件大小各不相同（相同=失败）
ls -lh docs/screenshots/*.png

# 3. 抽查一张确认无错误 toast
# （用 Read 工具查看 PNG 文件）
```

## L2 问题排查表

| 症状 | 原因 | 解决 |
|------|------|------|
| 所有截图大小完全相同 | token 未注入，全跳登录页 | 用 `addInitScript` 而非 `evaluate` |
| ERR_CONNECTION_REFUSED | dev server 崩溃 | `npx vite --port 5173 &` 重启 |
| Cannot find module 'playwright' | 路径问题 | 在 client 目录执行 + NODE_PATH |
| 截图有红色错误 toast | mock 未覆盖该 API | 在 getMockData 中补充该路径 |
| 截图内容空白 | 页面未渲染完 | 增加 waitForTimeout 到 3000ms |
| Canvas 工具报错 | 环境不支持 | 不用 canvas，只用 Playwright |

## 子操作截图（弹窗/表单/详情）

对需要打开弹窗或跳转详情页的截图：

```javascript
// 示例：截取"新增客户"弹窗
await page.goto(`${BASE}/customers`, { waitUntil: 'networkidle' });
await page.waitForTimeout(1000);
await page.click('button:has-text("新增客户")'); // 点击按钮打开弹窗
await page.waitForTimeout(1000); // 等弹窗动画
await page.screenshot({ path: 'docs/screenshots/11-customer-create-modal.png' });
```

## 环境常量

- Node: `/Users/yige/.volta/tools/image/node/24.18.0/bin/node`
- Playwright: `client/node_modules/.bin/playwright`（需先 `npm install`）
- Token key: `crm_token`
- Dev server port: `5173`
- 截图分辨率: `1440×900`
