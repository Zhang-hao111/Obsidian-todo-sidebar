# Obsidian Todo Sidebar

一个 Obsidian 插件，在侧边栏集中管理 vault 中所有待办任务，macOS 风格界面。

## 功能

- 自动扫描 vault 中所有 `- [ ]` 格式的待办任务，按日期分组显示
- 「有日期 / 无日期 / 已完成」三个分段选项卡，已完成任务可取消勾选恢复
- 优先级：⏫ 高 / 🔼 中 / 🔽 低，影响排序，卡片上有红 / 橙 / 蓝圆点标识
- 详细描述：任务下方缩进的行作为描述，随任务一起编辑 / 删除
- 任务卡片悬浮显示编辑、删除按钮（删除有确认弹窗）
- 搜索任务标题和描述
- macOS 风月历日期选择器（今天 / 清除快捷键）
- 点击任务跳转到对应笔记位置
- 文件被外部改动（手动编辑、GNOME 顶栏勾选等）时自动刷新
- 勾选状态、编辑、删除直接写回原笔记文件

## 安装

1. 从 [Releases](https://github.com/Zhang-hao111/Obsidian-todo-sidebar/releases) 下载 `main.js`、`manifest.json`、`styles.css`
2. 复制到 `<vault>/.obsidian/plugins/obsidian-todo-sidebar/`
3. 在 Obsidian 设置中启用插件

## 开发

```bash
npm install
npm run dev    # 开发模式，自动监听
npm run build  # 类型检查 + 生产构建（输出 main.js）
```

发版：`git tag v2.0.x && git push origin v2.0.x`，CI 会自动构建并把 `main.js`、`manifest.json`、`styles.css` 上传到 Release。

构建产物 `main.js` 不入库（.gitignore）；`legacy/` 里保存的是移植前手写演进的 v2 原始 JS，仅作历史参考。

## 任务格式

新建待办默认写入 `待办任务.md`，格式如下（与系统顶栏扩展、日历同步脚本兼容）：

```markdown
- [ ] 完成项目报告 ⏫ 📅 2026-09-30
    补充细节、链接、验收标准……
```

插件也会识别 vault 中所有带日期标签 `📅 YYYY-MM-DD` 的任务；优先级识别 ⏫/🔺(高)、🔼(中)、🔽/⏬(低)。

## License

MIT
