# Immersive Translate

沉浸式翻译 Chrome 插件，浏览器内直接调用 DeepSeek Flash 模型，无需本地依赖。

## 安装

### 1. 加载扩展

打开 `chrome://extensions` → 开启「开发者模式」→ 「加载已解压的扩展程序」→ 选择 `extension/` 目录。

### 2. 配置 API Key

点击扩展图标 → 「设置 API Key」→ 填入 DeepSeek API Key（sk-...）。

> API Key 存储在 Chrome 本地，仅用于调用 DeepSeek 翻译接口。

### 3. 使用

打开任意英文网页，自动检测并翻译为中文。右上角显示翻译进度。

- **自动翻译**：英文页面自动翻译，无需操作
- **手动翻译**：点击扩展图标 → 选择语言 → 点「翻译页面」
- **恢复原文**：点击扩展图标 → 点「恢复原文」

## 架构

```
extension/
├── content.js      页面注入脚本，文本节点级提取和替换
├── background.js   Service Worker，浏览器内直接调 DeepSeek API
├── popup.html/js   弹窗 UI（语言选择、API Key 配置、翻译控制）
```

**数据流**：页面文本节点 → content.js 提取 → background.js 10 路并行调 DeepSeek Flash API → 译文逐节点替换。链接、按钮等元素完整保留。

## 技术要点

- 文本节点级别翻译，保护 DOM 结构
- 代码块、输入框自动跳过
- `<a>` 链接文字翻译且保留链接
- `Promise.all` 并行 10 路 API 调用，100+ 句约 4 秒
- 关闭 thinking 模式，大幅提速
