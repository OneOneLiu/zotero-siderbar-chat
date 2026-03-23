# Zotero Research Copilot

> [English](#english) | [简体中文](#简体中文)

<div id="english"></div>

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-round&logo=github)](https://github.com/windingwind/zotero-plugin-template)

## Introduction

Zotero Research Copilot is a powerful Zotero 7 plugin that brings an agentic AI assistant directly into your research workflow. It features a reader sidebar chat for interacting with individual papers, an autonomous AI Research Assistant that can search your entire library, and a robust Multi-Paper Analysis pipeline for synthesizing information across multiple documents.

It supports Google Gemini, DeepSeek, Doubao, and other AI models, allowing you to ask questions, summarize content, and analyze cross-paper relationships without leaving Zotero.

## Key Features

### 1. 🤖 AI Research Assistant (Agentic UI)
- Launch a standalone AI Assistant from the Zotero main toolbar.
- The AI acts as an autonomous agent equipped with **tool-calling capabilities**. It can independently:
  - Search your Zotero library (by title, author, tag, collection).
  - Load full texts, item metadata, notes, and user annotations.
  - Read and build RAG indices for dynamic deeper search.
  - Add and remove tags from items directly.
- Engage in a natural conversation while the Assistant fetches the context it needs from your library automatically.

### 2. 📑 Multi-Paper Analysis Pipeline
- Select multiple papers in your library and right-click -> **AI Multi-paper Analysis**.
- Executes a rigorous **4-step analytical pipeline**:
  1. **RAG Indexing**: Builds a local, offline vector index for the chosen PDFs.
  2. **Question Understanding**: AI analyzes your initial query to determine the core concepts.
  3. **Per-paper Extraction**: Extracts relevant information from each paper concurrently using the RAG index.
  4. **Synthesis**: Synthesizes the extracted findings into a comprehensive cross-paper conclusion.
- **Re-run Pipeline**: Effortlessly re-run the full 4-step pipeline on the selected papers after tweaking your prompt or asking a new high-level question.

### 3. 📖 Unified Reader Sidebar Chat
- Chat directly with AI models in the Zotero reader's right pane while reading a specific PDF.
- Text selection formatting: highlight or markup text right inside the AI's response bubbles.
- Responses support rich Markdown formatting and LaTeX math formulas.

### 4. 💾 Session Saving & Loading
- Chat sessions and analysis pipelines are automatically tracked.
- Save your analysis sessions as standalone Zotero notes within the current collection.
- Load previous chat histories directly from your connected notes to resume deep research conversations right where you left off.

### 5. ⚙️ Advanced Prompt Editor & Settings
- **Custom Prompts**: Define custom hints and prompts in settings. Prompts appear as clickable chips for quick reuse.
- **Visual Prompt Editing**: The preferences dialog offers an advanced editor with variable tag insertion (e.g., `{question}`, `{paper_list}`), real-time validation, and a live preview of how the prompts resolve.
- **Multi-Model Support**: Seamlessly switch between different AI providers (Google Gemini, DeepSeek, Doubao) and models from a dropdown.

## How to Use

1. Download and install `zotero-sidebar-chat.xpi` from the Release page into Zotero 7.
2. Go to **Edit → Settings → Zotero Research Copilot** to configure your preferred AI provider and enter your API key. 
3. **IMPORTANT**: Click the **"Test Connection"** button and ensure the test is successful before using the chat functionality.
4. **Reader Chat**: Open a PDF and click the chat icon in the right sidebar.
5. **Multi-Paper Analysis**: Select 2 or more items in the library, right-click, and select "AI Multi-paper Analysis".
6. **AI Assistant**: Click the AI icon in the main Zotero toolbar to chat with your entire library.

## License

This project is licensed under **[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.en.html)**.

---

## Acknowledgments

- Built on the **[Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template)** 

<br>
<hr>
<br>

<div id="简体中文"></div>

## 简介

Zotero Research Copilot 是一款功能强大的 Zotero 7 插件，将具备 Agentic（智能体）能力的 AI 助手直接融入你的科研工作流中。它不仅提供针对单篇文献的阅读器侧边栏聊天，还拥有能全局搜索你文献库的 **AI 科研助手**，以及一套严谨的**多文献综合分析管线**。

插件支持 Google Gemini、DeepSeek、豆包（Doubao）等主流 AI 模型，让你无需离开 Zotero 即可向 AI 提问、总结内容、并在多篇文献间抓取并合成交叉结论。

## 核心功能

### 1. 🤖 AI 科研助手 (Agentic 模式)
- 从 Zotero 主界面的工具栏启动独立的 AI 助手对话框。
- AI 作为具备自主能力的智能体，配备了**工具调用 (Tool-calling) 能力**。它可以自主执行：
  - 搜索你的 Zotero 文献库（按标题、作者、标签、分类检索）。
  - 加载文献全文、元数据、笔记和你的高亮批注。
  - 动态构建和读取 RAG 向量索引，进行全文深度检索。
  - 直接为指定的文献添加或删除标签。
- 你只需用自然语言提问，AI 助手会自动规划并调用相应的工具去库中寻找答案。

### 2. 📑 严谨的多文献分析管线
- 在文献库中多选文献，右键点击 -> **AI Multi-paper Analysis (多文献分析)**。
- 启动高度结构化的 **4步分析管线**：
  1. **RAG 索引构建**：针对选中文献在本地构建离线向量索引。
  2. **问题理解**：AI 拆解你的提问，提取核心概念和子问题。
  3. **单文献提取**：基于上一步的理解与 RAG 检索，并发在每篇文献中提取关键信息。
  4. **综合分析**：将各个文献的提取结果汇总，进行交叉比对和最终结论合成。
- **一键重跑管线**：在调整问题后，可以通过勾选 "Re-run full analysis"，再次对选中论文执行一次完整的四步工作流。

### 3. 📖 阅读器侧边栏沉浸式对话
- 在阅读特定 PDF 时，直接在右侧边栏与 AI 进行专属问答，无需打断阅读流。
- 支持富文本渲染：完美支持 Markdown 格式和 LaTeX 数学公式。
- 支持在 AI 的对话气泡中直接选中文本，添加高亮或标红格式。

### 4. 💾 会话保存与恢复
- 所有的多文献分析和聊天记录均会被自动追踪。
- **一键保存**：将多级对话和深度的文献分析一键保存为 Zotero 的独立笔记（自动落入当前选定的合集中）。
- **随时恢复**：随时可以从保存的笔记中重新加载会话状态，继续之前的研究探讨。

### 5. ⚙️ 高级提示词编辑器与设置
- **自定义快捷指令**：在设置中预设常用 Prompt，它们会呈现为方便点击的小按钮（Chips），避免重复输入。
- **可视化提示词编辑**：设置面板中内置了高级的 Prompt 编辑器，支持一键插入变量标签（如 `{question}`，`{paper_list}`），具备实时非法变量校验，并提供所见即所得的 **预览面板**，让你直观掌握最终传给 AI 的系统指令。
- **多模型无缝切换**：在聊天界面的下拉菜单中随时切换不同的提供商与模型（支持自定义接入）。

## 如何使用

1. 从 Release 页面下载 `zotero-sidebar-chat.xpi` 并将其拖入/安装到 Zotero 7。
2. 进入 **编辑 → 设置 → Zotero Research Copilot**，选择你的 AI 服务商并填入 API Key。
3. **注意**：填写后请务必点击 **"Test Connection"（测试连接）** 按钮，成功后方能使用核心对话功能。
4. **单篇对话**：在阅读器打开 PDF 时点击右侧面板图标进入对话。
5. **多文献分析**：在文献列表库中选中 2 篇以上的文献，右击选择相应菜单。
6. **全局 AI 助手**：点击主界面主工具栏的机器人图标按钮，与整个文献库对话。

## 许可协议

本项目采用 **[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.en.html)** 许可协议。

---

## 致谢

- 基于 **[Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template)** 构建
