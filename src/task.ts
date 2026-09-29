import { TFile } from "obsidian";

// 行格式保持和系统顶栏扩展、日历同步脚本兼容：
//   - [ ] 任务文本 ⏫ 📅 2026-09-29
//       描述行（缩进更深，可选多行）
export const TODO_FILE = "待办任务.md";
export const DATE_EMOJI = "📅";

export type Priority = "high" | "medium" | "low";
export type TabKey = "has-date" | "no-date" | "done";

export interface TodoTask {
	text: string;
	date: string | null;
	priority: Priority | null;
	description: string;
	checked: boolean;
	file: TFile;
	line: number;
	endLine: number;
	indent: string;
}

// 弹窗提交的数据（不含文件位置信息）
export interface TaskDraft {
	text: string;
	date: string | null;
	priority: Priority | null;
	description: string;
}

export interface TodoSidebarSettings {
	selectedTab: TabKey;
}

export const DEFAULT_SETTINGS: TodoSidebarSettings = { selectedTab: "has-date" };

export const PRIORITIES: { key: Priority; emoji: string; label: string; color: string }[] = [
	{ key: "high", emoji: "⏫", label: "高", color: "#ff3b30" },
	{ key: "medium", emoji: "🔼", label: "中", color: "#ff9500" },
	{ key: "low", emoji: "🔽", label: "低", color: "#0a84ff" },
];

export const EMOJI_TO_PRIORITY: Record<string, Priority> = {
	"⏫": "high",
	"🔺": "high",
	"🔼": "medium",
	"🔽": "low",
	"⏬": "low",
};
const PRIORITY_ORDER: Record<Priority, number> = { high: 0, medium: 1, low: 2 };

/* ===================== 解析 / 生成 ===================== */

const TASK_RE = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;
const DATE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;

export function parseTasksInContent(content: string, file: TFile): TodoTask[] {
	const lines = content.split("\n");
	const tasks: TodoTask[] = [];
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(TASK_RE);
		if (!m) continue;
		const indent = m[1];
		let rest = m[3];

		let date: string | null = null;
		const dm = rest.match(DATE_RE);
		if (dm) {
			date = dm[1];
			rest = rest.replace(dm[0], " ");
		}

		let priority: Priority | null = null;
		for (const emoji of Object.keys(EMOJI_TO_PRIORITY)) {
			if (rest.includes(emoji)) {
				priority = EMOJI_TO_PRIORITY[emoji];
				rest = rest.split(emoji).join(" ");
				break;
			}
		}

		const text = rest.replace(/\s+/g, " ").trim();
		if (!text) continue;

		// 描述：紧随其后、缩进更深、且本身不是任务行的非空行
		const descLines: string[] = [];
		let endLine = i;
		while (endLine + 1 < lines.length) {
			const next = lines[endLine + 1];
			if (!next.trim()) break;
			const nextIndent = (next.match(/^\s*/) || [""])[0];
			if (nextIndent.length <= indent.length || TASK_RE.test(next)) break;
			descLines.push(next.trim());
			endLine++;
		}

		tasks.push({
			text,
			date,
			priority,
			description: descLines.join("\n"),
			checked: m[2].toLowerCase() === "x",
			file,
			line: i,
			endLine,
			indent,
		});
	}
	return tasks;
}

export function buildTaskLines(
	t: TaskDraft & { checked: boolean; indent: string }
): string[] {
	let first = `${t.indent || ""}- [${t.checked ? "x" : " "}] ${t.text}`;
	if (t.priority) {
		const p = PRIORITIES.find((x) => x.key === t.priority);
		if (p) first += " " + p.emoji;
	}
	if (t.date) first += ` ${DATE_EMOJI} ${t.date}`;
	const out = [first];
	if (t.description) {
		const descIndent = (t.indent || "") + "    ";
		for (const dl of t.description.split("\n")) {
			if (dl.trim()) out.push(descIndent + dl.trim());
		}
	}
	return out;
}

function priorityRank(t: TodoTask): number {
	return t.priority ? PRIORITY_ORDER[t.priority] : 3;
}

export function sortTasks(tasks: TodoTask[]): TodoTask[] {
	return tasks.sort((a, b) => {
		const pa = priorityRank(a);
		const pb = priorityRank(b);
		if (pa !== pb) return pa - pb;
		return a.text.localeCompare(b.text, "zh");
	});
}

/* ===================== 日期工具（macOS 风日期选择器用） ===================== */

export function fmtDate(d: Date): string {
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const dd = String(d.getDate()).padStart(2, "0");
	return `${d.getFullYear()}-${mm}-${dd}`;
}

export function parseDateStr(s: string | null): Date | null {
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
	if (!m) return null;
	return new Date(+m[1], +m[2] - 1, +m[3]);
}

export interface MonthCell {
	day: number;
	inMonth: boolean;
	date: string;
}

// 生成 6×7 的月历格子，周一开头，前后补相邻月份的灰显天
export function buildMonthGrid(year: number, month: number): MonthCell[] {
	const first = new Date(year, month, 1);
	const startWeekday = (first.getDay() + 6) % 7; // getDay() 0=周日 → 转成周一=0
	const start = new Date(year, month, 1 - startWeekday);
	const cells: MonthCell[] = [];
	for (let i = 0; i < 42; i++) {
		const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
		cells.push({
			day: d.getDate(),
			inMonth: d.getMonth() === month,
			date: fmtDate(d),
		});
	}
	return cells;
}
