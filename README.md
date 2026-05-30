# Obsidian Todo Sidebar

一个 Obsidian 插件，在侧边栏按日期分类显示 vault 中所有待办任务。

## 功能

- 自动扫描 vault 中所有 `- [ ]` 格式的待办任务
- 按日期分组显示，支持日期筛选
- 点击 `+` 按钮快速新建待办，支持快捷日期选择（今天、明天、后天、下周一）
- 勾选复选框直接切换任务状态
- 点击任务跳转到对应笔记位置

## 安装

1. 从 [Releases](https://github.com/Zhang-hao111/Obsidian-todo-sidebar/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到 `<vault>/.obsidian/plugins/obsidian-todo-sidebar/`
3. 在 Obsidian 设置中启用插件

## 开发

```bash
npm install
npm run dev    # 开发模式，自动监听
npm run build  # 生产构建
```

## 任务格式

新建待办会自动存储到 `待办/YYYY-MM-DD.md` 文件中，格式如下：

```markdown
- [ ] 完成项目报告 📅 2025-05-30
```

插件也会识别 vault 中所有带日期标签 `📅 YYYY-MM-DD` 或不带日期的 `- [ ]` 任务。

## License

MIT
