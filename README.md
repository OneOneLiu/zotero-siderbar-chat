# Zotero Research Copilot

[![Zotero Plugin Template](https://img.shields.io/badge/Built%20with-Zotero%20Plugin%20Template-0366d6?style=flat&logo=github)](https://github.com/windingwind/zotero-plugin-template)
[![GitHub release](https://img.shields.io/github/v/release/OneOneLiu/Zotero-Research-Copilot?label=release)](https://github.com/OneOneLiu/Zotero-Research-Copilot/releases/latest)
[![Release date](https://img.shields.io/github/release-date/OneOneLiu/Zotero-Research-Copilot?label=released)](https://github.com/OneOneLiu/Zotero-Research-Copilot/releases)
[![Latest release downloads](https://img.shields.io/github/downloads/OneOneLiu/Zotero-Research-Copilot/latest/total?label=downloads%20%28latest%20release%29)](https://github.com/OneOneLiu/Zotero-Research-Copilot/releases/latest)
[![License](https://img.shields.io/github/license/OneOneLiu/Zotero-Research-Copilot)](https://github.com/OneOneLiu/Zotero-Research-Copilot/blob/main/LICENSE)

[English](#english) · [简体中文](#简体中文)

<div id="english"></div>

## English

Zotero Research Copilot is a plugin for Zotero. It adds AI-assisted reading in the PDF reader, a library-wide assistant that can call tools against your collection, and a structured multi-paper analysis workflow. You configure an API provider and key in preferences; supported setups include Google Gemini, DeepSeek, and Doubao (Volcengine), along with OpenAI-style endpoints when you set a compatible base URL and model name.

### Reader sidebar chat

With a PDF open in the reader, you can open the plugin’s pane in the sidebar and chat in the context of that item. Replies are rendered as Markdown (including code highlighting), math where applicable, and diagrams where supported. The reader integration is meant for quick questions and summaries tied to the document you are viewing.

### Library assistant (standalone)

From the main Zotero window you can open a separate chat window scoped to your library (or a chosen collection, depending on how you launch it). The assistant can use tools: for example searching items, reading metadata, notes, and annotations, working with full text where available, building or querying local RAG indices for selected papers, and adjusting tags. It plans steps in conversation rather than expecting you to drive every retrieval by hand.

### Multi-paper analysis

Select multiple items in the library, open the context menu, and choose the multi-paper analysis entry. The workflow is built around local RAG indices over the PDFs you include: it builds indices, refines your question, extracts per-paper material, then synthesizes across papers. Follow-up turns can reuse RAG search over the same set. You can opt to re-run the full pipeline when you change the main question.

Session data can be saved into a Zotero note; structured history is stored as a JSON attachment, normally under a single library item titled **Research Copilot History** (created if needed). You can resume a saved session from the note via the context menu. After syncing to another computer, wait until attachment files have synced before resuming, since the JSON lives in stored attachments.

### Settings

Preferences let you choose provider, model, API base, and key. There is a connection test before you rely on the plugin in daily use. You can edit system and analysis-related prompts, use placeholder variables where the UI documents them, and define quick prompts that appear as small actions in the chat UI.

### Install and requirements

Build or download the packaged extension (`zotero-research-copilot.xpi` from [Releases](https://github.com/OneOneLiu/Zotero-Research-Copilot/releases)) and install it in Zotero 7. Open **Edit → Settings → Zotero Research Copilot**, enter credentials, and run **Test Connection**. Then use the reader sidebar button, the library assistant entry point, or the multi-paper analysis context menu as needed.

### License

This project is licensed under [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.en.html).

### Acknowledgments

Development started from the [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template).

---

<div id="简体中文"></div>

## 简体中文

Zotero Research Copilot 是面向 Zotero 的插件：在阅读器里提供针对当前文献的侧边栏对话；在主界面提供可调用工具、面向整个文库（或指定文件夹）的助手；以及结构化的多文献分析流程。在设置中配置 API 服务商与密钥即可使用；内置常见配置包括 Google Gemini、DeepSeek、豆包（火山引擎），也可在填写兼容的接口地址与模型名时使用类 OpenAI 的接口。

### 阅读器侧边栏对话

在阅读器中打开 PDF 后，可在侧栏打开插件面板，就当前条目向模型提问。回复按 Markdown 等方式排版，并支持代码高亮、公式与部分图表能力，适合在读论文时做摘录、追问和简要总结。

### 文库助手（独立窗口）

在主窗口可打开独立对话界面，范围覆盖你的文库或当前所选集合（视启动方式而定）。助手可以使用多种工具，例如在库内检索条目、读取元数据与笔记批注、在可用时读取全文、为所选文献建立或查询本地 RAG 索引、修改标签等，由对话驱动检索与操作，而不必每一步都手动复制粘贴。

### 多文献分析

在文库中多选条目，通过右键菜单进入多文献分析。流程在本地为所选 PDF 建立 RAG 索引，再经历问题理解、分篇提取与跨篇综合等阶段；后续追问可在同一批文献上继续走检索。若在设置中开启相应选项，可以在更换主要问题后重新跑完整管线。

会话可保存为 Zotero 笔记；结构化的对话与管线状态以 JSON 附件形式存放，通常挂在名为 **Research Copilot History** 的数据集条目下（若不存在会自动创建）。保存的笔记可通过右键菜单中的恢复入口继续会话。若使用同步，在另一台设备上需待附件文件同步完成后再恢复，因为 JSON 在附件中而非仅存在于笔记正文。

### 设置

可在首选项中选择服务商、模型、接口地址与密钥，并先使用「测试连接」确认可用。支持编辑系统与分析相关提示词、在界面说明的范围内使用占位变量，以及配置在对话界面中以快捷方式出现的常用提示。

### 安装与使用

从 [Releases](https://github.com/OneOneLiu/Zotero-Research-Copilot/releases) 下载打包扩展（一般为 `zotero-research-copilot.xpi`）并安装。在 **编辑 → 设置 → Zotero Research Copilot** 中填写 API 信息并测试连接后，即可使用阅读器侧栏按钮、文库助手入口以及多文献分析的右键菜单。

### 许可

本项目以 [AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.en.html) 许可发布。

### 致谢

项目基于 [Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template) 起步开发。
