# Zotero Sidebar Chat

> [English](#english) | [简体中文](#简体中文)

<div id="english"></div>

[![Using Zotero Plugin Template](https://img.shields.io/badge/Using-Zotero%20Plugin%20Template-blue?style=flat-round&logo=github)](https://github.com/windingwind/zotero-plugin-template)

## Introduction

A Zotero plugin that brings a AI chat window directly into your Zotero reader sidebar. It supports Google Gemini, DeepSeek, and Doubao AI models, allowing you to ask questions, summarize content, and interact with your documents without leaving Zotero. Chat histories can be saved to notes, and AI responses can be annotated just like your PDFs.

![](./images/plugin.png)

## How to Use

1. Download and install the `zotero-sidebar-chat.xpi` from the Release page into Zotero 7.
2. Go to **Edit → Settings → Zotero Sidebar Chat** to configure your preferred AI provider and enter your API key. **IMPORTANT: You must click the "Test Connection" button and ensure the test is successful before you can use the chat functionality.**
3. Open any PDF item in the Zotero reader.
4. Click the button in the sidebar to start chat.

## Features

### 1. Unified Sidebar Chat
- Chat directly with AI models in the Zotero reader's right pane while reading.
- Responses support rich Markdown formatting and LaTeX math formulas.
- Streaming responses for a fast and smooth interaction.

### 2. Multi-Model Support
- Seamlessly switch between different AI providers (Google Gemini, DeepSeek, Doubao).
- Select specific model versions directly from a dropdown menu in the chat header.

### 3. Save & Load Chat History
- Chat sessions are automatically tracked and can be saved as Zotero notes.
- Load previous chat history directly from your connected note to resume conversations at any time.

### 4. Interactive Bubble Formatting
- Select text inside the AI's response bubble to apply a yellow highlight or red text color.
- These formatting edits are automatically persisted to your chat history note.

### 5. Custom Quick Prompts
- Define your own custom prompts in the plugin settings.
- Prompts appear as clickable chips at the top of the chat panel, saving you time from typing repetitive instructions.

### 6. Additional File Context
- Click the button in the bottom-left corner of the chat input area to select and add other files as context for your conversation.

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

这是一个为 Zotero 设计的阅读器侧边栏 AI 聊天插件。它在 Zotero 的界面中集成了一个轻量级的对话窗口，支持 Google Gemini、DeepSeek 和豆包（Doubao）模型。你可以在阅读文献时直接与 AI 对话，将聊天记录保存为 Zotero 笔记，也可以直接对 AI 的回复内容进行高亮和标注。

## 如何使用

1. 从 Release 页面下载 `zotero-sidebar-chat.xpi` 并安装到 Zotero 7。
2. 在 **编辑 → 设置 → Zotero Sidebar Chat** 中选择 AI 提供商并填入你的 API Key。**注意：填写完成后，请务必点击下方的“测试连接”按钮，只有在测试通过后，才能正常使用聊天功能。**
3. 在 Zotero 中打开任意 PDF 文献。
4. 点击阅读器侧边栏的新增的按钮即可开始对话。

## 功能介绍

### 1. 阅读器侧边栏聊天窗口
- 直接在阅读器的右侧边栏与 AI 对话，无需切换窗口或打断阅读流。
- 完美支持 Markdown 格式和 LaTeX 数学公式渲染。
- 支持流式输出，提供类似原生 App 的流畅对话体验。

### 2. 多模型快速切换
- 内置对 Google Gemini、DeepSeek 和豆包（Doubao）等多家 AI 服务的支持。
- 可以在聊天界面顶部的下拉菜单中，快速切换当前提供商的不同模型版本。

### 3. 本地聊天记录管理
- 自动关联当前文献的对话记录，并支持保存为 Zotero 笔记。
- 随时可以点击从笔记中一键加载历史对话，接续之前的提问。

### 4. AI 对话气泡高亮批注
- 选中 AI 回复气泡中的任意文字，即可为其添加黄色「高亮」或「标红」样式。
- 所有在聊天窗口内进行的高亮批注都会自动同步并保存到聊天记录笔记中。

### 5. 自定义快捷指令 (Prompts)
- 可以在插件设置页面预设常用的自定义提示词。
- 快捷指令会作为方便的小按钮（Chip）显示在聊天输入区上方，一键点击发送，告别重复输入。

### 6. 补充文件上下文
- 点击聊天输入区左下角的按钮，可以选择加载更多文件作为当前对话的上下文，帮助 AI 更好地理解你的问题。

## 许可协议

本项目采用 **[AGPL-3.0](https://www.gnu.org/licenses/agpl-3.0.en.html)** 许可协议。

---

## 致谢

- 基于 **[Zotero Plugin Template](https://github.com/windingwind/zotero-plugin-template)** 构建
