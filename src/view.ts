import { ItemView, Notice, WorkspaceLeaf, moment, setIcon } from "obsidian";
import type TodoSidebarPlugin from "./main";
import {
	parseTasksInContent,
	sortTasks,
	buildTaskLines,
	PRIORITIES,
	type TabKey,
	type TodoTask,
	type TaskDraft,
} from "./task";

export const VIEW_TYPE_TODO_SIDEBAR = "todo-sidebar-view";

const TAB_LABELS: Record<TabKey, string> = {
	"has-date": "有日期",
	"no-date": "无日期",
	done: "已完成",
};

export class TodoSidebarView extends ItemView {
	private plugin: TodoSidebarPlugin;
	private tasks: TodoTask[] = [];
	private query = "";
	private searchOpen = false;

	constructor(leaf: WorkspaceLeaf, plugin: TodoSidebarPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_TODO_SIDEBAR;
	}

	getDisplayText(): string {
		return "待办任务";
	}

	getIcon(): string {
		return "list-checks";
	}

	async onOpen(): Promise<void> {
		await this.refreshTasks();
	}

	async onClose(): Promise<void> {}

	async refreshTasks(): Promise<void> {
		this.tasks = [];
		const files = this.app.vault.getMarkdownFiles();
		for (const file of files) {
			const content = await this.app.vault.cachedRead(file);
			this.tasks.push(...parseTasksInContent(content, file));
		}
		this.render();
	}

	private iconButton(parent: HTMLElement, icon: string, label: string): HTMLButtonElement {
		const btn = parent.createEl("button", {
			cls: "todo-icon-btn",
			attr: { "aria-label": label },
		});
		setIcon(btn, icon);
		return btn;
	}

	/* ---------- 渲染骨架 ---------- */

	private render(): void {
		const container = this.containerEl.children[1] as HTMLElement;
		container.empty();
		container.addClass("todo-sidebar-container");

		// 头部：标题 + 摘要小字，右侧是搜索开关 / 新建 / 刷新
		const header = container.createDiv({ cls: "todo-header" });
		const titleBox = header.createDiv({ cls: "todo-header-title" });
		titleBox.createEl("h3", { text: "待办任务" });
		this.renderSummary(titleBox);
		const headerActions = header.createDiv({ cls: "todo-header-actions" });
		const searchBtn = this.iconButton(headerActions, "search", "搜索");
		if (this.searchOpen) searchBtn.addClass("is-active");
		searchBtn.addEventListener("click", () => {
			this.searchOpen = !this.searchOpen;
			if (!this.searchOpen) this.query = "";
			this.render();
			if (this.searchOpen) {
				setTimeout(() => {
					const input = this.containerEl.querySelector(
						".todo-search input"
					) as HTMLInputElement | null;
					if (input) input.focus();
				}, 30);
			}
		});
		const addBtn = this.iconButton(headerActions, "plus", "新建待办");
		addBtn.addEventListener("click", () => this.plugin.openTaskModal(null, this));
		const refreshBtn = this.iconButton(headerActions, "refresh-cw", "刷新");
		refreshBtn.addEventListener("click", () => this.refreshTasks());

		// 搜索（默认收起，点放大镜展开，Esc 收起）
		if (this.searchOpen) {
			const searchWrap = container.createDiv({ cls: "todo-search" });
			const searchIcon = searchWrap.createSpan({ cls: "todo-search-icon" });
			setIcon(searchIcon, "search");
			const searchInput = searchWrap.createEl("input", {
				attr: { type: "text", placeholder: "搜索任务或描述…" },
			});
			searchInput.value = this.query;
			searchInput.addEventListener("input", () => {
				this.query = searchInput.value;
				this.renderList(listEl);
			});
			searchInput.addEventListener("keydown", (e) => {
				if (e.key === "Escape") {
					e.stopPropagation();
					if (this.query) {
						this.query = "";
						searchInput.value = "";
						this.renderList(listEl);
					} else {
						this.searchOpen = false;
						this.render();
					}
				}
			});
		}

		// 分段选项卡
		const tab = this.plugin.settings.selectedTab;
		const counts: Record<TabKey, number> = {
			"has-date": this.tasks.filter((t) => !t.checked && t.date).length,
			"no-date": this.tasks.filter((t) => !t.checked && !t.date).length,
			done: this.tasks.filter((t) => t.checked).length,
		};
		const tabs = container.createDiv({ cls: "todo-tabs" });
		for (const key of Object.keys(TAB_LABELS) as TabKey[]) {
			const btn = tabs.createEl("button", {
				cls: `todo-tab ${tab === key ? "active" : ""}`,
				text: `${TAB_LABELS[key]} ${counts[key]}`,
			});
			btn.addEventListener("click", async () => {
				this.plugin.settings.selectedTab = key;
				await this.plugin.saveSettings();
				this.render();
			});
		}

		const listEl = container.createDiv({ cls: "todo-list" });
		this.renderList(listEl);
	}

	// 标题下的摘要小字：N 项未完成 · N 已过期 / N 今天到期
	private renderSummary(parent: HTMLElement): void {
		const open = this.tasks.filter((t) => !t.checked);
		const today = moment().format("YYYY-MM-DD");
		const overdue = open.filter((t) => t.date && t.date < today).length;
		const dueToday = open.filter((t) => t.date === today).length;
		const sub = parent.createDiv({ cls: "todo-header-subtitle" });
		sub.createSpan({ text: `${open.length} 项未完成` });
		if (overdue > 0) {
			sub.createSpan({ cls: "is-overdue", text: ` · ${overdue} 已过期` });
		} else if (dueToday > 0) {
			sub.createSpan({ cls: "is-today", text: ` · ${dueToday} 今天到期` });
		}
	}

	private filteredTasks() {
		const tab = this.plugin.settings.selectedTab;
		let list = this.tasks;
		if (tab === "done") list = list.filter((t) => t.checked);
		else if (tab === "no-date") list = list.filter((t) => !t.checked && !t.date);
		else list = list.filter((t) => !t.checked && t.date);

		const q = this.query.trim().toLowerCase();
		if (q) {
			list = list.filter(
				(t) =>
					t.text.toLowerCase().includes(q) ||
					(t.description && t.description.toLowerCase().includes(q))
			);
		}
		return list;
	}

	private renderList(listEl: HTMLElement): void {
		listEl.empty();
		const tab = this.plugin.settings.selectedTab;
		const tasks = this.filteredTasks();

		if (tasks.length === 0) {
			const text = this.query
				? "没有匹配的任务"
				: tab === "done"
				? "还没有已完成的任务"
				: "没有待办任务";
			listEl.createDiv({ cls: "todo-empty", text });
			return;
		}

		if (tab === "has-date") {
			const grouped = new Map<string, TodoTask[]>();
			for (const t of tasks) {
				if (!grouped.has(t.date!)) grouped.set(t.date!, []);
				grouped.get(t.date!)!.push(t);
			}
			const today = moment().format("YYYY-MM-DD");
			for (const d of [...grouped.keys()].sort()) {
				const overdue = d < today;
				const group = listEl.createDiv({ cls: "todo-group" });
				const gh = group.createDiv({
					cls: `todo-group-header ${overdue ? "is-overdue" : ""}`,
				});
				gh.createSpan({
					cls: "todo-group-label",
					text: this.formatDateDisplay(d, overdue),
				});
				gh.createSpan({
					cls: "todo-group-count",
					text: String(grouped.get(d)!.length),
				});
				for (const t of sortTasks(grouped.get(d)!)) this.renderTask(group, t);
			}
		} else {
			for (const t of sortTasks(tasks)) this.renderTask(listEl, t);
		}
	}

	private renderTask(parent: HTMLElement, task: TodoTask): void {
		const card = parent.createDiv({
			cls: `todo-card ${task.checked ? "is-done" : ""}`,
		});

		// 圆形勾选框（macOS 提醒事项风）
		const check = card.createSpan({
			cls: `todo-check ${task.checked ? "is-checked" : ""}`,
			attr: { role: "checkbox", "aria-checked": String(task.checked) },
		});
		setIcon(check, "check");
		check.addEventListener("click", async (e) => {
			e.stopPropagation();
			await this.toggleTask(task);
		});

		// 内容区（点击跳转到笔记对应行）
		const content = card.createDiv({ cls: "todo-content" });
		content.addEventListener("click", () => this.openTaskFile(task));

		const titleRow = content.createDiv({ cls: "todo-title-row" });
		titleRow.createSpan({ cls: "todo-title", text: task.text });

		if (task.priority) {
			const p = PRIORITIES.find((x) => x.key === task.priority);
			if (p) {
				const dot = titleRow.createSpan({ cls: "todo-priority-dot" });
				dot.style.backgroundColor = p.color;
				dot.setAttr("title", `优先级：${p.label}`);
			}
		}

		if (task.date) {
			const today = moment().format("YYYY-MM-DD");
			let cls = "todo-date-pill";
			if (task.date < today && !task.checked) cls += " is-overdue";
			else if (task.date === today) cls += " is-today";
			titleRow.createSpan({ cls, text: this.formatDateShort(task.date) });
		}

		if (task.description) {
			content.createDiv({ cls: "todo-desc", text: task.description });
		}

		content.createDiv({ cls: "todo-source", text: task.file.basename });

		// 悬浮操作按钮
		const actions = card.createDiv({ cls: "todo-actions" });
		const editBtn = this.iconButton(actions, "pencil", "编辑");
		editBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.plugin.openTaskModal(task, this);
		});
		const delBtn = this.iconButton(actions, "trash-2", "删除");
		delBtn.addClass("is-danger");
		delBtn.addEventListener("click", (e) => {
			e.stopPropagation();
			this.plugin.confirmDelete(task, () => this.deleteTask(task));
		});
	}

	/* ---------- 日期显示 ---------- */

	private formatDateShort(dateStr: string): string {
		const m = moment(dateStr, "YYYY-MM-DD");
		const today = moment();
		if (m.isSame(today, "day")) return "今天";
		if (m.isSame(today.clone().add(1, "day"), "day")) return "明天";
		if (m.isSame(today.clone().subtract(1, "day"), "day")) return "昨天";
		return m.format("MM-DD");
	}

	private formatDateDisplay(dateStr: string, overdue: boolean): string {
		const m = moment(dateStr, "YYYY-MM-DD");
		const weekday = ["日", "一", "二", "三", "四", "五", "六"][m.day()];
		const short = this.formatDateShort(dateStr);
		let label = ["今天", "明天", "昨天"].includes(short)
			? `${short} · 周${weekday}`
			: `${m.format("YYYY-MM-DD")} · 周${weekday}`;
		if (overdue) label += " · 已过期";
		return label;
	}

	/* ---------- 文件写回 ---------- */

	async toggleTask(task: TodoTask): Promise<void> {
		const lines = (await this.app.vault.read(task.file)).split("\n");
		const re = /(\s*[-*]\s+\[)[ xX](\])/;
		if (task.line >= lines.length || !re.test(lines[task.line])) {
			new Notice("笔记内容有变动，已为你刷新");
			await this.refreshTasks();
			return;
		}
		lines[task.line] = lines[task.line].replace(
			re,
			`$1${task.checked ? " " : "x"}$2`
		);
		await this.app.vault.modify(task.file, lines.join("\n"));
		await this.refreshTasks();
	}

	async updateTask(
		old: TodoTask,
		next: TaskDraft
	): Promise<void> {
		const lines = (await this.app.vault.read(old.file)).split("\n");
		const replacement = buildTaskLines({
			...next,
			checked: old.checked,
			indent: old.indent,
		});
		lines.splice(old.line, old.endLine - old.line + 1, ...replacement);
		await this.app.vault.modify(old.file, lines.join("\n"));
		new Notice("已保存修改");
		await this.refreshTasks();
	}

	async deleteTask(task: TodoTask): Promise<void> {
		const lines = (await this.app.vault.read(task.file)).split("\n");
		lines.splice(task.line, task.endLine - task.line + 1);
		await this.app.vault.modify(task.file, lines.join("\n"));
		new Notice("已删除任务");
		await this.refreshTasks();
	}

	private openTaskFile(task: TodoTask): void {
		this.app.workspace.getLeaf(false).openFile(task.file, {
			eState: { line: task.line },
		});
	}
}
