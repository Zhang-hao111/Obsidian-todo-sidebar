import { ItemView, TFile, WorkspaceLeaf, moment } from "obsidian";

export const VIEW_TYPE_TODO_SIDEBAR = "todo-sidebar-view";

export interface TodoTask {
	text: string;
	date: string;
	file: TFile;
	line: number;
	checked: boolean;
	rawText: string;
}

export class TodoSidebarView extends ItemView {
	private tasks: TodoTask[] = [];
	private selectedDate: string = "has-date";

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
			const lines = content.split("\n");

			for (let i = 0; i < lines.length; i++) {
				const match = lines[i].match(
					/^(\s*)[-*]\s+\[([ xX])\]\s+(.*?)(?:\s+📅\s+(\d{4}-\d{2}-\d{2}))?\s*$/
				);
				if (match) {
					const date = match[4] || "无日期";
					this.tasks.push({
						text: match[3].trim(),
						date,
						file,
						line: i,
						checked: match[2] !== " ",
						rawText: lines[i],
					});
				}
			}
		}

		this.render();
	}

	private getDateKeys(): string[] {
		const dateSet = new Set<string>();
		for (const t of this.tasks) {
			dateSet.add(t.date);
		}
		const dates = Array.from(dateSet);
		const realDates = dates
			.filter((d) => d !== "无日期")
			.sort((a, b) => a.localeCompare(b));
		const noDate = dates.includes("无日期") ? ["无日期"] : [];
		return [...realDates, ...noDate];
	}

	private render(): void {
		const container = this.containerEl.children[1];
		container.empty();
		container.addClass("todo-sidebar-container");

		// Header
		const header = container.createDiv({ cls: "todo-sidebar-header" });
		header.createEl("h3", { text: "待办任务" });

		const headerActions = header.createDiv({ cls: "todo-header-actions" });

		const addBtn = headerActions.createEl("button", {
			cls: "todo-sidebar-btn",
			attr: { "aria-label": "新建待办" },
		});
		addBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"></line><line x1="5" y1="12" x2="19" y2="12"></line></svg>`;
		addBtn.addEventListener("click", () => {
			(this.app as any).commands?.executeCommandById?.("obsidian-todo-sidebar:add-todo");
		});

		const refreshBtn = headerActions.createEl("button", {
			cls: "todo-sidebar-btn",
			attr: { "aria-label": "刷新" },
		});
		refreshBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path></svg>`;
		refreshBtn.addEventListener("click", () => this.refreshTasks());

		// Date filter row
		const dateRow = container.createDiv({ cls: "todo-date-row" });
		const dateKeys = this.getDateKeys();

		const makeDateBtn = (key: string, label: string) => {
			const count = (
				key === "has-date"
					? this.tasks.filter((t) => t.date !== "无日期")
					: this.tasks.filter((t) => t.date === key)
			).length;
			const btn = dateRow.createEl("button", {
				cls: `todo-date-btn ${this.selectedDate === key ? "active" : ""}`,
				text: `${label} ${count}`,
			});
			btn.addEventListener("click", () => {
				this.selectedDate = key;
				this.render();
			});
		};

		makeDateBtn("has-date", "有日期");

		for (const dateKey of dateKeys) {
			const label = dateKey === "无日期" ? "无日期" : this.formatDateShort(dateKey);
			const count = this.tasks.filter((t) => t.date === dateKey).length;
			const btn = dateRow.createEl("button", {
				cls: `todo-date-btn ${this.selectedDate === dateKey ? "active" : ""}`,
				text: `${label} ${count}`,
			});
			btn.addEventListener("click", () => {
				this.selectedDate = dateKey;
				this.render();
			});
		}

		// Task list
		const list = container.createDiv({ cls: "todo-sidebar-list" });

		let filtered = this.tasks;

		if (this.selectedDate === "has-date") {
			filtered = filtered.filter((t) => t.date !== "无日期");
		} else {
			filtered = filtered.filter((t) => t.date === this.selectedDate);
		}

		if (filtered.length === 0) {
			list.createDiv({ cls: "todo-empty", text: "没有待办任务" });
			return;
		}

		// Group by date
		const grouped = new Map<string, TodoTask[]>();
		for (const task of filtered) {
			if (!grouped.has(task.date)) grouped.set(task.date, []);
			grouped.get(task.date)!.push(task);
		}

		const sortedDates = Array.from(grouped.keys()).sort((a, b) => {
			if (a === "无日期") return 1;
			if (b === "无日期") return -1;
			return a.localeCompare(b);
		});

		for (const dateKey of sortedDates) {
			const tasks = grouped.get(dateKey)!;
			this.renderDateGroup(list, dateKey, tasks);
		}
	}

	private renderDateGroup(
		container: Element,
		dateKey: string,
		tasks: TodoTask[]
	): void {
		const dateGroup = container.createDiv({ cls: "todo-date-group" });
		const dateHeader = dateGroup.createDiv({ cls: "todo-date-header" });

		const dateLabel =
			dateKey === "无日期" ? "无日期" : this.formatDateDisplay(dateKey);
		dateHeader.createSpan({ cls: "todo-date-label", text: dateLabel });
		dateHeader.createSpan({
			cls: "todo-date-count",
			text: `${tasks.filter((t) => !t.checked).length}/${tasks.length}`,
		});

		for (const task of tasks) {
			const item = dateGroup.createDiv({
				cls: `todo-item ${task.checked ? "todo-done" : ""}`,
			});

			const checkbox = item.createEl("input", {
				type: "checkbox",
				cls: "todo-checkbox",
			});
			checkbox.checked = task.checked;
			checkbox.addEventListener("change", async () => {
				await this.toggleTask(task);
			});

			const textEl = item.createDiv({ cls: "todo-text" });
			textEl.setText(task.text);

			const fileTag = item.createDiv({ cls: "todo-file-tag" });
			fileTag.setText(task.file.basename);

			item.addEventListener("click", (e) => {
				if ((e.target as HTMLElement).tagName !== "INPUT") {
					this.openTaskFile(task);
				}
			});
		}
	}

	private formatDateShort(dateStr: string): string {
		const m = moment(dateStr, "YYYY-MM-DD");
		const today = moment();
		if (m.isSame(today, "day")) return "今天";
		if (m.isSame(today.clone().subtract(1, "day"), "day")) return "昨天";
		if (m.isSame(today.clone().add(1, "day"), "day")) return "明天";
		return m.format("MM/DD");
	}

	private formatDateDisplay(dateStr: string): string {
		const m = moment(dateStr, "YYYY-MM-DD");
		const label = this.formatDateShort(dateStr);
		const weekday = ["日", "一", "二", "三", "四", "五", "六"][m.day()];
		if (label === "今天" || label === "昨天" || label === "明天") {
			return `${label} · 周${weekday}`;
		}
		return `${m.format("YYYY-MM-DD")} · 周${weekday}`;
	}

	async toggleTask(task: TodoTask): Promise<void> {
		const content = await this.app.vault.read(task.file);
		const lines = content.split("\n");
		const line = lines[task.line];

		const newChecked = !task.checked;
		const newLine = line.replace(
			/(\s*[-*]\s+\[)[ xX](\])/,
			`$1${newChecked ? "x" : " "}$2`
		);
		lines[task.line] = newLine;

		await this.app.vault.modify(task.file, lines.join("\n"));
		await this.refreshTasks();
	}

	private openTaskFile(task: TodoTask): void {
		const leaf = this.app.workspace.getLeaf(false);
		leaf.openFile(task.file, {
			eState: {
				line: task.line,
			},
		});
	}
}
