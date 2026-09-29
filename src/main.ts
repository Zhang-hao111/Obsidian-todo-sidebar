import { App, Modal, Notice, Plugin, Setting, TFile, setIcon } from "obsidian";
import { DatePickerPopup } from "./datepicker";
import { TodoSidebarView, VIEW_TYPE_TODO_SIDEBAR } from "./view";
import {
	buildTaskLines,
	PRIORITIES,
	DEFAULT_SETTINGS,
	TODO_FILE,
	// types
	type Priority,
	type TaskDraft,
	type TodoSidebarSettings,
	type TodoTask,
} from "./task";

/* ===================== 弹窗 ===================== */

class TaskModal extends Modal {
	private task: TodoTask | null; // null 表示新建
	private onSubmit: (data: TaskDraft) => void;
	private priorityValue: Priority | null;
	private taskInput!: HTMLInputElement;
	private descInput!: HTMLTextAreaElement;
	private dateValue = "";
	private dateDisplay: HTMLInputElement | null = null;
	private datePicker: DatePickerPopup | null = null;

	constructor(app: App, task: TodoTask | null, onSubmit: (data: TaskDraft) => void) {
		super(app);
		this.task = task;
		this.onSubmit = onSubmit;
		this.priorityValue = task && task.priority ? task.priority : null;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.addClass("todo-modal");
		contentEl.createEl("h2", { text: this.task ? "编辑待办" : "新建待办" });

		new Setting(contentEl).setName("任务内容").addText((text) => {
			this.taskInput = text.inputEl;
			text.setPlaceholder("例如：完成项目报告");
			if (this.task) text.setValue(this.task.text);
			text.inputEl.style.width = "100%";
		});

		this.dateValue = this.task && this.task.date ? this.task.date : "";
		const dateSetting = new Setting(contentEl)
			.setName("截止日期")
			.setDesc("留空表示无截止日期");
		const fieldWrap = dateSetting.controlEl.createDiv({ cls: "todo-date-field" });
		const calIcon = fieldWrap.createSpan({ cls: "todo-date-field-icon" });
		setIcon(calIcon, "calendar");
		this.dateDisplay = fieldWrap.createEl("input", {
			attr: { type: "text", placeholder: "选择日期", readonly: "readonly" },
		});
		this.dateDisplay.value = this.dateValue;
		fieldWrap.addEventListener("click", () => this.openDatePicker(fieldWrap));
		// 弹窗在 body 层，button 会吃到主题的全局 button 样式，用 div
		const clearBtn = dateSetting.controlEl.createDiv({
			cls: "todo-date-clear-btn",
			attr: { "aria-label": "清除日期" },
		});
		setIcon(clearBtn, "x");
		clearBtn.addEventListener("click", () => {
			this.setDateValue("");
		});

		new Setting(contentEl).setName("优先级").addDropdown((dd) => {
			dd.addOption("", "无");
			for (const p of PRIORITIES) dd.addOption(p.key, `${p.label} ${p.emoji}`);
			dd.setValue(this.priorityValue || "");
			dd.onChange((v) => {
				this.priorityValue = (v || null) as Priority | null;
			});
		});

		new Setting(contentEl)
			.setName("详细描述")
			.setDesc("可选，会以缩进小字保存在任务下方")
			.addTextArea((ta) => {
				this.descInput = ta.inputEl;
				ta.setPlaceholder("补充细节、链接、验收标准……");
				if (this.task && this.task.description) ta.setValue(this.task.description);
				ta.inputEl.rows = 3;
				ta.inputEl.style.width = "100%";
			});

		const btnRow = contentEl.createDiv({ cls: "todo-modal-actions" });
		const submitBtn = btnRow.createEl("button", {
			text: this.task ? "保存" : "添加",
			cls: "mod-cta",
		});
		submitBtn.addEventListener("click", () => this.submit());
		const cancelBtn = btnRow.createEl("button", { text: "取消" });
		cancelBtn.addEventListener("click", () => this.close());

		contentEl.addEventListener("keydown", (evt) => {
			if (evt.key !== "Enter") return;
			// 描述框里 Enter 换行，Ctrl/Cmd+Enter 提交
			const target = evt.target as HTMLElement;
			if (target.tagName === "TEXTAREA" && !(evt.ctrlKey || evt.metaKey)) return;
			if (target.tagName === "BUTTON") return;
			evt.preventDefault();
			this.submit();
		});

		setTimeout(() => this.taskInput.focus(), 50);
	}

	private setDateValue(v: string): void {
		this.dateValue = v || "";
		if (this.dateDisplay) this.dateDisplay.value = this.dateValue;
	}

	private openDatePicker(anchorEl: HTMLElement): void {
		if (this.datePicker) {
			this.datePicker.close();
			this.datePicker = null;
			return;
		}
		this.datePicker = new DatePickerPopup(
			anchorEl,
			this.dateValue || null,
			(v) => this.setDateValue(v),
			() => {
				this.datePicker = null;
			}
		);
		this.datePicker.open();
	}

	private submit(): void {
		const text = this.taskInput.value.trim();
		if (!text) return;
		this.onSubmit({
			text,
			date: this.dateValue || null,
			priority: this.priorityValue,
			description: this.descInput.value.trim(),
		});
		this.close();
	}

	onClose() {
		if (this.datePicker) {
			this.datePicker.close();
			this.datePicker = null;
		}
		this.contentEl.empty();
	}
}

class ConfirmModal extends Modal {
	private message: string;
	private onConfirm: () => void;

	constructor(app: App, message: string, onConfirm: () => void) {
		super(app);
		this.message = message;
		this.onConfirm = onConfirm;
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "确认删除" });
		contentEl.createEl("p", { text: this.message });
		const row = contentEl.createDiv({ cls: "todo-modal-actions" });
		const yes = row.createEl("button", { text: "删除", cls: "mod-warning" });
		yes.addEventListener("click", () => {
			this.onConfirm();
			this.close();
		});
		const no = row.createEl("button", { text: "取消" });
		no.addEventListener("click", () => this.close());
	}

	onClose() {
		this.contentEl.empty();
	}
}

/* ===================== 插件主体 ===================== */

export default class TodoSidebarPlugin extends Plugin {
	settings!: TodoSidebarSettings;
	private refreshTimer: number | null = null;

	async onload() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		) as TodoSidebarSettings;

		this.registerView(
			VIEW_TYPE_TODO_SIDEBAR,
			(leaf) => new TodoSidebarView(leaf, this)
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
			callback: () => this.openTaskModal(null, null),
		});

		// 文件被外部改动时自动刷新（手动编辑笔记、GNOME 顶栏勾选等），300ms 防抖
		this.registerEvent(
			this.app.vault.on("modify", () => {
				if (this.refreshTimer !== null) window.clearTimeout(this.refreshTimer);
				this.refreshTimer = window.setTimeout(() => this.refreshAllViews(), 300);
			})
		);
	}

	onunload() {
		this.app.workspace.detachLeavesOfType(VIEW_TYPE_TODO_SIDEBAR);
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	async activateView() {
		const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_SIDEBAR);
		if (existing.length > 0) {
			this.app.workspace.revealLeaf(existing[0]);
			return;
		}
		const leaf = this.app.workspace.getRightLeaf(false);
		if (leaf) {
			await leaf.setViewState({ type: VIEW_TYPE_TODO_SIDEBAR, active: true });
			this.app.workspace.revealLeaf(leaf);
		}
	}

	async refreshAllViews() {
		for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE_TODO_SIDEBAR)) {
			await (leaf.view as TodoSidebarView).refreshTasks();
		}
	}

	openTaskModal(task: TodoTask | null, view: TodoSidebarView | null) {
		new TaskModal(this.app, task, async (data) => {
			if (task && view) {
				await view.updateTask(task, data);
			} else {
				await this.appendTodo(data);
			}
			await this.refreshAllViews();
		}).open();
	}

	confirmDelete(task: TodoTask, onConfirm: () => void) {
		new ConfirmModal(
			this.app,
			`删除任务「${task.text}」？这会直接修改笔记文件。`,
			onConfirm
		).open();
	}

	async appendTodo(data: TaskDraft) {
		const lines = buildTaskLines({ ...data, checked: false, indent: "" });
		const existing = this.app.vault.getAbstractFileByPath(TODO_FILE);
		if (existing instanceof TFile) {
			const content = await this.app.vault.read(existing);
			await this.app.vault.modify(
				existing,
				content.replace(/\s*$/, "") + "\n" + lines.join("\n") + "\n"
			);
		} else {
			await this.app.vault.create(TODO_FILE, lines.join("\n") + "\n");
		}
	}
}
