import { App, Modal, Plugin, Setting, TFile, WorkspaceLeaf, moment } from "obsidian";
import { TodoSidebarView, VIEW_TYPE_TODO_SIDEBAR } from "./view";

class AddTodoModal extends Modal {
	private dateInput!: HTMLInputElement;
	private taskInput!: HTMLInputElement;
	private onSubmit: (task: string, date: string) => void;

	constructor(app: App, onSubmit: (task: string, date: string) => void) {
		super(app);
		this.onSubmit = onSubmit;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "新建待办" });

		// Task input
		new Setting(contentEl)
			.setName("任务内容")
			.setDesc("输入待办事项")
			.addText((text) => {
				this.taskInput = text.inputEl;
				text.setPlaceholder("例如：完成项目报告");
				text.inputEl.style.width = "100%";
			});

		// Date input
		new Setting(contentEl)
			.setName("截止日期")
			.setDesc("选择日期")
			.addText((text) => {
				this.dateInput = text.inputEl;
				text.inputEl.type = "date";
				text.inputEl.value = moment().format("YYYY-MM-DD");
			});

		// Quick date buttons
		const quickRow = contentEl.createDiv({ cls: "todo-modal-quick-dates" });
		const quickDates = [
			{ label: "今天", offset: 0 },
			{ label: "明天", offset: 1 },
			{ label: "后天", offset: 2 },
			{ label: "下周一", offset: null },
		];

		for (const qd of quickDates) {
			const btn = quickRow.createEl("button", {
				text: qd.label,
				cls: "todo-modal-quick-btn",
			});
			btn.addEventListener("click", () => {
				if (qd.offset !== null) {
					this.dateInput.value = moment()
						.add(qd.offset, "days")
						.format("YYYY-MM-DD");
				} else {
					// Next Monday
					const today = moment();
					const daysUntilMonday = ((1 - today.day() + 7) % 7) || 7;
					this.dateInput.value = today
						.add(daysUntilMonday, "days")
						.format("YYYY-MM-DD");
				}
			});
		}

		// Submit button
		const btnRow = contentEl.createDiv({ cls: "todo-modal-actions" });
		const submitBtn = btnRow.createEl("button", {
			text: "添加",
			cls: "mod-cta",
		});
		submitBtn.addEventListener("click", () => {
			const task = this.taskInput.value.trim();
			const date = this.dateInput.value;
			if (task) {
				this.onSubmit(task, date);
				this.close();
			}
		});

		const cancelBtn = btnRow.createEl("button", { text: "取消" });
		cancelBtn.addEventListener("click", () => this.close());

		// Focus task input
		setTimeout(() => this.taskInput.focus(), 50);
	}

	onClose() {
		this.contentEl.empty();
	}
}

export default class TodoSidebarPlugin extends Plugin {
	async onload() {
		this.registerView(
			VIEW_TYPE_TODO_SIDEBAR,
			(leaf: WorkspaceLeaf) => new TodoSidebarView(leaf)
		);

		this.addRibbonIcon("list-checks", "打开待办任务面板", () => {
			this.activateView();
		});

		this.addCommand({
			id: "open-todo-sidebar",
			name: "打开待办任务面板",
			callback: () => this.activateView(),
		});

		this.addCommand({
			id: "add-todo",
			name: "新建待办任务",
			callback: () => this.addNewTodo(),
		});
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TODO_SIDEBAR);
	}

	async activateView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_SIDEBAR);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}

		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({
				type: VIEW_TYPE_TODO_SIDEBAR,
				active: true,
			});
			this.app.workspace.revealLeaf(leaf);
		}
	}

	async addNewTodo() {
		new AddTodoModal(this.app, async (task: string, date: string) => {
			await this.appendTodoToFile(task, date);
			// Refresh sidebar if open
			const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_SIDEBAR);
			for (const leaf of leaves) {
				const view = leaf.view as TodoSidebarView;
				await view.refreshTasks();
			}
		}).open();
	}

	async appendTodoToFile(task: string, date: string) {
		const fileName = `待办/${date}.md`;
		const line = `- [ ] ${task} 📅 ${date}`;

		const existing = this.app.vault.getAbstractFileByPath(fileName);
		if (existing instanceof TFile) {
			const content = await this.app.vault.read(existing);
			await this.app.vault.modify(existing, content + "\n" + line);
		} else {
			// Create directory and file
			const dirPath = "待办";
			const dir = this.app.vault.getAbstractFileByPath(dirPath);
			if (!dir) {
				await this.app.vault.createFolder(dirPath);
			}
			await this.app.vault.create(fileName, line);
		}
	}
}
