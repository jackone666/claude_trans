# Immersive Translate

沉浸式翻译 Chrome 插件，使用 DeepSeek Flash 模型自动将英文网页翻译为中文。

## 安装

### 1. 加载扩展

打开 `chrome://extensions` → 开启「开发者模式」→ 「加载已解压的扩展程序」→ 选择 `extension/` 目录 → 复制扩展 ID。

### 2. 安装 Native Host

```bash
cd native-host
./install.sh <扩展ID>
```

### 3. 重启 Chrome

完全退出 Chrome（Cmd+Q）后重新打开，`chrome://extensions` 刷新扩展。

## 使用

打开任意英文网页，右上角显示「翻译中 (N 段)...」→ 几秒后自动翻译完成。

- **自动翻译**：检测到英文页面自动翻译为中文，无需任何操作
- **手动翻译**：点击扩展图标 → 选择目标语言 → 点「翻译页面」
- **恢复原文**：点击扩展图标 → 点「恢复原文」

## 架构

```
extension/          Chrome 扩展 (Manifest V3)
├── content.js      页面注入脚本，提取文本节点并替换翻译
├── background.js   Service Worker，桥接 native host
├── popup.html/js   弹窗 UI（语言选择、手动翻译、恢复）

native-host/
├── translate.py    Python 原生消息主机，调用 DeepSeek API
├── install.sh      安装脚本
```

**数据流**：页面文本节点 → content.js 提取 → background.js 转发 → translate.py 并行调用 DeepSeek Flash API → 译文逐节点替换回页面。

**翻译策略**：文本节点级别翻译，保持链接、按钮等元素完整。代码块、输入框等自动跳过。

## 依赖

- Python 3
- Chrome 浏览器
- DeepSeek API 密钥（配置在 `~/.claude/settings.json`）
