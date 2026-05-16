# XSpamShield

XSpamShield 是一个面向 X / Twitter 场景的中文 Spam 回复识别与屏蔽项目。

它的重点不是通用英文垃圾内容治理，而是针对中文、拼音、夹杂符号、谐音变体、混淆字符这类更常见于中文 Spam 回复的文本形态，提供识别、折叠、拉黑、复核、导出与再训练的完整闭环。

## 主要功能

- 中文 Spam 回复识别：重点处理中文及其变体表达，包括拼音化、混淆字符、插入符号等常见绕过写法。
- 页面内折叠与屏蔽：在 X 回复区自动折叠疑似 Spam，支持展开查看和手动改标。
- 后台拉黑队列：当同一账号累计达到阈值后，进入延迟执行的后台拉黑队列，降低接口风控风险。
- Popup 管理面板：提供主页、拉黑队列、操作日志三类视图，便于本地审查和操作追踪。
- 数据闭环：支持本地导出标注数据，重新训练模型，再导出回浏览器扩展使用。

## 项目结构

- `extension/`：Manifest V3 浏览器扩展，负责页面识别、折叠、popup 管理与后台队列。
- `ml/`：Python 训练与导出流水线，负责数据处理、训练、评估、ONNX/TF.js 导出。
- `scripts/`：跨项目辅助脚本，例如将最新 TF.js 模型复制到扩展目录。
- `artifacts/`：示例数据与中间产物。

## 快速开始

### 1. 构建扩展

```bash
pnpm --dir extension install
pnpm --dir extension build
```

构建完成后，将 `extension/dist` 作为已解压扩展加载到浏览器。

### 2. 安装 ML 环境

```bash
cd ml
uv sync
```

### 3. 一键训练、评估、转码、导出

```bash
cd ml
uv run train-eval-export
```

常用拆分命令：

- `uv run train-eval`：仅执行训练与评估。
- `uv run export-deploy`：仅执行导出、转码与模型同步。

## 适用场景

- 需要在 X / Twitter 页面中快速识别并折叠中文 Spam 回复。
- 需要持续收集、复核、导出中文 Spam 样本，并迭代训练模型。
- 需要对高频 Spam 账号进行更稳妥的延迟拉黑与日志追踪。

## 开源项目引用与致谢

本项目建立在许多优秀开源项目之上，感谢它们的作者与维护者：

- [TensorFlow.js](https://www.tensorflow.org/js)：用于浏览器侧模型加载与在线推理。
- [PyTorch](https://pytorch.org/)：用于中文 Spam 分类模型训练。
- [ONNX](https://onnx.ai/) 与 [ONNX Runtime](https://onnxruntime.ai/)：用于模型导出、中间格式转换与结果对比验证。
- [onnx2tf](https://github.com/PINTO0309/onnx2tf)：用于 ONNX 到 TensorFlow / TF.js 链路转换。
- [pinyin-pro](https://github.com/zh-lx/pinyin-pro)：用于中文转拼音与相关文本处理。
- [idb](https://github.com/jakearchibald/idb)：用于 IndexedDB 的更简洁封装。
- [Vite](https://vite.dev/)：用于扩展端构建与开发工作流。

## 免责声明

本项目仅用于中文垃圾回复识别、治理研究与个人效率提升，不隶属于 X / Twitter 官方。

## 开源协议

本项目采用 [MIT License](LICENSE) 开源。
