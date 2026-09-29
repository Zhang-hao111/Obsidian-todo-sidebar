import { setIcon } from "obsidian";
import { buildMonthGrid, fmtDate, parseDateStr } from "./task";

const WEEKDAYS_CN = ["一", "二", "三", "四", "五", "六", "日"];

/**
 * 挂在 document.body 下的月历弹层。
 * 注意：不能用 <button>——Cupertino 等主题对 button 有全局样式
 * （如 padding:5px 17px），会把格子撑出弹层外。一律用 div 避开主题选择器。
 */
export class DatePickerPopup {
	private anchorEl: HTMLElement;
	private onPick: (date: string) => void;
	private onCloseCb: (() => void) | null;
	private selected: string | null;
	private viewYear: number;
	private viewMonth: number;
	private el: HTMLDivElement | null = null;

	private _onDocDown = (e: MouseEvent) => {
		const target = e.target as Node;
		if (
			this.el &&
			(this.el.contains(target) || this.anchorEl.contains(target))
		)
			return;
		this.close();
	};

	private _onKeyDown = (e: KeyboardEvent) => {
		if (e.key === "Escape") {
			e.stopPropagation();
			e.preventDefault();
			this.close();
		}
	};

	constructor(
		anchorEl: HTMLElement,
		initialDate: string | null,
		onPick: (date: string) => void,
		onClose?: () => void
	) {
		this.anchorEl = anchorEl;
		this.onPick = onPick;
		this.onCloseCb = onClose || null;
		this.selected = initialDate || null;
		const base = parseDateStr(initialDate) || new Date();
		this.viewYear = base.getFullYear();
		this.viewMonth = base.getMonth();
	}

	open(): void {
		this.el = document.createElement("div");
		this.el.className = "todo-datepicker";
		document.body.appendChild(this.el);
		this.renderAll();
		this.position();
		document.addEventListener("mousedown", this._onDocDown, true);
		document.addEventListener("keydown", this._onKeyDown, true);
	}

	private position(): void {
		const el = this.el;
		if (!el) return;
		const rect = this.anchorEl.getBoundingClientRect();
		const h = el.offsetHeight || 280;
		let top = rect.bottom + 6;
		if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
		let left = Math.min(rect.left, window.innerWidth - (el.offsetWidth || 236) - 8);
		el.style.top = top + "px";
		el.style.left = Math.max(8, left) + "px";
	}

	private renderAll(): void {
		const el = this.el;
		if (!el) return;
		el.empty();

		const header = el.createDiv({ cls: "todo-datepicker-header" });
		header.createSpan({
			cls: "todo-datepicker-title",
			text: `${this.viewYear}年${this.viewMonth + 1}月`,
		});
		const nav = header.createDiv({ cls: "todo-datepicker-nav" });
		const prev = nav.createDiv({
			cls: "todo-datepicker-nav-btn",
			attr: { "aria-label": "上个月" },
		});
		setIcon(prev, "chevron-left");
		prev.addEventListener("click", () => this.shiftMonth(-1));
		const next = nav.createDiv({
			cls: "todo-datepicker-nav-btn",
			attr: { "aria-label": "下个月" },
		});
		setIcon(next, "chevron-right");
		next.addEventListener("click", () => this.shiftMonth(1));

		const weekdays = el.createDiv({ cls: "todo-datepicker-weekdays" });
		for (const w of WEEKDAYS_CN) weekdays.createSpan({ text: w });

		const grid = el.createDiv({ cls: "todo-datepicker-grid" });
		const todayStr = fmtDate(new Date());
		for (const cell of buildMonthGrid(this.viewYear, this.viewMonth)) {
			let cls = "todo-datepicker-day";
			if (!cell.inMonth) cls += " is-out";
			if (cell.date === todayStr) cls += " is-today";
			if (this.selected && cell.date === this.selected) cls += " is-selected";
			const day = grid.createDiv({ cls, text: String(cell.day) });
			day.addEventListener("click", () => {
				this.onPick(cell.date);
				this.close();
			});
		}

		const footer = el.createDiv({ cls: "todo-datepicker-footer" });
		const todayBtn = footer.createDiv({
			cls: "todo-datepicker-footer-btn",
			text: "今天",
		});
		todayBtn.addEventListener("click", () => {
			this.onPick(fmtDate(new Date()));
			this.close();
		});
		const clearBtn = footer.createDiv({
			cls: "todo-datepicker-footer-btn",
			text: "清除",
		});
		clearBtn.addEventListener("click", () => {
			this.onPick("");
			this.close();
		});
	}

	private shiftMonth(delta: number): void {
		this.viewMonth += delta;
		if (this.viewMonth < 0) {
			this.viewMonth = 11;
			this.viewYear--;
		}
		if (this.viewMonth > 11) {
			this.viewMonth = 0;
			this.viewYear++;
		}
		this.renderAll();
	}

	close(): void {
		if (!this.el) return;
		document.removeEventListener("mousedown", this._onDocDown, true);
		document.removeEventListener("keydown", this._onKeyDown, true);
		this.el.remove();
		this.el = null;
		if (this.onCloseCb) this.onCloseCb();
	}
}
