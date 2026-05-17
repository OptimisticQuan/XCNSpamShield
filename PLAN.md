## Plan: XCNSpamShield 双项目脚手架

基于现有规格，推荐在仓库根目录下同时建立两个独立但可联动的项目：一个是 TypeScript + Vite 的 MV3 插件项目，另一个是 Python 训练与导出项目，并通过共享数据约定与模型产物同步脚本把两端串起来。首版范围包含完整插件骨架、完整训练/评估/导出链路、以及面向开发和验证的辅助脚本；浏览器范围先锁定 Chrome/Chromium，站点范围锁定 x.com 与 twitter.com，拼音统一去声调，避免前后端 tokenizer 漂移。

**Steps**
1. 阶段一：定义仓库布局与共享约定。先在 <repo-root> 下建立 extension、ml、artifacts、scripts 四个顶层区域，并补齐根级 README、.gitignore、Makefile 或等价任务入口。此步骤产出目录结构、统一命名、环境前提与跨项目命令约定，后续所有步骤都依赖它。
2. 阶段一：沉淀共享契约。依据 <repo-root>/SPEC.md 的导出 schema，定义统一的数据类型、消息协议、模型输入长度、阈值与标签语义。重点固定 reply 的 label/source 语义、[CLS]/[SEP]/[PAD]/[UNK] 特殊 token、最大序列长度 100、默认阈值 0.85，以及人工标签优先于自动标签的覆盖规则。此步骤依赖 1，可与步骤 3 并行开始草拟，但必须先于插件与训练代码细化完成。
3. 阶段二：搭建插件项目骨架。创建 <repo-root>/extension 作为独立 Node 项目，使用 TypeScript + Vite 自建 MV3 打包流程，生成 manifest、tsconfig、vite 配置、开发/构建脚本与静态资源目录。需要确保 content script、background service worker、popup 页面分别单独打包，且模型文件与 CSS 资源能被复制进最终扩展产物。此步骤依赖 1 和 2。
4. 阶段二：实现插件共享层与基础设施。优先建立 extension/src/shared 下的类型定义、常量、消息枚举、日志工具、错误包装和配置读取；建立 extension/src/storage 下的 IndexedDB 封装，使用 idb 提供 threads、replies、settings 三类 store；建立 extension/src/ml 下的 tokenizer、heuristics、model-loader 和 inference 边界。此步骤依赖 3；其中 storage 与 ml/shared 可并行。
5. 阶段二：实现 background service worker。负责全局开关状态、消息路由、IndexedDB CRUD、导出 JSON、触发下载、以及 popup/content 之间的中转。需要把“提取当前页面数据”“切换标签”“删除记录”“清空本地库”“导出训练集”这些动作做成明确的消息处理器，并对 service worker 重启后的状态恢复做兼容。此步骤依赖 4。
6. 阶段二：实现 content script 端主流程。拆成 DOM 发现、X 页面解析、启发式判定、模型推理、折叠渲染、按钮注入、事件代理、页面数据提取八个子模块。优先支持当前视口的主帖与首级回复提取，忽略楼中楼；对 x.com 与 twitter.com 的详情页和时间线页面分别准备选择器策略；对可疑文本先走 heuristics，再按需触发 TF.js 推理；对 spam 回复写入折叠态并提供展开交互。此步骤依赖 4 和 5。
7. 阶段二：实现 popup UI。创建简洁但完整的 popup 页面，包含总开关、提取按钮、列表视图、单条删除、标签切换、清空本地库、导出按钮以及必要的加载/空态/错误态。数据操作全部走 background 消息，不直接访问页面 DOM。此步骤依赖 5，可与步骤 6 并行。
8. 阶段二：补齐插件辅助脚本与测试。增加 npm scripts 或根级任务，至少覆盖 install、dev、build、lint、typecheck、test、package、load-model、copy-model、smoke-data。编写针对 tokenizer、heuristics、IndexedDB 适配层、schema 导出器的单元测试，并准备最小的样本 fixture，初始规则可参考 <repo-root>/1.txt 中的高频 spam 句式与混淆写法。此步骤依赖 3 到 7。
9. 阶段三：搭建训练项目骨架。创建 <repo-root>/ml 作为独立 Python 项目，优先使用 pyproject.toml 管理依赖，并补充 requirements.txt 便于快速落地。目录至少包含 data、src、tests、scripts、outputs 五个区域，分别承载原始导出数据、预处理/模型/训练代码、测试、命令脚本与模型产物。此步骤依赖 1 和 2，可与插件阶段并行推进。
10. 阶段三：实现数据预处理与词表构建。建立 JSON schema 校验、导出文件读取、主帖/回复拼接、去声调拼音转换、字符级切分、padding/truncation、vocab 构建与数据集切分流程。要求既能直接使用 JSON 中的 cleaned_pinyin，也能在缺失时重新生成，保证浏览器端与 Python 端使用同一规范。此步骤依赖 9。
11. 阶段三：实现 TextCNN 训练与评估链路。按规格落地 embedding + 2/3/4 卷积核 + 全局最大池化 + sigmoid 输出的二分类模型，封装 Dataset、DataLoader、训练入口、评估入口、早停、最佳模型保存、指标输出与混淆样本导出。手工标注样本相较 auto 样本增加 loss 权重，避免自动规则把噪声放大。此步骤依赖 10。
12. 阶段三：实现导出与转换链路。增加 PyTorch 到 ONNX 的导出脚本、ONNX 数值校验脚本、onnx2tf 转换脚本、tensorflowjs_converter 包装脚本，以及把 TF.js model.json/.bin 同步到 extension 产物目录的桥接脚本。需要固定输入形状和 opset，保证浏览器端能直接用 chrome.runtime.getURL 加载。此步骤依赖 11。
13. 阶段三：补齐训练端辅助脚本。至少提供 build-vocab、prepare-dataset、train, evaluate, export-onnx, convert-tfjs, compare-backends, copy-model, clean-outputs 这些入口，并为它们补充 README 使用示例和参数说明。此步骤依赖 10 到 12。
14. 阶段四：端到端联调。先用样本数据走通“提取页面数据 -> 本地标注/切换 -> 导出 JSON -> 训练 -> 导出 TF.js -> 同步到插件 -> 页面推理”的闭环；再确认启发式命中、模型命中、手工覆写、导出结构、popup 列表状态与 service worker 恢复都符合预期。此步骤依赖 8 和 13。
15. 阶段四：补充文档与交付物。整理根级 README、extension/README、ml/README、快速启动步骤、已知限制、X DOM 选择器脆弱点、模型重训流程、以及首版明确不做的能力。此步骤依赖前述所有实现步骤。

**Relevant files**
- <repo-root>/SPEC.md — 作为功能范围、数据 schema、模型结构和 MV3 角色划分的唯一规格来源。
- <repo-root>/1.txt — 作为首批启发式规则、测试 fixture 和脏数据处理样本来源。
- <repo-root>/README.md — 根级项目说明、双项目启动方式与闭环流程文档。
- <repo-root>/Makefile — 根级统一任务入口，串联 extension 与 ml 的常用命令。
- <repo-root>/extension/package.json — 插件端依赖、脚本与构建入口。
- <repo-root>/extension/vite.config.ts — MV3 多入口打包、静态资源复制与输出目录控制。
- <repo-root>/extension/manifest.json — 扩展权限、host permissions、background、content scripts、web_accessible_resources 定义。
- <repo-root>/extension/src/background/index.ts — service worker 主入口与消息路由。
- <repo-root>/extension/src/content/index.ts — MutationObserver、页面解析、折叠与注入流程总入口。
- <repo-root>/extension/src/content/selectors.ts — 针对 x.com/twitter.com 的稳定选择器与页面判定逻辑。
- <repo-root>/extension/src/content/extractor.ts — 主帖与首级回复抽取逻辑。
- <repo-root>/extension/src/content/collapser.ts — spam 折叠态渲染与展开交互。
- <repo-root>/extension/src/content/actions.ts — 操作栏按钮注入与点击事件代理。
- <repo-root>/extension/src/popup/index.html — popup 基础结构。
- <repo-root>/extension/src/popup/main.ts — popup 状态获取、列表渲染和用户操作绑定。
- <repo-root>/extension/src/storage/db.ts — idb 封装、schema 升级和 CRUD 抽象。
- <repo-root>/extension/src/shared/messages.ts — popup/background/content 共用消息协议。
- <repo-root>/extension/src/shared/types.ts — Thread、ReplyRecord、ExportPayload、Settings 等核心类型。
- <repo-root>/extension/src/ml/tokenizer.ts — 去声调拼音转换、字符切分、token id 映射与 padding。
- <repo-root>/extension/src/ml/heuristics.ts — 基于样本与规则的 spam 初筛引擎。
- <repo-root>/extension/src/ml/model-loader.ts — TF.js 模型加载、缓存与推理入口。
- <repo-root>/scripts/copy-model.mjs — 将 ml 输出的 TF.js 模型同步到 extension 目录。
- <repo-root>/ml/pyproject.toml — Python 项目依赖与命令入口。
- <repo-root>/ml/requirements.txt — 便于快速安装的依赖清单。
- <repo-root>/ml/src/preprocessing/pinyin_normalizer.py — 去声调拼音标准化实现。
- <repo-root>/ml/src/preprocessing/tokenizer.py — 特殊 token、字符级切分和 id 映射。
- <repo-root>/ml/src/preprocessing/dataset_builder.py — JSON 导出到训练样本的转换逻辑。
- <repo-root>/ml/src/models/textcnn.py — Pinyin TextCNN 模型实现。
- <repo-root>/ml/src/training/train.py — 训练入口、checkpoint 与日志输出。
- <repo-root>/ml/src/training/evaluate.py — 指标评估与误判样本导出。
- <repo-root>/ml/src/export/export_onnx.py — ONNX 导出脚本。
- <repo-root>/ml/src/export/convert_tfjs.py — 包装 onnx2tf 与 tensorflowjs_converter 的转换入口。
- <repo-root>/ml/tests/test_tokenizer.py — 前后端 tokenizer 一致性测试。
- <repo-root>/ml/tests/test_export_equivalence.py — PyTorch、ONNX、TF.js 结果对齐测试。
- <repo-root>/artifacts/sample-data/ — 样本导出、fixture 与回归测试输入。
- <repo-root>/artifacts/models/ — 最终 ONNX 与 TF.js 产物输出目录。

**Verification**
1. 运行根级安装与构建任务，确认 extension 与 ml 两个项目都能在全新环境下完成依赖安装与基础构建，不依赖手工修补。
2. 执行插件端 typecheck、lint 和单元测试，重点验证 tokenizer、heuristics、IndexedDB schema 升级、JSON 导出器与消息协议。
3. 用样本 fixture 运行训练端预处理、词表构建和 dataset split，确认去声调逻辑、[CLS]/[SEP] 拼接、padding 和标签权重符合约定。
4. 运行一次最小训练与评估，确认模型前向、checkpoint、指标输出、误判样本导出正常。
5. 运行 ONNX 导出、onnx2tf 转换、TF.js 转换和跨后端一致性比较，确保同一输入在 PyTorch/ONNX/TF.js 的输出误差处于可接受范围。
6. 将 TF.js 产物同步到插件目录后，构建扩展并在 Chrome 以 unpacked 方式加载，检查 manifest、权限、资源路径和 service worker 是否正常。
7. 在 x.com 与 twitter.com 的目标页面手动验证：开关生效、提取当前页面只抓主帖与首级回复、spam 折叠/展开正常、按钮注入位置正确、popup 列表能删改查、导出 JSON 结构匹配规格。
8. 用 <repo-root>/1.txt 中的典型 spam 文本和正常评论做回归，确认启发式与模型推理都能覆盖首批样本。

**Decisions**
- 插件工程采用 TypeScript + Vite 自建 Manifest V3，不使用 Plasmo。
- 训练项目按完整链路落地，不只做训练骨架；需要包含评估、ONNX 导出、TF.js 转换与模型同步脚本。
- 浏览器与站点范围首版仅覆盖 Chrome/Chromium 上的 x.com 与 twitter.com。
- 拼音标准化统一去声调，减小词表规模并降低前后端不一致风险。
- IndexedDB 中人工标签优先级高于自动标签；训练时 manual 样本给予更高权重。
- 首版只覆盖规格中明确列出的功能：全局开关、当前视口提取、网页内标注、popup 管理、JSON 导出、启发式 + TF.js 推理。
- 首版明确不包含远程同步、多用户协作标注、自动更新模型服务、Firefox 兼容、楼中楼提取、复杂可视化分析面板。
- 启发式规则首批由 1.txt 的样本短语、表情混淆、拼音/字母混写模式驱动，后续可扩展为可配置规则集。

**Further Considerations**
1. 建议把前后端 tokenizer 的关键规则写成同一份规范文档并做双端一致性测试，否则后续模型效果会被预处理漂移直接破坏。
2. X 的 DOM 结构高度脆弱，content script 的选择器应做成独立模块并准备 fallback 逻辑，不要把选择器散落在业务代码里。
3. 如果后续样本量快速增长，可在第二阶段后补充分页加载、批量导入导出和量化模型，以控制 popup 性能与推理延迟。