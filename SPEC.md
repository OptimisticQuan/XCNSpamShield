# 🚀 Twitter Spam 拦截与数据标注插件技术规格书 (Spec)

## 1. 产品概述

本插件是一款专为 Twitter (X) 环境设计的反垃圾回复工具。它采用“启发式规则 + Pinyin-Level TextCNN”双引擎进行实时拦截。同时，它也是一个轻量级的数据标注平台，允许用户在浏览网页时一键提取帖子数据、手动标注漏网之鱼，并导出为标准化 JSON 供 PyTorch 模型持续迭代训练。

## 2. 核心功能模块 (Features)

* **全局拦截控制**：插件 Popup 面板内设有一键开关，用户可自由在“静默采集模式”和“主动拦截模式”间切换。
* **当前视口提取**：手动触发后，抓取当前页面已加载的**主帖**及**首级回复**（忽略多层级楼中楼）。
* **网页端快捷标注**：在原生推文操作栏注入“标记 Spam / 撤销标记”按钮。
* **沉浸式拦截体验**：被判定为 Spam 的回复将被折叠隐藏，仅保留轻量提示，支持点击展开。
* **本地数据管理 (Popup)**：支持在弹窗内预览采集的数据列表，提供删除单条、切换标签、以及一键导出 JSON 功能。

---

## 3. UI/UX 与交互设计

### 3.1 网页端注入 (Content Script)

* **折叠态展现**：当匹配为 Spam（无论是由于正则还是模型预测），该条回复的 DOM 高度将压缩，透明度降低，替换为灰色提示条 `[🚫 已被插件折叠，点击查看原文]`。
* **操作栏按钮**：在每条回复底部的原生操作栏（点赞、转推旁）注入一个 🛡️ 按钮。
* 默认状态：`屏蔽/标记 Spam`
* 已标记状态：`撤销屏蔽` (变为绿色)



### 3.2 插件弹窗 (Popup UI)

* **顶部区域**：
* 拦截引擎总开关 (Toggle)。
* “📥 提取当前页面数据”主按钮。


* **中间数据管理区 (List View)**：
* 以精简列表展示 IndexedDB 中的数据（显示截断的回复文本、Label 状态）。
* 提供批量操作：清空本地库。
* 提供单条操作：🗑️ 删除、🔄 切换 Spam/Ham 状态。


* **底部区域**：
* “💾 导出为训练集 (JSON)”按钮。



---

## 4. 数据结构与存储 (IndexedDB)

考虑到可能积累数千条训练数据，采用浏览器的 `IndexedDB`（通过 `idb` 库进行 Promise 封装）进行持久化存储。

**导出的 JSON Schema 设计：**

```json
{
  "export_time": 1715840000000,
  "total_records": 150,
  "data": [
    {
      "thread_id": "1789543210000",
      "main_post": {
        "author": "userA",
        "text": "这只猫好乖。",
        "timestamp": 1715830000000
      },
      "replies": [
        {
          "reply_id": "1789543210123",
          "author": "bot_user",
          "original_text": "主页能打✈️ @aybek98",
          "cleaned_pinyin": "zhu ye neng da ✈️ @ a y b e k 9 8",
          "label": 1, 
          "source": "auto", 
          "extract_time": 1715835000000
        },
        {
          "reply_id": "1789543210124",
          "author": "real_user",
          "original_text": "很可爱的猫咪",
          "cleaned_pinyin": "hen ke ai de mao mi",
          "label": 0,
          "source": "manual", 
          "extract_time": 1715835000000
        }
      ]
    }
  ]
}

```

*(注：`source` 字段指明该标签是由模型自动预测 `auto` 还是用户手动标记 `manual`，以便在训练时给予不同权重。)*

---

## 5. 机器学习流水线 (PyTorch -> TF.js)

针对你提出的对抗性变体（拼音替换、同音字），我们采用“全拼音化 + 字符级 Tokenization”策略。

### 5.1 步骤一：数据预处理与分词 (Tokenization)

1. **拼接上下文**：将主帖和回复合并，格式为 `[CLS] 主贴拼音序列 [SEP] 回复拼音序列`。
2. **拼音与字符拆解**：
* 将汉字转化为全拼音（如：`猫` -> `mao`）。
* 将英文字母拆分为单个字符（如：`sao` -> `s`, `a`, `o`）。
* 保留 Emoji 和标点符号作为独立 Token。


3. **字典映射**：生成 `vocab.txt`，将上述拆解的元素映射为整数 ID，统一 Padding 至固定长度（如 100）。

### 5.2 步骤二：PyTorch 模型结构与训练

采用 PyTorch 构建多通道 TextCNN。

```python
import torch
import torch.nn as nn
import torch.nn.functional as F

class PinyinTextCNN(nn.Module):
    def __init__(self, vocab_size, embedding_dim=64, num_filters=32):
        super(PinyinTextCNN, self).__init__()
        # 1. 词嵌入层
        self.embedding = nn.Embedding(vocab_size, embedding_dim)
        
        # 2. 三个不同视野的卷积核 (对应 N-gram = 2, 3, 4)
        self.conv2 = nn.Conv1d(in_channels=embedding_dim, out_channels=num_filters, kernel_size=2)
        self.conv3 = nn.Conv1d(in_channels=embedding_dim, out_channels=num_filters, kernel_size=3)
        self.conv4 = nn.Conv1d(in_channels=embedding_dim, out_channels=num_filters, kernel_size=4)
        
        # 3. 分类器
        self.fc = nn.Linear(num_filters * 3, 1)

    def forward(self, x):
        # x shape: [batch_size, seq_len]
        x = self.embedding(x) # [batch_size, seq_len, embed_dim]
        x = x.permute(0, 2, 1) # 转换维度适应 Conv1d: [batch_size, embed_dim, seq_len]
        
        # 卷积 + ReLU + 全局最大池化
        c2 = F.max_pool1d(F.relu(self.conv2(x)), x.shape[2] - 1).squeeze(2)
        c3 = F.max_pool1d(F.relu(self.conv3(x)), x.shape[2] - 2).squeeze(2)
        c4 = F.max_pool1d(F.relu(self.conv4(x)), x.shape[2] - 3).squeeze(2)
        
        # 特征拼接
        merged = torch.cat((c2, c3, c4), dim=1) # [batch_size, num_filters * 3]
        
        # 输出概率
        out = torch.sigmoid(self.fc(merged))
        return out

# 实例化与训练流程 (伪代码)
# model = PinyinTextCNN(vocab_size=5000)
# criterion = nn.BCELoss()
# optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
# ... 进行 epochs 训练 ...

```

### 5.3 步骤三：模型导出与 Web 部署 (PyTorch -> TF.js)

因为浏览器插件运行在 JS 环境中，而我们在 PyTorch 中训练模型，需要经过格式转换：

1. **导出为 ONNX 格式：**
```python
# 模拟一个输入张量
dummy_input = torch.randint(0, 5000, (1, 100), dtype=torch.long)
torch.onnx.export(model, dummy_input, "spam_model.onnx", 
                  input_names=["input"], output_names=["output"])

```


2. **ONNX 转 TensorFlow.js：**
在终端中使用 `onnx2tf` 和 `tensorflowjs` 工具（这是目前最稳妥的跨框架部署方案）：

```bash
    # 1. 将 ONNX 转为 TensorFlow SavedModel
    onnx2tf -i spam_model.onnx -o saved_model_dir
    
    # 2. 将 SavedModel 转为 TF.js 格式
    tensorflowjs_converter --input_format=tf_saved_model \
                           --output_format=tfjs_graph_model \
                           saved_model_dir/ \
                           tfjs_model_dir/
```
3.  **插件端加载执行：**
    将生成的 `model.json` 和 `.bin` 权重文件放入 Chrome 插件目录。在 Content Script 中调用：
    
```javascript
    import * as tf from '@tensorflow/tfjs';
    
    // 加载模型
    const model = await tf.loadGraphModel(chrome.runtime.getURL('tfjs_model/model.json'));
    
    // 预测函数 (需配合前端的分词函数使用)
    async function predictSpam(tokenIdsArray) {
        const tensor = tf.tensor2d([tokenIdsArray], [1, 100], 'int32');
        const prediction = model.predict(tensor);
        const score = await prediction.data(); // 返回 0~1 的概率
        return score[0] > 0.85; 
    }
    ```

---

## 6. 前端架构说明 (Manifest V3)

*   **`manifest.json`**: 声明 V3 标准，申请 `storage`, `activeTab`, `scripting` 权限。允许注入 JS 和 CSS。
*   **`content_script.js`**: 
    *   负责监听 DOM 变化 (`MutationObserver`)，发现新渲染的评论时触发检测。
    *   加载 `pinyin.js` 库进行前端实时拼音转换。
    *   加载并执行 TF.js 模型。
    *   操作 DOM 实现“折叠”和“注入按钮”。
*   **`background.js` (Service Worker)**: 
    *   维持全局开关状态。
    *   负责与 IndexedDB 进行交互，处理跨生命周期的数据增删改查。
*   **`popup.html` / `popup.js`**: 
    *   基于简单的 HTML/CSS 和 Vanilla JS 构建，与 Background 脚本通信，获取数据渲染列表并执行导出逻辑。

```