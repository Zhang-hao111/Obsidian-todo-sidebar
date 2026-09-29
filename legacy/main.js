"use strict";

// Todo Sidebar v2
// 在 v1（日期分组、勾选回写、新建）之上新增：
//   - 详细描述：任务行下方缩进更深的行即为描述，随任务一起编辑/删除
//   - 优先级：⏫ 高 / 🔼 中 / 🔽 低，影响排序，红点/橙点/蓝点标识
//   - 编辑 / 删除任务（删除有确认弹窗）
//   - 搜索（标题和描述）
//   - 「已完成」选项卡，可取消勾选恢复任务
//   - 文件被外部改动（手动编辑、GNOME 顶栏勾选）时自动刷新
//   - 全新 macOS 风格 UI：卡片、圆形勾选框、分段选项卡
//
// 行格式保持和系统顶栏扩展、日历同步脚本兼容：
//   - [ ] 任务文本 ⏫ 📅 2026-09-29
//       描述行（缩进更深，可选多行）

const {
  Plugin,
  ItemView,
  Modal,
  Setting,
  TFile,
  Notice,
  moment,
  setIcon,
} = require("obsidian");

const VIEW_TYPE = "todo-sidebar-view";
const TODO_FILE = "待办任务.md";
const DATE_EMOJI = "📅";

const PRIORITIES = [
  { key: "high", emoji: "⏫", label: "高", color: "#ff3b30" },
  { key: "medium", emoji: "🔼", label: "中", color: "#ff9500" },
  { key: "low", emoji: "🔽", label: "低", color: "#0a84ff" },
];
const EMOJI_TO_PRIORITY = { "⏫": "high", "🔺": "high", "🔼": "medium", "🔽": "low", "⏬": "low" };
const PRIORITY_ORDER = { high: 0, medium: 1, low: 2 };

/* ===================== 解析 / 生成 ===================== */

const TASK_RE = /^(\s*)[-*]\s+\[([ xX])\]\s+(.*)$/;
const DATE_RE = /📅\s*(\d{4}-\d{2}-\d{2})/;

function parseTasksInContent(content, file) {
  const lines = content.split("\n");
  const tasks = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(TASK_RE);
    if (!m) continue;
    const indent = m[1];
    let rest = m[3];

    let date = null;
    const dm = rest.match(DATE_RE);
    if (dm) {
      date = dm[1];
      rest = rest.replace(dm[0], " ");
    }

    let priority = null;
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
    const descLines = [];
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

function buildTaskLines(t) {
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

function priorityRank(t) {
  return t.priority ? PRIORITY_ORDER[t.priority] : 3;
}

function sortTasks(tasks) {
  return tasks.sort((a, b) => {
    const pa = priorityRank(a);
    const pb = priorityRank(b);
    if (pa !== pb) return pa - pb;
    return a.text.localeCompare(b.text, "zh");
  });
}

/* ===================== 日期选择器（macOS 风） ===================== */

const WEEKDAYS_CN = ["一", "二", "三", "四", "五", "六", "日"];

function fmtDate(d) {
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

function parseDateStr(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
  if (!m) return null;
  return new Date(+m[1], +m[2] - 1, +m[3]);
}

// 生成 6×7 的月历格子，周一开头，前后补相邻月份的灰显天
function buildMonthGrid(year, month) {
  const first = new Date(year, month, 1);
  const startWeekday = (first.getDay() + 6) % 7; // getDay() 0=周日 → 转成周一=0
  const start = new Date(year, month, 1 - startWeekday);
  const cells = [];
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

class DatePickerPopup {
  constructor(anchorEl, initialDate, onPick, onClose) {
    this.anchorEl = anchorEl;
    this.onPick = onPick;
    this.onCloseCb = onClose;
    this.selected = initialDate || null;
    const base = parseDateStr(initialDate) || new Date();
    this.viewYear = base.getFullYear();
    this.viewMonth = base.getMonth();
    this.el = null;
    this._onDocDown = (e) => {
      if (this.el && (this.el.contains(e.target) || this.anchorEl.contains(e.target)))
        return;
      this.close();
    };
    this._onKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        e.preventDefault();
        this.close();
      }
    };
  }

  open() {
    this.el = document.createElement("div");
    this.el.className = "todo-datepicker";
    document.body.appendChild(this.el);
    this.renderAll();
    this.position();
    document.addEventListener("mousedown", this._onDocDown, true);
    document.addEventListener("keydown", this._onKeyDown, true);
  }

  position() {
    const rect = this.anchorEl.getBoundingClientRect();
    const el = this.el;
    const h = el.offsetHeight || 280;
    let top = rect.bottom + 6;
    if (top + h > window.innerHeight - 8) top = Math.max(8, rect.top - h - 6);
    let left = Math.min(rect.left, window.innerWidth - (el.offsetWidth || 236) - 8);
    el.style.top = top + "px";
    el.style.left = Math.max(8, left) + "px";
  }

  renderAll() {
    this.el.empty();

    const header = this.el.createDiv({ cls: "todo-datepicker-header" });
    header.createSpan({
      cls: "todo-datepicker-title",
      text: `${this.viewYear}年${this.viewMonth + 1}月`,
    });
    const nav = header.createDiv({ cls: "todo-datepicker-nav" });
    // 注意：弹层挂在 document.body 下，不能用 <button>——Cupertino 等主题
    // 对 button 有全局样式（如 padding:5px 17px），会把格子撑出弹层外。
    // 一律用 div 避开主题选择器。
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

    const weekdays = this.el.createDiv({ cls: "todo-datepicker-weekdays" });
    for (const w of WEEKDAYS_CN) weekdays.createSpan({ text: w });

    const grid = this.el.createDiv({ cls: "todo-datepicker-grid" });
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

    const footer = this.el.createDiv({ cls: "todo-datepicker-footer" });
    const todayBtn = footer.createDiv({ cls: "todo-datepicker-footer-btn", text: "今天" });
    todayBtn.addEventListener("click", () => {
      this.onPick(fmtDate(new Date()));
      this.close();
    });
    const clearBtn = footer.createDiv({ cls: "todo-datepicker-footer-btn", text: "清除" });
    clearBtn.addEventListener("click", () => {
      this.onPick("");
      this.close();
    });
  }

  shiftMonth(delta) {
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

  close() {
    if (!this.el) return;
    document.removeEventListener("mousedown", this._onDocDown, true);
    document.removeEventListener("keydown", this._onKeyDown, true);
    this.el.remove();
    this.el = null;
    if (this.onCloseCb) this.onCloseCb();
  }
}

/* ===================== 弹窗 ===================== */

class TaskModal extends Modal {
  constructor(app, task, onSubmit) {
    super(app);
    this.task = task || null; // null 表示新建
    this.onSubmit = onSubmit;
    this.priorityValue = this.task && this.task.priority ? this.task.priority : null;
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
        this.priorityValue = v || null;
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
      if (evt.target.tagName === "TEXTAREA" && !(evt.ctrlKey || evt.metaKey)) return;
      if (evt.target.tagName === "BUTTON") return;
      evt.preventDefault();
      this.submit();
    });

    setTimeout(() => this.taskInput.focus(), 50);
  }

  setDateValue(v) {
    this.dateValue = v || "";
    if (this.dateDisplay) this.dateDisplay.value = this.dateValue;
  }

  openDatePicker(anchorEl) {
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

  submit() {
    const text = this.taskInput.value.trim();
    if (!text) return;
    this.onSubmit({
      text,
      date: this.dateValue || null,
      priority: this.priorityValue || null,
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
  constructor(app, message, onConfirm) {
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

/* ===================== 侧边栏视图 ===================== */

class TodoSidebarView extends ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.tasks = [];
    this.query = "";
    this.searchOpen = false;
  }

  getViewType() {
    return VIEW_TYPE;
  }

  getDisplayText() {
    return "待办任务";
  }

  getIcon() {
    return "list-checks";
  }

  async onOpen() {
    await this.refreshTasks();
  }

  async onClose() {}

  async refreshTasks() {
    this.tasks = [];
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      const content = await this.app.vault.cachedRead(file);
      this.tasks.push(...parseTasksInContent(content, file));
    }
    this.render();
  }

  iconButton(parent, icon, label) {
    const btn = parent.createEl("button", {
      cls: "todo-icon-btn",
      attr: { "aria-label": label },
    });
    setIcon(btn, icon);
    return btn;
  }

  /* ---------- 渲染骨架 ---------- */

  render() {
    const container = this.containerEl.children[1];
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
          const input = this.containerEl.querySelector(".todo-search input");
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
    const counts = {
      "has-date": this.tasks.filter((t) => !t.checked && t.date).length,
      "no-date": this.tasks.filter((t) => !t.checked && !t.date).length,
      done: this.tasks.filter((t) => t.checked).length,
    };
    const TAB_LABELS = { "has-date": "有日期", "no-date": "无日期", done: "已完成" };
    const tabs = container.createDiv({ cls: "todo-tabs" });
    for (const key of Object.keys(TAB_LABELS)) {
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
  renderSummary(parent) {
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

  filteredTasks() {
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

  renderList(listEl) {
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
      const grouped = new Map();
      for (const t of tasks) {
        if (!grouped.has(t.date)) grouped.set(t.date, []);
        grouped.get(t.date).push(t);
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
        gh.createSpan({ cls: "todo-group-count", text: String(grouped.get(d).length) });
        for (const t of sortTasks(grouped.get(d))) this.renderTask(group, t);
      }
    } else {
      for (const t of sortTasks(tasks)) this.renderTask(listEl, t);
    }
  }

  renderTask(parent, task) {
    const card = parent.createDiv({ cls: `todo-card ${task.checked ? "is-done" : ""}` });

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

  formatDateShort(dateStr) {
    const m = moment(dateStr, "YYYY-MM-DD");
    const today = moment();
    if (m.isSame(today, "day")) return "今天";
    if (m.isSame(today.clone().add(1, "day"), "day")) return "明天";
    if (m.isSame(today.clone().subtract(1, "day"), "day")) return "昨天";
    return m.format("MM-DD");
  }

  formatDateDisplay(dateStr, overdue) {
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

  async toggleTask(task) {
    const lines = (await this.app.vault.read(task.file)).split("\n");
    const re = /(\s*[-*]\s+\[)[ xX](\])/;
    if (task.line >= lines.length || !re.test(lines[task.line])) {
      new Notice("笔记内容有变动，已为你刷新");
      await this.refreshTasks();
      return;
    }
    lines[task.line] = lines[task.line].replace(re, `$1${task.checked ? " " : "x"}$2`);
    await this.app.vault.modify(task.file, lines.join("\n"));
    await this.refreshTasks();
  }

  async updateTask(old, next) {
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

  async deleteTask(task) {
    const lines = (await this.app.vault.read(task.file)).split("\n");
    lines.splice(task.line, task.endLine - task.line + 1);
    await this.app.vault.modify(task.file, lines.join("\n"));
    new Notice("已删除任务");
    await this.refreshTasks();
  }

  openTaskFile(task) {
    this.app.workspace.getLeaf(false).openFile(task.file, {
      eState: { line: task.line },
    });
  }
}

/* ===================== 插件主体 ===================== */

const DEFAULT_SETTINGS = { selectedTab: "has-date" };

module.exports = class TodoSidebarPlugin extends Plugin {
  async onload() {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());

    this.registerView(VIEW_TYPE, (leaf) => new TodoSidebarView(leaf, this));

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
    this._refreshTimer = null;
    this.registerEvent(
      this.app.vault.on("modify", () => {
        clearTimeout(this._refreshTimer);
        this._refreshTimer = setTimeout(() => this.refreshAllViews(), 300);
      })
    );
  }

  onunload() {
    this.app.workspace.detachLeavesOfType(VIEW_TYPE);
  }

  async saveSettings() {
    await this.saveData(this.settings);
  }

  async activateView() {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }

  async refreshAllViews() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW_TYPE)) {
      await leaf.view.refreshTasks();
    }
  }

  openTaskModal(task, view) {
    new TaskModal(this.app, task || null, async (data) => {
      if (task && view) {
        await view.updateTask(task, data);
      } else {
        await this.appendTodo(data);
      }
      await this.refreshAllViews();
    }).open();
  }

  confirmDelete(task, onConfirm) {
    new ConfirmModal(
      this.app,
      `删除任务「${task.text}」？这会直接修改笔记文件。`,
      onConfirm
    ).open();
  }

  async appendTodo(data) {
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
};
