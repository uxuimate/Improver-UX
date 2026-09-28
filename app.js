(function () {
  "use strict";

  const Data = window.CalmPlanData;
  const Receipts = window.CalmPlanReceipts;
  if (!Data) throw new Error("CalmPlanData missing — load repository.js first");

  const STORAGE = {
    sessionFp: "payoff.session.fingerprint",
    sessionEmail: "payoff.session.email",
    cred: (fp) => `payoff.cred.${fp}`,
    profile: (uk) => `payoff.profile.${uk}`,
    planner: (uk) => `payoff.planner.${uk}`,
    photo: (uk) => `payoff.photo.${uk}`,
  };

  const TIER_ORDER = { people: 0, overdraft: 1, other: 2 };
  const ROUTES = ["home", "activity", "plan", "reports"];
  const PAGE_META = {
    home: { title: "Home", sub: "This month at a glance" },
    activity: { title: "Activity", sub: "Your ledger" },
    plan: { title: "Plan", sub: "Debts and payoff" },
    reports: { title: "Reports", sub: "Summaries and export" },
  };

  const SAMPLE_DEBTS = [
    { name: "Friend", balance: 600, apr: 0, monthlyPayment: 50, tier: "people", currency: "GBP" },
    { name: "Bank overdraft", balance: 800, apr: 39.9, monthlyPayment: 40, tier: "overdraft", currency: "GBP" },
    { name: "Credit card", balance: 400, apr: 23.9, monthlyPayment: 25, tier: "other", currency: "GBP" },
  ];

  let state = {
    userKey: "guest",
    activeFingerprint: null,
    signedInEmail: null,
    profile: { displayName: "" },
    budget: { income: 0, mustPayBills: 0 },
    incomeItems: [],
    billItems: [],
    monthLog: [],
    businessLog: [],
    loans: [],
    transactions: [],
    debts: [],
    schemaVersion: Data.SCHEMA_VERSION,
    investor: { monthlyStake: 0, bankroll: 0, target: 0, ladderLegs: 7, ladderOdds: 3, completedLegs: [] },
    preferences: { currency: "GBP", gbpPerEur: 0.86 },
  };

  let route = "home";
  let viewMonth = ymNow();
  let reportPeriod = "month";
  let reportAnchor = ymNow();
  let reportScope = "personal";
  let planTab = "debts";
  let selectedStrategy = "avalanche";
  let chartInstance = null;
  let authTab = "signin";
  let txDraft = { type: "expense", scope: "personal", category: "Other", amount: "", date: "", note: "", receiptId: null };
  let pendingReceiptId = null;
  let undoPayload = null;
  let undoTimer = null;
  let pendingFocusTxId = null;
  let pendingFocusDebtId = null;
  let editingTxId = null;
  let editingDebtId = null;
  let activityMonth = ymNow();

  const TYPE_OPTIONS = [
    { value: "", label: "All" },
    { value: "income", label: "Income" },
    { value: "expense", label: "Expense" },
  ];

  function categoryIconName(category, type) {
    const c = String(category || "").toLowerCase();
    if (type === "income") {
      if (/salary|wage/.test(c)) return "banknote";
      if (/self|employ/.test(c)) return "briefcase";
      if (/benefit/.test(c)) return "heart-handshake";
      return "arrow-down-left";
    }
    if (/rent|housing|premis/.test(c)) return "home";
    if (/bill|phone|internet|bank charge/.test(c)) return "receipt";
    if (/food/.test(c)) return "utensils";
    if (/transport|travel/.test(c)) return "car";
    if (/debt/.test(c)) return "landmark";
    if (/office|stock|advert|professional/.test(c)) return "briefcase";
    return type === "expense" ? "arrow-up-right" : "circle";
  }

  function setCSelectOptions(root, options, selectedValue) {
    if (!root) return;
    const menu = root.querySelector(".cselect__menu");
    const hidden = root.querySelector('input[type="hidden"]');
    const valueEl = root.querySelector(".cselect__value");
    if (!menu || !hidden || !valueEl) return;
    const selected = options.find((o) => o.value === selectedValue) || options[0];
    hidden.value = selected ? selected.value : "";
    valueEl.textContent = selected ? selected.label : "All";
    menu.replaceChildren();
    options.forEach((opt) => {
      const li = document.createElement("li");
      li.setAttribute("role", "none");
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cselect__option" + (opt.value === hidden.value ? " is-selected" : "");
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", opt.value === hidden.value ? "true" : "false");
      btn.dataset.value = opt.value;
      btn.textContent = opt.label;
      btn.addEventListener("click", () => {
        hidden.value = opt.value;
        valueEl.textContent = opt.label;
        menu.querySelectorAll(".cselect__option").forEach((b) => {
          const on = b.dataset.value === opt.value;
          b.classList.toggle("is-selected", on);
          b.setAttribute("aria-selected", on ? "true" : "false");
        });
        closeAllCSelects();
        hidden.dispatchEvent(new Event("change", { bubbles: true }));
      });
      li.appendChild(btn);
      menu.appendChild(li);
    });
  }

  function closeAllCSelects() {
    document.querySelectorAll(".cselect").forEach((node) => {
      node.classList.remove("is-open");
      node.querySelector(".cselect__menu")?.classList.add("hidden");
      node.querySelector(".cselect__btn")?.setAttribute("aria-expanded", "false");
    });
  }

  function closeAllCMonths() {
    document.querySelectorAll(".cmonth").forEach((node) => {
      node.classList.remove("is-open");
      node.querySelector(".cmonth__panel")?.classList.add("hidden");
      node.querySelector(".cmonth__btn")?.setAttribute("aria-expanded", "false");
    });
  }

  function closeAllCDays() {
    document.querySelectorAll(".cday").forEach((node) => {
      node.classList.remove("is-open");
      node.querySelector(".cday__panel")?.classList.add("hidden");
      node.querySelector(".cday__btn")?.setAttribute("aria-expanded", "false");
    });
  }

  function closeAllOverlays() {
    closeAllCSelects();
    closeAllCMonths();
    closeAllCDays();
  }

  const MONTH_SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

  function setCMonthValue(root, ym) {
    if (!root) return;
    const hidden = root.querySelector('input[type="hidden"]');
    const valueEl = root.querySelector(".cmonth__value");
    if (!hidden || !valueEl) return;
    hidden.value = ym || "";
    valueEl.textContent = ym ? formatMonthLabel(ym) : "All months";
    root.dataset.viewYear = ym ? ym.slice(0, 4) : String(new Date().getFullYear());
    paintCMonthGrid(root);
  }

  function paintCMonthGrid(root) {
    const grid = root.querySelector(".cmonth__grid");
    const yearLabel = root.querySelector("[data-cmonth-year-label]");
    const hidden = root.querySelector('input[type="hidden"]');
    if (!grid) return;
    const year = Number(root.dataset.viewYear) || new Date().getFullYear();
    if (yearLabel) yearLabel.textContent = String(year);
    const selected = hidden?.value || "";
    const nowYm = ymNow();
    grid.replaceChildren();
    MONTH_SHORT.forEach((label, i) => {
      const ym = `${year}-${String(i + 1).padStart(2, "0")}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cmonth__month";
      if (ym === selected) btn.classList.add("is-selected");
      if (ym === nowYm) btn.classList.add("is-current");
      btn.setAttribute("role", "option");
      btn.setAttribute("aria-selected", ym === selected ? "true" : "false");
      btn.textContent = label;
      btn.addEventListener("click", () => {
        setCMonthValue(root, ym);
        closeAllCMonths();
        renderActivity();
        paintIcons();
      });
      grid.appendChild(btn);
    });
  }

  function bindCMonths() {
    document.querySelectorAll(".cmonth").forEach((root) => {
      if (root.dataset.bound) return;
      root.dataset.bound = "1";
      const btn = root.querySelector(".cmonth__btn");
      const panel = root.querySelector(".cmonth__panel");
      if (!btn || !panel) return;

      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = root.classList.contains("is-open");
        closeAllCSelects();
        closeAllCDays();
        if (!open) {
          if (!root.dataset.viewYear) {
            const v = root.querySelector('input[type="hidden"]')?.value;
            root.dataset.viewYear = v ? v.slice(0, 4) : String(new Date().getFullYear());
          }
          paintCMonthGrid(root);
          root.classList.add("is-open");
          panel.classList.remove("hidden");
          btn.setAttribute("aria-expanded", "true");
          paintIcons();
        }
      });

      root.querySelectorAll("[data-cmonth-year]").forEach((yb) => {
        yb.addEventListener("click", (e) => {
          e.stopPropagation();
          const delta = Number(yb.getAttribute("data-cmonth-year")) || 0;
          const year = (Number(root.dataset.viewYear) || new Date().getFullYear()) + delta;
          root.dataset.viewYear = String(year);
          paintCMonthGrid(root);
          paintIcons();
        });
      });

      root.querySelector("[data-cmonth-clear]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        setCMonthValue(root, "");
        closeAllCMonths();
        renderActivity();
      });

      root.querySelector("[data-cmonth-today]")?.addEventListener("click", (e) => {
        e.stopPropagation();
        setCMonthValue(root, ymNow());
        closeAllCMonths();
        renderActivity();
        paintIcons();
      });

      panel.addEventListener("click", (e) => e.stopPropagation());
    });
  }

  function bindCSelects() {
    document.querySelectorAll(".cselect").forEach((root) => {
      const btn = root.querySelector(".cselect__btn");
      const menu = root.querySelector(".cselect__menu");
      if (!btn || !menu || btn.dataset.bound) return;
      btn.dataset.bound = "1";
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        const open = root.classList.contains("is-open");
        closeAllCMonths();
        closeAllCDays();
        closeAllCSelects();
        if (!open) {
          root.classList.add("is-open");
          menu.classList.remove("hidden");
          btn.setAttribute("aria-expanded", "true");
        }
      });
    });
    document.addEventListener("click", () => closeAllOverlays());
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeAllOverlays();
    });
  }

  function setCDayValue(root, ymd, silent) {
    if (!root) return;
    const hidden = root.querySelector('input[type="hidden"]');
    const valueEl = root.querySelector(".cday__value");
    if (!hidden || !valueEl) return;
    const next = ymd || todayYmd();
    hidden.value = next;
    valueEl.textContent = formatShortDate(next);
    const [y, m] = next.split("-");
    root.dataset.viewYm = `${y}-${m}`;
    paintCDayGrid(root);
    if (!silent) {
      hidden.dispatchEvent(new Event("change", { bubbles: true }));
      if (typeof root._onCDayChange === "function") root._onCDayChange(next);
    }
  }

  function paintCDayGrid(root) {
    const grid = root.querySelector(".cday__grid");
    const label = root.querySelector(".cday__label");
    const weekdays = root.querySelector(".cday__weekdays");
    const hidden = root.querySelector('input[type="hidden"]');
    if (!grid) return;

    const selected = hidden?.value || todayYmd();
    let viewYm = root.dataset.viewYm || selected.slice(0, 7);
    if (!/^\d{4}-\d{2}$/.test(viewYm)) viewYm = selected.slice(0, 7);
    root.dataset.viewYm = viewYm;

    const [vy, vm] = viewYm.split("-").map(Number);
    if (label) label.textContent = formatMonthLabel(viewYm);

    if (weekdays && !weekdays.childElementCount) {
      WEEKDAYS.forEach((d) => {
        const s = document.createElement("span");
        s.textContent = d;
        weekdays.appendChild(s);
      });
    }

    const first = new Date(vy, vm - 1, 1);
    // Monday-first: getDay() Sun=0 → convert
    let startPad = first.getDay() - 1;
    if (startPad < 0) startPad = 6;
    const daysInMonth = new Date(vy, vm, 0).getDate();
    const today = todayYmd();

    grid.replaceChildren();
    for (let i = 0; i < startPad; i++) {
      const empty = document.createElement("span");
      empty.className = "cday__cell cday__cell--empty";
      grid.appendChild(empty);
    }
    for (let day = 1; day <= daysInMonth; day++) {
      const ymd = `${vy}-${String(vm).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cday__cell";
      if (ymd === selected) btn.classList.add("is-selected");
      if (ymd === today) btn.classList.add("is-today");
      btn.textContent = String(day);
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        setCDayValue(root, ymd);
        closeAllCDays();
        paintIcons();
      });
      grid.appendChild(btn);
    }
  }

  function bindCDayRoot(root) {
    if (!root || root.dataset.bound) return;
    root.dataset.bound = "1";
    const btn = root.querySelector(".cday__btn");
    const panel = root.querySelector(".cday__panel");
    if (!btn || !panel) return;

    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const open = root.classList.contains("is-open");
      closeAllCSelects();
      closeAllCMonths();
      closeAllCDays();
      if (!open) {
        const v = root.querySelector('input[type="hidden"]')?.value || todayYmd();
        root.dataset.viewYm = v.slice(0, 7);
        paintCDayGrid(root);
        root.classList.add("is-open");
        panel.classList.remove("hidden");
        btn.setAttribute("aria-expanded", "true");
        paintIcons();
      }
    });

    root.querySelectorAll("[data-cday-nav]").forEach((nb) => {
      nb.addEventListener("click", (e) => {
        e.stopPropagation();
        const delta = Number(nb.getAttribute("data-cday-nav")) || 0;
        const cur = root.dataset.viewYm || todayYmd().slice(0, 7);
        root.dataset.viewYm = shiftYm(cur, delta);
        paintCDayGrid(root);
        paintIcons();
      });
    });

    root.querySelector("[data-cday-today]")?.addEventListener("click", (e) => {
      e.stopPropagation();
      setCDayValue(root, todayYmd());
      closeAllCDays();
      paintIcons();
    });

    panel.addEventListener("click", (e) => e.stopPropagation());
  }

  function bindCDays() {
    document.querySelectorAll(".cday").forEach((root) => bindCDayRoot(root));
  }

  function createCDayPicker(ymd, onChange) {
    const root = document.createElement("div");
    root.className = "cday cday--inline";
    root.innerHTML = `
      <button type="button" class="cday__btn cell-input cell-input--date" aria-haspopup="dialog" aria-expanded="false">
        <span class="cday__value"></span>
        <i data-lucide="calendar" aria-hidden="true"></i>
      </button>
      <div class="cday__panel hidden" role="dialog" aria-label="Choose date">
        <div class="cday__nav">
          <button type="button" class="icon-btn cday__nav-btn" data-cday-nav="-1" aria-label="Previous month"><i data-lucide="chevron-left"></i></button>
          <p class="cday__label"></p>
          <button type="button" class="icon-btn cday__nav-btn" data-cday-nav="1" aria-label="Next month"><i data-lucide="chevron-right"></i></button>
        </div>
        <div class="cday__weekdays" aria-hidden="true"></div>
        <div class="cday__grid" role="grid"></div>
        <div class="cday__footer">
          <button type="button" class="text-link" data-cday-today>Today</button>
        </div>
      </div>
      <input type="hidden" value="" />`;
    root._onCDayChange = onChange;
    bindCDayRoot(root);
    setCDayValue(root, ymd || todayYmd(), true);
    return root;
  }

  const repo = Data.createRepository({
    getState: () => state,
    persist: () => savePlanner(),
  });

  function el(id) {
    return document.getElementById(id);
  }

  function uid() {
    return crypto.randomUUID();
  }

  function paintIcons() {
    if (window.lucide && typeof window.lucide.createIcons === "function") {
      window.lucide.createIcons({
        attrs: {
          "stroke-width": 1.75,
        },
      });
    }
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function ymNow() {
    return new Date().toISOString().slice(0, 7);
  }

  function todayYmd() {
    return new Date().toISOString().slice(0, 10);
  }

  function shiftYm(ym, delta) {
    const [y, m] = ym.split("-").map(Number);
    const d = new Date(y, m - 1 + delta, 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }

  function formatMonthLabel(ym) {
    const [y, m] = ym.split("-").map(Number);
    return new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });
  }

  function formatDayLabel(ymd) {
    return new Date(ymd + "T12:00:00").toLocaleDateString("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function parseMajorInput(raw) {
    const s = String(raw == null ? "" : raw)
      .trim()
      .replace(/£|€|,/g, "")
      .replace(/\s/g, "")
      .replace(",", ".");
    if (!s) return 0;
    const n = Number(s);
    return Number.isFinite(n) && n >= 0 ? n : NaN;
  }

  function mergePreferences(raw) {
    const d = raw && typeof raw === "object" ? raw : {};
    const currency = d.currency === "EUR" ? "EUR" : "GBP";
    let gbpPerEur = Number(d.gbpPerEur);
    if (!Number.isFinite(gbpPerEur) || gbpPerEur <= 0) gbpPerEur = 0.86;
    return { currency, gbpPerEur: round2(gbpPerEur) };
  }

  function displayCurrency() {
    return state.preferences.currency === "EUR" ? "EUR" : "GBP";
  }

  function gbpPerEurRate() {
    const r = Number(state.preferences.gbpPerEur);
    return Number.isFinite(r) && r > 0 ? r : 0.86;
  }

  function formatMoneyMinor(minor, currency) {
    const c = currency === "EUR" ? "EUR" : currency === "GBP" ? "GBP" : displayCurrency();
    const major = Data.fromMinor(minor);
    return new Intl.NumberFormat("en-GB", {
      style: "currency",
      currency: c,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(major);
  }

  function formatMoneyMajor(major, currency) {
    return formatMoneyMinor(Data.toMinor(major), currency);
  }

  function gbpToDisplayMinor(gbpMinor) {
    if (displayCurrency() === "GBP") return gbpMinor;
    return Math.round(gbpMinor / gbpPerEurRate());
  }

  function formatGbpStoredMinor(gbpMinor) {
    return formatMoneyMinor(gbpToDisplayMinor(gbpMinor), displayCurrency());
  }

  function debtAmountToGbpMinor(debt, amountMinor) {
    if ((debt.currency || "GBP") === "GBP") return amountMinor;
    return Math.round(amountMinor * gbpPerEurRate());
  }

  function normalizeTier(t) {
    if (t === "people" || t === "overdraft" || t === "other") return t;
    return "other";
  }

  function kindLabel(kind) {
    if (kind === "person") return "Person";
    if (kind === "bank") return "Bank";
    return "Card/loan";
  }

  function kindFromLabel(raw) {
    const s = String(raw || "")
      .trim()
      .toLowerCase();
    if (!s) return "card_loan";
    if (/person|friend|family|mate|people/.test(s)) return "person";
    if (/bank|overdraft|\bod\b/.test(s)) return "bank";
    if (/card|loan|credit/.test(s)) return "card_loan";
    return "card_loan";
  }

  function blankTxDraft() {
    return {
      type: "expense",
      scope: "personal",
      category: "Other",
      amount: "",
      date: todayYmd(),
      note: "",
      receiptId: null,
    };
  }

  /* —— Auth / storage (local-only) —— */
  function bufToB64(buf) {
    const bytes = new Uint8Array(buf);
    let s = "";
    bytes.forEach((b) => (s += String.fromCharCode(b)));
    return btoa(s);
  }

  function b64ToBuf(b64) {
    const s = atob(b64);
    const bytes = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
    return bytes.buffer;
  }

  async function emailFingerprint(email) {
    const data = new TextEncoder().encode(email.trim().toLowerCase());
    const hash = await crypto.subtle.digest("SHA-256", data);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  async function hashPassword(password, saltBuf) {
    const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
    return crypto.subtle.deriveBits({ name: "PBKDF2", salt: saltBuf, iterations: 120000, hash: "SHA-256" }, key, 256);
  }

  async function saveCredential(fp, password) {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await hashPassword(password, salt.buffer);
    localStorage.setItem(STORAGE.cred(fp), JSON.stringify({ salt: bufToB64(salt.buffer), hash: bufToB64(hash) }));
  }

  async function loadCredential(fp) {
    const raw = localStorage.getItem(STORAGE.cred(fp));
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch (_) {
      return null;
    }
  }

  async function verifyPassword(password, saltB64, hashB64) {
    const derived = await hashPassword(password, b64ToBuf(saltB64));
    return bufToB64(derived) === hashB64;
  }

  function validEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || "").trim());
  }

  function plannerKeyFromSession() {
    if (state.activeFingerprint) return `email.${state.activeFingerprint}`;
    return "guest";
  }

  function paymentFromRaw(p) {
    if (!p || typeof p !== "object") return null;
    const amount = Math.max(0, Number(p.amount) || 0);
    if (amount <= 0) return null;
    let at = typeof p.at === "string" ? p.at.slice(0, 10) : "";
    if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) at = todayYmd();
    return { id: p.id || uid(), amount, at, note: typeof p.note === "string" ? p.note.slice(0, 200) : "" };
  }

  function migrateLoans(loans) {
    if (!Array.isArray(loans)) return [];
    return loans.map((l) => ({
      id: l.id || uid(),
      name: typeof l.name === "string" ? l.name : "",
      balance: Number(l.balance) || 0,
      apr: Number(l.apr) || 0,
      monthlyPayment: Math.max(0, Number(l.monthlyPayment) || (Number(l.minPayment) || 0) + (Number(l.extraMonthly) || 0)),
      tier: normalizeTier(l.tier),
      currency: l.currency === "EUR" ? "EUR" : "GBP",
      payments: Array.isArray(l.payments) ? l.payments.map(paymentFromRaw).filter(Boolean) : [],
    }));
  }

  function lineItemFromRaw(raw) {
    if (!raw || typeof raw !== "object") return { id: uid(), name: "", amount: 0, date: "", done: false };
    return {
      id: raw.id || uid(),
      name: raw.name || "",
      amount: Number(raw.amount) || 0,
      date: typeof raw.date === "string" ? raw.date : "",
      done: !!raw.done,
    };
  }

  function businessEntryFromRaw(raw) {
    if (!raw || typeof raw !== "object") {
      return { id: uid(), label: "", income: 0, expenses: 0, incomeItems: [], expenseItems: [] };
    }
    const incomeItems = Array.isArray(raw.incomeItems)
      ? raw.incomeItems.map((x) => ({ id: x.id || uid(), name: x.name || "", amount: Math.max(0, Number(x.amount) || 0) }))
      : [];
    const expenseItems = Array.isArray(raw.expenseItems)
      ? raw.expenseItems.map((x) => ({ id: x.id || uid(), name: x.name || "", amount: Math.max(0, Number(x.amount) || 0) }))
      : [];
    let income = Math.max(0, Number(raw.income) || 0);
    let expenses = Math.max(0, Number(raw.expenses) || 0);
    if (incomeItems.length) income = round2(incomeItems.reduce((s, x) => s + x.amount, 0));
    if (expenseItems.length) expenses = round2(expenseItems.reduce((s, x) => s + x.amount, 0));
    return {
      id: raw.id || uid(),
      label: typeof raw.label === "string" ? raw.label.slice(0, 40) : "",
      income,
      expenses,
      incomeItems,
      expenseItems,
    };
  }

  function mergeInvestor(raw) {
    return {
      monthlyStake: Math.max(0, Number(raw && raw.monthlyStake) || 0),
      bankroll: Math.max(0, Number(raw && raw.bankroll) || 0),
      target: Math.max(0, Number(raw && raw.target) || 0),
      ladderLegs: 7,
      ladderOdds: 3,
      completedLegs: [],
    };
  }

  /** Rebuild legacy backup fields from the canonical ledger. */
  function syncLegacyFromLedger() {
    const personalInc = state.transactions.filter((t) => t.type === "income" && t.scope === "personal" && !t.debtId);
    const personalExp = state.transactions.filter(
      (t) => t.type === "expense" && t.scope === "personal" && t.category !== "Debt payment" && !t.debtId
    );
    state.incomeItems = personalInc.map((t) => ({
      id: t.id,
      name: t.note || t.category,
      amount: Data.fromMinor(t.amountMinor),
      date: t.date,
      done: false,
    }));
    state.billItems = personalExp.map((t) => ({
      id: t.id,
      name: t.note || t.category,
      amount: Data.fromMinor(t.amountMinor),
      date: t.date,
      done: false,
    }));
    state.budget.income = round2(state.incomeItems.reduce((s, x) => s + (Number(x.amount) || 0), 0));
    state.budget.mustPayBills = round2(state.billItems.reduce((s, x) => s + (Number(x.amount) || 0), 0));

    const bizInc = state.transactions.filter((t) => t.scope === "business" && t.type === "income");
    const bizExp = state.transactions.filter((t) => t.scope === "business" && t.type === "expense");
    const byMonth = {};
    [...bizInc, ...bizExp].forEach((t) => {
      const ym = t.date.slice(0, 7);
      if (!byMonth[ym]) byMonth[ym] = { incomeItems: [], expenseItems: [] };
      const line = { id: t.id, name: t.note || t.category, amount: Data.fromMinor(t.amountMinor) };
      if (t.type === "income") byMonth[ym].incomeItems.push(line);
      else byMonth[ym].expenseItems.push(line);
    });
    state.businessLog = Object.keys(byMonth)
      .sort()
      .map((ym) => {
        const g = byMonth[ym];
        const income = round2(g.incomeItems.reduce((s, x) => s + x.amount, 0));
        const expenses = round2(g.expenseItems.reduce((s, x) => s + x.amount, 0));
        return { id: "biz-" + ym, label: ym, income, expenses, incomeItems: g.incomeItems, expenseItems: g.expenseItems };
      });

    state.loans = state.debts.map((d) => {
      const payments = state.transactions
        .filter((t) => t.debtId === d.id && t.type === "expense")
        .map((t) => ({
          id: t.id,
          amount: Data.fromMinor(t.amountMinor),
          at: t.date,
          note: t.note || "",
        }));
      return Data.legacyLoanFromDebt(d, payments);
    });
    state.schemaVersion = Data.SCHEMA_VERSION;
  }

  function applyPlannerPayload(o) {
    if (!o || typeof o !== "object") return false;
    state.budget = {
      income: Number(o.income) || 0,
      mustPayBills: o.mustPayBills != null ? Number(o.mustPayBills) : Number(o.expenses) || 0,
    };
    state.loans = migrateLoans(o.loans);
    state.incomeItems = Array.isArray(o.incomeItems) ? o.incomeItems.map(lineItemFromRaw) : [];
    state.billItems = Array.isArray(o.billItems) ? o.billItems.map(lineItemFromRaw) : [];
    state.monthLog = Array.isArray(o.monthLog)
      ? o.monthLog.map((m) => ({
          id: m.id || uid(),
          label: m.label || "",
          income: Number(m.income) || 0,
          mustPayBills: Number(m.mustPayBills) || 0,
        }))
      : [];
    state.businessLog = Array.isArray(o.businessLog) ? o.businessLog.map(businessEntryFromRaw) : [];
    state.investor = mergeInvestor(o.investor);
    state.preferences = mergePreferences(o.preferences);

    const migrated = Data.migratePlanner(
      {
        ...o,
        incomeItems: state.incomeItems,
        billItems: state.billItems,
        businessLog: state.businessLog,
        loans: state.loans,
      },
      uid
    );
    state.transactions = migrated.transactions;
    state.debts = migrated.debts;
    state.schemaVersion = Data.SCHEMA_VERSION;
    syncLegacyFromLedger();
    return true;
  }

  function seedGuest() {
    const today = todayYmd();
    state.preferences = mergePreferences(null);
    state.debts = SAMPLE_DEBTS.map((l) =>
      Data.normalizeDebt(
        {
          id: uid(),
          name: l.name,
          kind: Data.tierToKind(l.tier),
          balance: l.balance,
          currency: l.currency,
          ratePercent: l.apr,
          monthlyPayment: l.monthlyPayment,
        },
        uid
      )
    );
    state.transactions = [
      Data.normalizeTransaction(
        {
          id: uid(),
          date: today,
          type: "income",
          amountMinor: 90000,
          currency: "GBP",
          category: "Salary/wages",
          scope: "personal",
          note: "Salary / wages",
        },
        uid
      ),
      Data.normalizeTransaction(
        {
          id: uid(),
          date: today,
          type: "expense",
          amountMinor: 30000,
          currency: "GBP",
          category: "Rent/housing",
          scope: "personal",
          note: "Rent / housing",
        },
        uid
      ),
      Data.normalizeTransaction(
        {
          id: uid(),
          date: today,
          type: "expense",
          amountMinor: 10000,
          currency: "GBP",
          category: "Bills",
          scope: "personal",
          note: "Bills & utilities",
        },
        uid
      ),
    ];
    state.monthLog = [];
    state.investor = mergeInvestor(null);
    syncLegacyFromLedger();
  }

  function loadPlanner() {
    const key = plannerKeyFromSession();
    state.userKey = key;
    const raw = localStorage.getItem(STORAGE.planner(key));
    if (raw) {
      try {
        const o = JSON.parse(raw);
        if (applyPlannerPayload(o)) return;
      } catch (_) {}
    }
    if (key === "guest") seedGuest();
    else {
      state.transactions = [];
      state.debts = [];
      state.incomeItems = [];
      state.billItems = [];
      state.businessLog = [];
      state.monthLog = [];
      state.loans = [];
      state.budget = { income: 0, mustPayBills: 0 };
      state.preferences = mergePreferences(null);
      state.investor = mergeInvestor(null);
    }
  }

  function plannerBlob() {
    syncLegacyFromLedger();
    return {
      schemaVersion: Data.SCHEMA_VERSION,
      income: state.budget.income,
      mustPayBills: state.budget.mustPayBills,
      incomeItems: state.incomeItems,
      billItems: state.billItems,
      monthLog: state.monthLog,
      businessLog: state.businessLog,
      loans: state.loans,
      transactions: state.transactions,
      debts: state.debts,
      investor: state.investor,
      preferences: state.preferences,
    };
  }

  function savePlanner() {
    const key = plannerKeyFromSession();
    state.userKey = key;
    localStorage.setItem(STORAGE.planner(key), JSON.stringify(plannerBlob()));
  }

  function loadProfile() {
    const raw = localStorage.getItem(STORAGE.profile(plannerKeyFromSession()));
    if (raw) {
      try {
        state.profile.displayName = JSON.parse(raw).displayName || "";
        return;
      } catch (_) {}
    }
    state.profile.displayName = "";
  }

  function saveProfile() {
    localStorage.setItem(STORAGE.profile(plannerKeyFromSession()), JSON.stringify({ displayName: state.profile.displayName }));
  }

  function loadSession() {
    state.activeFingerprint = localStorage.getItem(STORAGE.sessionFp);
    state.signedInEmail = localStorage.getItem(STORAGE.sessionEmail);
  }

  function persistSession() {
    if (state.activeFingerprint) {
      localStorage.setItem(STORAGE.sessionFp, state.activeFingerprint);
      localStorage.setItem(STORAGE.sessionEmail, state.signedInEmail || "");
    } else {
      localStorage.removeItem(STORAGE.sessionFp);
      localStorage.removeItem(STORAGE.sessionEmail);
    }
  }

  function getPhotoDataUrl() {
    return localStorage.getItem(STORAGE.photo(plannerKeyFromSession()));
  }

  function setPhotoDataUrl(dataUrl) {
    const key = plannerKeyFromSession();
    if (dataUrl) localStorage.setItem(STORAGE.photo(key), dataUrl);
    else localStorage.removeItem(STORAGE.photo(key));
  }

  function buildBackupObject() {
    return {
      improverUxBackup: 1,
      exportedAt: new Date().toISOString(),
      planner: plannerBlob(),
      profile: { displayName: state.profile.displayName || "" },
      photoDataUrl: getPhotoDataUrl() || null,
    };
  }

  function runExportBackup() {
    const blob = new Blob([JSON.stringify(buildBackupObject(), null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `veiro-backup-${todayYmd()}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  /* —— Payoff engine —— */
  function targetIndex(states, strategy) {
    const active = states.map((x, i) => ({ ...x, i })).filter((x) => x.balance > 0.01);
    if (!active.length) return null;
    if (strategy === "avalanche") {
      return active.reduce((best, x) => (x.annualRatePercent > best.annualRatePercent ? x : best)).i;
    }
    if (strategy === "snowball") {
      return active.reduce((best, x) => (x.balance < best.balance ? x : best)).i;
    }
    const minTier = Math.min(...active.map((x) => TIER_ORDER[x.tier] ?? 2));
    const bucket = active.filter((x) => (TIER_ORDER[x.tier] ?? 2) === minTier);
    if (minTier === 0) return bucket.reduce((best, x) => (x.balance < best.balance ? x : best)).i;
    return bucket.reduce((best, x) => (x.annualRatePercent > best.annualRatePercent ? x : best)).i;
  }

  function loansForSimulate() {
    return state.debts.map((d) => Data.legacyLoanFromDebt(d, []));
  }

  function loanAmountToGbp(loan, amount) {
    const a = Number(amount) || 0;
    if ((loan.currency || "GBP") === "GBP") return round2(a);
    return round2(a * gbpPerEurRate());
  }

  function cashflowForPayoff() {
    const ym = viewMonth;
    let income = 0;
    let nonDebtOut = 0;
    state.transactions.forEach((t) => {
      if (t.date.slice(0, 7) !== ym) return;
      if (t.type === "income") income += t.amountMinor;
      else if (t.category !== "Debt payment" && !t.debtId) nonDebtOut += t.amountMinor;
    });
    return { income: Data.fromMinor(income), mustPayBills: Data.fromMinor(nonDebtOut) };
  }

  function simulate(loans, strategy, monthlyIncome, mustPayBills) {
    const states = loans.map((l) => ({
      id: l.id,
      name: l.name,
      balance: loanAmountToGbp(l, Math.max(0, Number(l.balance) || 0)),
      annualRatePercent: Math.max(0, Number(l.apr) || 0),
      minimumPayment: loanAmountToGbp(l, Math.max(0, Number(l.monthlyPayment) || 0)),
      tier: normalizeTier(l.tier),
    }));

    let totalInterest = 0;
    let totalPaid = 0;
    let months = 0;
    const history = [];
    const income = Math.max(0, monthlyIncome);
    const bills = Math.max(0, mustPayBills);

    while (months < 600) {
      const totalBal = states.reduce((s, x) => s + x.balance, 0);
      history.push(round2(totalBal));
      if (totalBal <= 0.01) break;

      const active = states.filter((x) => x.balance > 0.01);
      const sumMin = active.reduce((s, x) => s + x.minimumPayment, 0);
      const available = income - bills;
      if (available + 0.001 < sumMin) {
        return { insolvent: true, totalInterest: round2(totalInterest), monthsToDebtFree: null, history, totalPaid: round2(totalPaid) };
      }

      for (let i = 0; i < states.length; i++) {
        if (states[i].balance <= 0.01) continue;
        const interest = round2(states[i].balance * (states[i].annualRatePercent / 100 / 12));
        states[i].balance = round2(states[i].balance + interest);
        totalInterest = round2(totalInterest + interest);
      }

      for (let i = 0; i < states.length; i++) {
        if (states[i].balance <= 0.01) continue;
        const pay = Math.min(states[i].minimumPayment, states[i].balance);
        states[i].balance = round2(states[i].balance - pay);
        totalPaid = round2(totalPaid + pay);
      }

      const extra = available - sumMin;
      if (extra > 0) {
        const idx = targetIndex(states, strategy);
        if (idx != null) {
          const pay = Math.min(extra, states[idx].balance);
          states[idx].balance = round2(states[idx].balance - pay);
          totalPaid = round2(totalPaid + pay);
        }
      }

      months++;
      const newTotal = states.reduce((s, x) => s + x.balance, 0);
      if (months > 24 && newTotal > totalBal * 2) {
        return {
          insolvent: false,
          runaway: true,
          totalInterest: round2(totalInterest),
          monthsToDebtFree: null,
          history,
          totalPaid: round2(totalPaid),
        };
      }
    }

    return {
      insolvent: false,
      totalInterest: round2(totalInterest),
      monthsToDebtFree: months,
      history,
      totalPaid: round2(totalPaid),
    };
  }

  /* —— Domain helpers —— */
  function monthSum(ym, filter) {
    return repo.sumMonth(ym, filter && filter.scope);
  }

  function totalOwedGbpMinor() {
    return state.debts.reduce((s, d) => s + debtAmountToGbpMinor(d, d.balanceMinor), 0);
  }

  function plannedThisMonthGbpMinor() {
    return state.debts.reduce((s, d) => s + debtAmountToGbpMinor(d, d.plannedMonthlyMinor || 0), 0);
  }

  function needsAttention() {
    const items = [];
    state.transactions.forEach((t) => {
      if (!t.category || t.category === "Imported monthly total") {
        items.push({
          id: t.id,
          kind: "uncategorised",
          label: `${t.note || t.category || "Uncategorised"} · ${formatMoneyMinor(t.amountMinor, t.currency)}`,
        });
      } else if (t.scope === "business" && t.type === "expense" && !t.receiptId) {
        items.push({ id: t.id, kind: "receipt", label: `${t.category} · missing receipt` });
      }
    });
    return items.slice(0, 12);
  }

  function categoriesForDraft() {
    if (txDraft.type === "income") return Data.CATEGORIES.income;
    if (txDraft.scope === "business") return Data.CATEGORIES.businessExpenses;
    return Data.CATEGORIES.personal;
  }

  function allCategoryOptions() {
    const set = new Set([
      ...Data.CATEGORIES.income,
      ...Data.CATEGORIES.personal,
      ...Data.CATEGORIES.businessExpenses,
      "Imported monthly total",
      "Debt payment",
    ]);
    state.transactions.forEach((t) => {
      if (t.category) set.add(t.category);
    });
    return [...set].sort();
  }

  /* —— Routing —— */
  function parseHash() {
    const h = (location.hash || "#/").replace(/^#\/?/, "").split("?")[0];
    const id = (h.split("/")[0] || "home").toLowerCase();
    return ROUTES.includes(id) ? id : "home";
  }

  function setRoute(id, push) {
    route = ROUTES.includes(id) ? id : "home";
    if (push !== false) {
      const next = "#/" + (route === "home" ? "" : route);
      if (location.hash !== next && location.hash !== "#" + (route === "home" ? "/" : "/" + route)) {
        location.hash = route === "home" ? "#/" : "#/" + route;
      }
    }
    document.querySelectorAll(".route-panel").forEach((p) => {
      p.hidden = p.getAttribute("data-route") !== route;
    });
    document.querySelectorAll("[data-route]").forEach((node) => {
      if (node.classList.contains("route-panel")) return;
      node.classList.toggle("active", node.getAttribute("data-route") === route);
    });
    const meta = PAGE_META[route];
    if (el("pageTitle")) el("pageTitle").textContent = meta.title;
    if (el("pageSub")) el("pageSub").textContent = meta.sub;
    refresh();
  }

  /* —— Render —— */
  function refresh() {
    syncLegacyFromLedger();
    renderHome();
    renderActivity();
    renderPlan();
    renderReports();
    renderAvatar();
    paintIcons();
  }

  function renderAvatar() {
    const photo = getPhotoDataUrl();
    const nodes = [el("navAvatar"), el("photoPreview")];
    nodes.forEach((n) => {
      if (!n) return;
      if (photo) {
        n.style.backgroundImage = `url(${photo})`;
      } else {
        n.style.backgroundImage = "";
      }
    });
  }

  function renderHome() {
    if (el("homeMonthLabel")) el("homeMonthLabel").textContent = formatMonthLabel(viewMonth);
    const sum = monthSum(viewMonth);
    if (el("homeIn")) el("homeIn").textContent = formatGbpStoredMinor(sum.incomeMinor);
    if (el("homeOut")) el("homeOut").textContent = formatGbpStoredMinor(sum.expenseMinor);
    if (el("homeLeft")) el("homeLeft").textContent = formatGbpStoredMinor(sum.leftMinor);

    const personal = monthSum(viewMonth, { scope: "personal" });
    const business = monthSum(viewMonth, { scope: "business" });
    if (el("homePersonalIn")) el("homePersonalIn").textContent = formatGbpStoredMinor(personal.incomeMinor);
    if (el("homePersonalOut")) el("homePersonalOut").textContent = formatGbpStoredMinor(personal.expenseMinor);
    if (el("homePersonalLeft")) el("homePersonalLeft").textContent = formatGbpStoredMinor(personal.leftMinor);
    if (el("homeBusinessIn")) el("homeBusinessIn").textContent = formatGbpStoredMinor(business.incomeMinor);
    if (el("homeBusinessOut")) el("homeBusinessOut").textContent = formatGbpStoredMinor(business.expenseMinor);
    if (el("homeBusinessProfit")) el("homeBusinessProfit").textContent = formatGbpStoredMinor(business.leftMinor);

    if (el("homeDebtTotal")) el("homeDebtTotal").textContent = formatGbpStoredMinor(totalOwedGbpMinor());
    if (el("homeDebtPlan")) el("homeDebtPlan").textContent = formatGbpStoredMinor(plannedThisMonthGbpMinor());

    const list = el("homeAttention");
    if (!list) return;
    const items = needsAttention();
    list.replaceChildren();
    if (!items.length) {
      const li = document.createElement("li");
      li.innerHTML = `<p class="attention-list__msg">All caught up.</p>`;
      list.appendChild(li);
      return;
    }
    items.forEach((item) => {
      const li = document.createElement("li");
      const msg = document.createElement("p");
      msg.className = "attention-list__msg";
      msg.textContent = item.label;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "text-link";
      btn.textContent = "Fix";
      btn.addEventListener("click", () => {
        const t = repo.getTransaction(item.id);
        if (t?.scope) {
          if (el("activityScope")) el("activityScope").value = t.scope;
          document.querySelectorAll("[data-activity-scope]").forEach((x) => {
            const on = x.getAttribute("data-activity-scope") === t.scope;
            x.classList.toggle("active", on);
            x.setAttribute("aria-selected", on ? "true" : "false");
          });
        }
        if (t?.date) activityMonth = t.date.slice(0, 7);
        editingTxId = item.id;
        pendingFocusTxId = item.id;
        if (parseHash() !== "activity") location.hash = "#/activity";
        else refresh();
      });
      li.append(msg, btn);
      list.appendChild(li);
    });
  }

  function formatShortDate(ymd) {
    return new Date(ymd + "T12:00:00").toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  }

  function activityFilter() {
    return {
      month: el("activityMonth")?.value || activityMonth || "",
      scope: el("activityScope")?.value || "personal",
      type: el("activityType")?.value || "",
      category: el("activityCategory")?.value || "",
      search: el("activitySearch")?.value || "",
      missingReceipt: !!el("activityMissingReceipt")?.checked,
    };
  }

  function renderActivitySummary(txs) {
    const box = el("activitySummary");
    if (!box) return;
    let income = 0;
    let expense = 0;
    txs.forEach((t) => {
      if (t.type === "income") income += t.amountMinor;
      else expense += t.amountMinor;
    });
    const bal = income - expense;
    const sign = bal > 0 ? "+" : bal < 0 ? "−" : "";
    const balAbs = Math.abs(bal);
    box.innerHTML = `
      <div class="ledger-dock__meta">
        <p class="ledger-dock__line"><span>Income</span><strong class="is-income">${formatGbpStoredMinor(income)}</strong></p>
        <p class="ledger-dock__line"><span>Expenses</span><strong class="is-expense">${formatGbpStoredMinor(expense)}</strong></p>
      </div>
      <div>
        <p class="ledger-dock__balance-label">Balance</p>
        <p class="ledger-dock__balance ${bal >= 0 ? "is-pos" : "is-neg"}">${sign}${formatGbpStoredMinor(balAbs)}</p>
      </div>`;
  }

  function categoriesForTx(type, scope) {
    if (type === "income") return Data.CATEGORIES.income;
    if (scope === "business") return Data.CATEGORIES.businessExpenses;
    return Data.CATEGORIES.personal;
  }

  function commitTxField(txId, patch) {
    const t = repo.getTransaction(txId);
    if (!t) return;
    Object.assign(t, patch);
    if (patch.type || patch.scope) {
      const cats = categoriesForTx(t.type, t.scope);
      if (!cats.includes(t.category)) t.category = cats[0] || "Other";
    }
    repo.saveTransaction(t);
    savePlanner();
  }

  function fillCategorySelect(sel, type, scope, current) {
    const cats = categoriesForTx(type, scope);
    sel.replaceChildren();
    cats.forEach((c) => {
      const o = document.createElement("option");
      o.value = c;
      o.textContent = c;
      if (c === current) o.selected = true;
      sel.appendChild(o);
    });
    if (current && !cats.includes(current)) {
      const o = document.createElement("option");
      o.value = current;
      o.textContent = current;
      o.selected = true;
      sel.appendChild(o);
    }
  }

  function deleteTxById(id) {
    const removed = repo.deleteTransaction(id);
    if (!removed) return;
    if (removed.debtId) {
      const debt = repo.getDebt(removed.debtId);
      if (debt) {
        debt.balanceMinor += removed.amountMinor;
        repo.saveDebt(debt);
      }
    }
    if (editingTxId === id) editingTxId = null;
    undoPayload = { type: "tx", tx: removed, debtBump: removed.debtId ? removed.amountMinor : 0 };
    showUndo("Transaction deleted");
    savePlanner();
    refresh();
  }

  function formatDateInput(ymd) {
    const [y, m, d] = String(ymd || todayYmd()).split("-");
    return `${d}/${m}/${y}`;
  }

  function parseDateInput(raw) {
    const s = String(raw || "").trim();
    const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
    if (!m) return null;
    const day = Number(m[1]);
    const month = Number(m[2]);
    const year = Number(m[3]);
    if (month < 1 || month > 12 || day < 1 || day > 31) return null;
    const dt = new Date(year, month - 1, day);
    if (dt.getFullYear() !== year || dt.getMonth() !== month - 1 || dt.getDate() !== day) return null;
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  }

  function buildLedgerEdit(t) {
    const edit = document.createElement("div");
    edit.className = "ledger-edit";

    const row1 = document.createElement("div");
    row1.className = "ledger-edit__row";

    const catIn = document.createElement("input");
    catIn.className = "cell-input";
    catIn.type = "text";
    catIn.maxLength = 80;
    catIn.placeholder = "Name";
    catIn.autocomplete = "off";
    catIn.value = t.category || "";
    catIn.addEventListener("change", () => {
      const name = catIn.value.trim() || "Other";
      catIn.value = name;
      commitTxField(t.id, { category: name });
      refresh();
    });

    const amtIn = document.createElement("input");
    amtIn.className = "cell-input cell-input--num";
    amtIn.type = "text";
    amtIn.inputMode = "decimal";
    amtIn.placeholder = "0.00";
    amtIn.value = t.amountMinor ? Data.fromMinor(t.amountMinor).toFixed(2) : "";
    amtIn.addEventListener("change", () => {
      const v = parseMajorInput(amtIn.value || "0");
      if (!Number.isFinite(v) || v < 0) {
        amtIn.value = t.amountMinor ? Data.fromMinor(t.amountMinor).toFixed(2) : "";
        return;
      }
      amtIn.value = v.toFixed(2);
      commitTxField(t.id, { amountMinor: Data.toMinor(v) });
      refresh();
    });

    row1.append(catIn, amtIn);

    const datePicker = createCDayPicker(t.date || todayYmd(), (ymd) => {
      commitTxField(t.id, { date: ymd });
      refresh();
    });

    const acts = document.createElement("div");
    acts.className = "ledger-edit__actions";

    const fileIn = document.createElement("input");
    fileIn.type = "file";
    fileIn.accept = "image/*,application/pdf";
    fileIn.hidden = true;
    fileIn.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file || !Receipts) return;
      const rid = uid();
      await Receipts.putReceipt(rid, file, { name: file.name, mime: file.type });
      commitTxField(t.id, { receiptId: rid });
      refresh();
    });

    const receiptBtn = document.createElement("button");
    receiptBtn.type = "button";
    receiptBtn.className = "btn secondary btn--sm";
    receiptBtn.textContent = t.receiptId ? "Receipt ✓" : "Receipt";
    receiptBtn.addEventListener("click", () => fileIn.click());

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "btn primary btn--sm";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => {
      editingTxId = null;
      refresh();
    });

    acts.append(fileIn, receiptBtn, doneBtn);
    edit.append(row1, datePicker, acts);
    return { edit, focusEl: catIn };
  }

  function buildLedgerRow(t) {
    const wrap = document.createElement("div");
    wrap.className = "ledger-row" + (editingTxId === t.id ? " is-editing" : "");
    wrap.dataset.txId = t.id;

    const head = document.createElement("div");
    head.className = "ledger-row__head";

    const main = document.createElement("button");
    main.type = "button";
    main.className = "ledger-row__main";
    const typeClass = t.type === "income" ? "is-income" : "is-expense";
    const sign = t.type === "income" ? "+" : "−";

    const left = document.createElement("div");
    left.className = "ledger-row__left";
    const title = document.createElement("p");
    title.className = `ledger-row__title ${typeClass}`;
    title.textContent = t.category || "Other";
    left.appendChild(title);
    if (t.scope === "business" && t.type === "expense" && !t.receiptId) {
      const sub = document.createElement("p");
      sub.className = "ledger-row__sub";
      sub.textContent = "No receipt";
      left.appendChild(sub);
    }

    const right = document.createElement("div");
    right.className = "ledger-row__right";
    const amt = document.createElement("p");
    amt.className = `ledger-row__amt money-num ${typeClass}`;
    amt.textContent = sign + formatMoneyMinor(t.amountMinor || 0, t.currency || "GBP");
    const date = document.createElement("p");
    date.className = "ledger-row__date";
    date.textContent = formatShortDate(t.date || todayYmd());
    right.append(amt, date);

    main.append(left, right);
    main.addEventListener("click", () => {
      editingTxId = editingTxId === t.id ? null : t.id;
      refresh();
    });

    const del = document.createElement("button");
    del.type = "button";
    del.className = "ledger-row__more";
    del.setAttribute("aria-label", "Delete");
    del.innerHTML = `<i data-lucide="trash-2" aria-hidden="true"></i>`;
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      deleteTxById(t.id);
    });

    head.append(main, del);
    wrap.appendChild(head);

    if (editingTxId === t.id) {
      const { edit, focusEl } = buildLedgerEdit(t);
      wrap.appendChild(edit);
      requestAnimationFrame(() => {
        wrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
        if (pendingFocusTxId === t.id) {
          pendingFocusTxId = null;
          focusEl?.focus();
          focusEl?.select?.();
        }
      });
    }

    return wrap;
  }

  function addTxInline(type) {
    const id = uid();
    const scope = el("activityScope")?.value === "business" ? "business" : "personal";
    const txType = type === "income" ? "income" : "expense";
    const month = el("activityMonth")?.value || activityMonth;
    const day = todayYmd();
    const date = day.startsWith(month) ? day : `${month}-01`;
    repo.saveTransaction({
      id,
      date,
      type: txType,
      amountMinor: 0,
      currency: "GBP",
      category: "",
      scope,
      note: "",
      createdAt: new Date().toISOString(),
    });
    savePlanner();
    editingTxId = id;
    pendingFocusTxId = id;
    if (parseHash() !== "activity") {
      location.hash = "#/activity";
      return;
    }
    refresh();
  }

  function renderActivity() {
    if (el("activityMonth")) el("activityMonth").value = activityMonth;
    if (el("activityMonthLabel")) el("activityMonthLabel").textContent = formatMonthLabel(activityMonth);

    const filter = activityFilter();
    const txs = repo.getTransactions({
      month: filter.month || undefined,
      scope: filter.scope || undefined,
      type: filter.type || undefined,
      category: filter.category || undefined,
      search: filter.search || undefined,
      missingReceipt: filter.missingReceipt || undefined,
    });

    renderActivitySummary(txs);

    const list = el("activityList");
    const empty = el("activityEmpty");
    if (!list) return;
    list.replaceChildren();

    if (!txs.length) {
      empty?.classList.remove("hidden");
      paintIcons();
      return;
    }
    empty?.classList.add("hidden");
    txs.forEach((t) => list.appendChild(buildLedgerRow(t)));
    paintIcons();
  }

  function renderPlan() {
    const debtsPane = el("planDebtsPane");
    const payoffPane = el("planPayoffPane");
    if (debtsPane) debtsPane.classList.toggle("hidden", planTab !== "debts");
    if (payoffPane) payoffPane.classList.toggle("hidden", planTab !== "payoff");
    document.querySelectorAll("[data-plan-tab]").forEach((b) => {
      const on = b.getAttribute("data-plan-tab") === planTab;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });

    const cash = cashflowForPayoff();
    const owed = totalOwedGbpMinor();
    const planned = plannedThisMonthGbpMinor();
    const leftMinor = Data.toMinor(cash.income - cash.mustPayBills) - planned;
    if (el("planDebtOwed")) el("planDebtOwed").textContent = formatGbpStoredMinor(owed);
    if (el("planDebtPlanned")) el("planDebtPlanned").textContent = formatGbpStoredMinor(planned);
    if (el("planDebtLeft")) {
      el("planDebtLeft").textContent = formatGbpStoredMinor(Math.abs(leftMinor));
      el("planDebtLeft").classList.toggle("is-pos", leftMinor >= 0);
      el("planDebtLeft").classList.toggle("is-neg", leftMinor < 0);
      if (leftMinor < 0) el("planDebtLeft").textContent = "−" + formatGbpStoredMinor(Math.abs(leftMinor));
      else if (leftMinor > 0) el("planDebtLeft").textContent = "+" + formatGbpStoredMinor(leftMinor);
      else el("planDebtLeft").textContent = formatGbpStoredMinor(0);
    }

    const list = el("debtList");
    const empty = el("debtsEmpty");
    if (!list) return;
    list.replaceChildren();
    const n = state.debts.length;
    if (!n) {
      empty?.classList.remove("hidden");
    } else {
      empty?.classList.add("hidden");
      state.debts.forEach((d) => list.appendChild(buildDebtRow(d)));
    }

    if (planTab === "payoff") renderPayoff();
    paintIcons();
    focusPendingDebt();
  }

  function commitDebtField(debtId, patch) {
    const d = repo.getDebt(debtId);
    if (!d) return;
    Object.assign(d, patch);
    repo.saveDebt(d);
    savePlanner();
  }

  function labeledField(label, input) {
    const wrap = document.createElement("label");
    wrap.className = "ledger-field";
    const lab = document.createElement("span");
    lab.className = "ledger-field__label";
    lab.textContent = label;
    wrap.append(lab, input);
    return wrap;
  }

  function buildDebtEdit(d) {
    const edit = document.createElement("div");
    edit.className = "ledger-edit ledger-edit--debt";

    const nameIn = document.createElement("input");
    nameIn.className = "cell-input";
    nameIn.type = "text";
    nameIn.placeholder = "e.g. Barclays";
    nameIn.maxLength = 120;
    nameIn.value = d.name || "";
    nameIn.addEventListener("change", () => {
      commitDebtField(d.id, { name: nameIn.value.trim() });
      refresh();
    });

    const balIn = document.createElement("input");
    balIn.className = "cell-input cell-input--num";
    balIn.type = "text";
    balIn.inputMode = "decimal";
    balIn.placeholder = "0.00";
    balIn.value = d.balanceMinor ? Data.fromMinor(d.balanceMinor).toFixed(2) : "";
    balIn.addEventListener("change", () => {
      const v = parseMajorInput(balIn.value || "0");
      if (!Number.isFinite(v) || v < 0) {
        balIn.value = d.balanceMinor ? Data.fromMinor(d.balanceMinor).toFixed(2) : "";
        return;
      }
      balIn.value = v.toFixed(2);
      commitDebtField(d.id, { balanceMinor: Data.toMinor(v) });
      refresh();
    });

    const planIn = document.createElement("input");
    planIn.className = "cell-input cell-input--num";
    planIn.type = "text";
    planIn.inputMode = "decimal";
    planIn.placeholder = "0.00";
    planIn.value = d.plannedMonthlyMinor ? Data.fromMinor(d.plannedMonthlyMinor).toFixed(2) : "";
    planIn.addEventListener("change", () => {
      const v = parseMajorInput(planIn.value || "0");
      if (!Number.isFinite(v) || v < 0) {
        planIn.value = d.plannedMonthlyMinor ? Data.fromMinor(d.plannedMonthlyMinor).toFixed(2) : "";
        return;
      }
      planIn.value = v.toFixed(2);
      commitDebtField(d.id, { plannedMonthlyMinor: Data.toMinor(v) });
      refresh();
    });

    const amounts = document.createElement("div");
    amounts.className = "ledger-edit__row";
    amounts.append(labeledField("Balance", balIn), labeledField("Planned / month", planIn));

    const acts = document.createElement("div");
    acts.className = "ledger-edit__actions";

    const planned = d.plannedMonthlyMinor || 0;
    if (planned > 0 && d.balanceMinor > 0) {
      const payLink = document.createElement("button");
      payLink.type = "button";
      payLink.className = "text-link";
      payLink.textContent = `Pay ${formatMoneyMinor(Math.min(planned, d.balanceMinor), d.currency || "GBP")}`;
      payLink.addEventListener("click", () => {
        const fake = { value: Data.fromMinor(Math.min(planned, d.balanceMinor)).toFixed(2) };
        applyInlinePay(d.id, fake);
      });
      acts.appendChild(payLink);
    }

    const doneBtn = document.createElement("button");
    doneBtn.type = "button";
    doneBtn.className = "btn secondary btn--sm";
    doneBtn.textContent = "Done";
    doneBtn.addEventListener("click", () => {
      editingDebtId = null;
      refresh();
    });
    acts.appendChild(doneBtn);

    edit.append(labeledField("Name", nameIn), amounts, acts);
    return { edit, focusEl: nameIn };
  }

  function buildDebtRow(d) {
    const wrap = document.createElement("div");
    wrap.className = "ledger-row" + (editingDebtId === d.id ? " is-editing" : "");
    wrap.dataset.debtId = d.id;

    const head = document.createElement("div");
    head.className = "ledger-row__head";

    const del = document.createElement("button");
    del.type = "button";
    del.className = "ledger-row__more";
    del.setAttribute("aria-label", "Delete");
    del.innerHTML = `<i data-lucide="trash-2" aria-hidden="true"></i>`;
    del.addEventListener("click", (e) => {
      e.stopPropagation();
      repo.deleteDebt(d.id);
      state.transactions = state.transactions.filter((t) => t.debtId !== d.id);
      if (editingDebtId === d.id) editingDebtId = null;
      savePlanner();
      refresh();
    });

    if (editingDebtId === d.id) {
      const { edit, focusEl } = buildDebtEdit(d);
      const top = document.createElement("div");
      top.className = "ledger-edit__top";
      top.appendChild(del);
      edit.insertBefore(top, edit.firstChild);
      wrap.appendChild(edit);
      requestAnimationFrame(() => {
        wrap.scrollIntoView({ block: "nearest", behavior: "smooth" });
        if (pendingFocusDebtId === d.id) {
          pendingFocusDebtId = null;
          focusEl?.focus();
          focusEl?.select?.();
        }
      });
      return wrap;
    }

    const main = document.createElement("button");
    main.type = "button";
    main.className = "ledger-row__main";

    const left = document.createElement("div");
    left.className = "ledger-row__left";
    const title = document.createElement("p");
    title.className = "ledger-row__title";
    title.textContent = d.name || "New debt";
    left.appendChild(title);
    const planned = d.plannedMonthlyMinor || 0;
    if (planned > 0) {
      const sub = document.createElement("p");
      sub.className = "ledger-row__sub";
      sub.textContent = `${formatMoneyMinor(planned, d.currency || "GBP")} planned`;
      left.appendChild(sub);
    }

    const right = document.createElement("div");
    right.className = "ledger-row__right";
    const amt = document.createElement("p");
    amt.className = "ledger-row__amt money-num is-expense";
    amt.textContent = formatMoneyMinor(d.balanceMinor || 0, d.currency || "GBP");
    right.appendChild(amt);

    main.append(left, right);
    main.addEventListener("click", () => {
      editingDebtId = d.id;
      refresh();
    });

    head.append(main, del);
    wrap.appendChild(head);
    return wrap;
  }

  function applyInlinePay(debtId, payIn) {
    const d = repo.getDebt(debtId);
    if (!d) return;
    let major = parseMajorInput(payIn.value);
    if (!Number.isFinite(major) || major <= 0) {
      const suggest = Math.min(d.plannedMonthlyMinor || 0, d.balanceMinor);
      major = Data.fromMinor(suggest > 0 ? suggest : d.balanceMinor);
      if (major <= 0) return;
      payIn.value = major.toFixed(2);
    }
    const payMinor = Math.min(Data.toMinor(major), d.balanceMinor);
    if (payMinor <= 0) return;
    d.balanceMinor -= payMinor;
    repo.saveDebt(d);
    repo.saveTransaction({
      id: uid(),
      date: todayYmd(),
      type: "expense",
      amountMinor: payMinor,
      currency: d.currency || "GBP",
      category: "Debt payment",
      scope: "personal",
      note: d.name,
      debtId: d.id,
    });
    savePlanner();
    payIn.value = "";
    refresh();
  }

  function addDebtInline() {
    const id = uid();
    repo.saveDebt({
      id,
      name: "",
      kind: "card_loan",
      balanceMinor: 0,
      currency: "GBP",
      ratePercent: 0,
      plannedMonthlyMinor: 0,
    });
    savePlanner();
    editingDebtId = id;
    pendingFocusDebtId = id;
    planTab = "debts";
    if (parseHash() !== "plan") {
      location.hash = "#/plan";
      return;
    }
    refresh();
  }

  function focusPendingDebt() {
    if (!pendingFocusDebtId) return;
    const id = pendingFocusDebtId;
    const row = document.querySelector(`[data-debt-id="${id}"]`);
    if (!row) return;
    pendingFocusDebtId = null;
    const input = row.querySelector(".cell-input");
    input?.focus();
    input?.select?.();
  }

  function renderPayoff() {
    const loans = loansForSimulate();
    const { income, mustPayBills } = cashflowForPayoff();
    const results = {
      avalanche: simulate(loans, "avalanche", income, mustPayBills),
      snowball: simulate(loans, "snowball", income, mustPayBills),
      priority: simulate(loans, "priority", income, mustPayBills),
    };
    const order = ["avalanche", "snowball", "priority"];
    let best = "avalanche";
    let bestInterest = Infinity;
    order.forEach((k) => {
      const r = results[k];
      if (!r.insolvent && !r.runaway && r.monthsToDebtFree != null && r.totalInterest < bestInterest) {
        bestInterest = r.totalInterest;
        best = k;
      }
    });
    selectedStrategy = best;

    const labels = {
      avalanche: { title: "Avalanche", blurb: "Highest interest first" },
      snowball: { title: "Snowball", blurb: "Smallest balance first" },
      priority: { title: "People first", blurb: "People, then overdrafts, then other" },
    };

    const grid = el("strategyCards");
    if (!grid) return;
    grid.replaceChildren();
    order.forEach((k) => {
      const r = results[k];
      const card = document.createElement("button");
      card.type = "button";
      card.className = "strategy-card" + (k === best ? " recommended" : "");
      let stats = `About ${r.monthsToDebtFree} months · ${formatGbpStoredMinor(Data.toMinor(r.totalInterest))} interest`;
      if (r.insolvent) stats = "Not enough spare cash for minimums";
      else if (r.runaway) stats = "Balances growing — check rates and payments";
      card.innerHTML = `
        ${k === best ? `<span class="strategy-card__badge">Recommended</span>` : ""}
        <p class="strategy-card__title"></p>
        <p class="strategy-card__stats money-num"></p>`;
      card.querySelector(".strategy-card__title").textContent = `${labels[k].title} — ${labels[k].blurb}`;
      card.querySelector(".strategy-card__stats").textContent =
        k === best && !r.insolvent && !r.runaway ? `${stats} · lowest total interest` : stats;
      grid.appendChild(card);
    });

    const compareKey = best === "avalanche" ? "snowball" : "avalanche";
    updateChart(results[best].history || [], results[compareKey].history || []);
  }

  function updateChart(histA, histB) {
    const canvas = el("debtChart");
    if (!canvas || !window.Chart) return;
    const labels = histA.map((_, i) => (i === 0 ? "Now" : `M${i}`));
    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Recommended path",
            data: histA,
            borderColor: "#e85d8a",
            tension: 0.25,
            pointRadius: 0,
          },
          {
            label: "Comparison",
            data: histB,
            borderColor: "#d4b06a",
            tension: 0.25,
            pointRadius: 0,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: { legend: { labels: { color: "rgba(220,214,235,0.82)" } } },
        scales: {
          x: { ticks: { color: "rgba(220,214,235,0.72)", maxTicksLimit: 8 }, grid: { color: "rgba(255,255,255,0.06)" } },
          y: { ticks: { color: "rgba(220,214,235,0.72)" }, grid: { color: "rgba(255,255,255,0.06)" } },
        },
      },
    });
  }

  function reportRange() {
    if (reportPeriod === "year") {
      const y = reportAnchor.slice(0, 4);
      return { start: `${y}-01-01`, end: `${y}-12-31`, label: y };
    }
    if (reportPeriod === "quarter") {
      const [y, m] = reportAnchor.split("-").map(Number);
      const q = Math.floor((m - 1) / 3);
      const startM = q * 3 + 1;
      const endM = startM + 2;
      const endDay = new Date(y, endM, 0).getDate();
      return {
        start: `${y}-${String(startM).padStart(2, "0")}-01`,
        end: `${y}-${String(endM).padStart(2, "0")}-${endDay}`,
        label: `Q${q + 1} ${y}`,
      };
    }
    const [y, m] = reportAnchor.split("-").map(Number);
    const endDay = new Date(y, m, 0).getDate();
    return {
      start: `${reportAnchor}-01`,
      end: `${reportAnchor}-${endDay}`,
      label: formatMonthLabel(reportAnchor),
    };
  }

  function txsInRange(start, end) {
    return state.transactions.filter((t) => t.date >= start && t.date <= end);
  }

  function renderReports() {
    document.querySelectorAll("[data-report-period]").forEach((b) => {
      const on = b.getAttribute("data-report-period") === reportPeriod;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    document.querySelectorAll("[data-report-scope]").forEach((b) => {
      const on = (b.getAttribute("data-report-scope") || "") === reportScope;
      b.classList.toggle("active", on);
      b.setAttribute("aria-selected", on ? "true" : "false");
    });
    if (el("reportScope")) el("reportScope").value = reportScope;

    const range = reportRange();
    if (el("reportPeriodLabel")) el("reportPeriodLabel").textContent = range.label;
    let txs = txsInRange(range.start, range.end);
    if (reportScope) txs = txs.filter((t) => t.scope === reportScope);

    let income = 0;
    let bizIn = 0;
    let bizOut = 0;
    let personalIn = 0;
    let personalOut = 0;
    const byCat = {};
    txs.forEach((t) => {
      if (t.type === "income") {
        income += t.amountMinor;
        if (t.scope === "business") bizIn += t.amountMinor;
        else personalIn += t.amountMinor;
      } else {
        if (t.scope === "business") bizOut += t.amountMinor;
        else personalOut += t.amountMinor;
        byCat[t.category] = (byCat[t.category] || 0) + t.amountMinor;
      }
    });
    if (el("reportIncome")) el("reportIncome").textContent = formatGbpStoredMinor(income);
    if (el("reportBizProfit")) el("reportBizProfit").textContent = formatGbpStoredMinor(bizIn - bizOut);
    if (el("reportPersonalLeft")) {
      el("reportPersonalLeft").textContent = formatGbpStoredMinor(
        reportScope === "business"
          ? bizIn - bizOut
          : reportScope === "personal"
            ? personalIn - personalOut
            : personalIn + bizIn - personalOut - bizOut
      );
      const label = el("reportPersonalLeft").previousElementSibling;
      if (label && label.classList.contains("stat-tile__label")) {
        label.textContent =
          reportScope === "business" ? "Business left" : reportScope === "personal" ? "Personal left" : "Overall left";
      }
    }

    const ul = el("reportCategories");
    if (!ul) return;
    ul.replaceChildren();
    const entries = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    if (!entries.length) {
      const li = document.createElement("li");
      li.innerHTML = `<span class="muted">No expenses in this period.</span>`;
      ul.appendChild(li);
      return;
    }
    entries.forEach(([cat, minor]) => {
      const li = document.createElement("li");
      li.innerHTML = `<span></span><strong class="money-num"></strong>`;
      li.children[0].textContent = cat;
      li.children[1].textContent = formatGbpStoredMinor(minor);
      ul.appendChild(li);
    });
  }

  /* —— Sheets —— */
  function openSheet(overlayId, sheetId) {
    el(overlayId)?.classList.remove("hidden");
    el(sheetId)?.classList.remove("hidden");
    el(overlayId)?.setAttribute("aria-hidden", "false");
    paintIcons();
  }

  function closeSheet(overlayId, sheetId) {
    el(overlayId)?.classList.add("hidden");
    el(sheetId)?.classList.add("hidden");
    el(overlayId)?.setAttribute("aria-hidden", "true");
  }

  function renderCategoryChips() {
    /* Category is free-typed in #txCategory — chips removed. */
  }

  function openTxSheet(editId) {
    const err = el("txSheetError");
    if (err) {
      err.classList.add("hidden");
      err.textContent = "";
    }
    pendingReceiptId = null;
    if (editId) {
      const t = repo.getTransaction(editId);
      if (!t) return;
      el("txEditId").value = t.id;
      el("txSheetTitle").textContent = "Edit";
      txDraft = {
        type: t.type,
        scope: t.scope,
        category: t.category,
        amount: String(Data.fromMinor(t.amountMinor)),
        date: t.date,
        note: t.note || "",
        receiptId: t.receiptId || null,
      };
      el("txDelete")?.classList.remove("hidden");
      el("txSaveAnother")?.classList.add("hidden");
    } else {
      el("txEditId").value = "";
      el("txSheetTitle").textContent = "Add";
      txDraft = blankTxDraft();
      el("txDelete")?.classList.add("hidden");
      el("txSaveAnother")?.classList.remove("hidden");
    }
    el("txAmount").value = txDraft.amount;
    if (el("txCategory")) el("txCategory").value = txDraft.category || "";
    setCDayValue(document.querySelector('[data-cday="txDate"]'), txDraft.date || todayYmd(), true);
    el("txReceiptStatus").textContent = txDraft.receiptId ? "Receipt attached" : "";
    document.querySelectorAll("[data-tx-type]").forEach((b) => b.classList.toggle("active", b.getAttribute("data-tx-type") === txDraft.type));
    document.querySelectorAll("[data-tx-scope]").forEach((b) => b.classList.toggle("active", b.getAttribute("data-tx-scope") === txDraft.scope));
    openSheet("txSheetOverlay", "txSheet");
    el("txCategory")?.focus();
  }

  function closeTxSheet() {
    closeSheet("txSheetOverlay", "txSheet");
  }

  function saveTxFromSheet(andAnother) {
    const err = el("txSheetError");
    const major = parseMajorInput(el("txAmount").value);
    if (!Number.isFinite(major) || major <= 0) {
      err.textContent = "Enter an amount greater than zero.";
      err.classList.remove("hidden");
      return;
    }
    const ymd = el("txDate")?.value || todayYmd();
    const editId = el("txEditId").value;
    const existing = editId ? repo.getTransaction(editId) : null;
    const receiptId = pendingReceiptId || txDraft.receiptId || (existing && existing.receiptId) || undefined;
    const payload = {
      id: editId || uid(),
      date: ymd,
      type: txDraft.type,
      amountMinor: Data.toMinor(major),
      currency: "GBP",
      category: (el("txCategory")?.value || "").trim() || "Other",
      scope: txDraft.scope,
      receiptId,
      debtId: existing && existing.debtId,
      createdAt: existing && existing.createdAt,
    };
    repo.saveTransaction(payload);
    savePlanner();
    if (andAnother) {
      txDraft = blankTxDraft();
      el("txEditId").value = "";
      el("txAmount").value = "";
      if (el("txCategory")) el("txCategory").value = "";
      setCDayValue(document.querySelector('[data-cday="txDate"]'), todayYmd(), true);
      el("txReceiptStatus").textContent = "";
      pendingReceiptId = null;
      el("txSheetTitle").textContent = "Add";
      el("txDelete")?.classList.add("hidden");
      el("txSaveAnother")?.classList.remove("hidden");
      el("txCategory")?.focus();
    } else {
      closeTxSheet();
    }
    refresh();
  }

  async function deleteTxFromSheet() {
    const id = el("txEditId").value;
    const removed = repo.deleteTransaction(id);
    if (!removed) return;
    if (removed.debtId) {
      const debt = repo.getDebt(removed.debtId);
      if (debt) {
        debt.balanceMinor += removed.amountMinor;
        repo.saveDebt(debt);
      }
    }
    undoPayload = { type: "tx", tx: removed, debtBump: removed.debtId ? removed.amountMinor : 0 };
    showUndo("Transaction deleted");
    closeTxSheet();
    savePlanner();
    refresh();
  }

  function showUndo(text) {
    const toast = el("undoToast");
    if (!toast) return;
    el("undoToastText").textContent = text;
    toast.classList.remove("hidden");
    clearTimeout(undoTimer);
    undoTimer = setTimeout(() => {
      toast.classList.add("hidden");
      undoPayload = null;
    }, 5000);
  }

  function undoLast() {
    if (!undoPayload) return;
    if (undoPayload.type === "tx") {
      repo.saveTransaction(undoPayload.tx);
      if (undoPayload.tx.debtId && undoPayload.debtBump) {
        const debt = repo.getDebt(undoPayload.tx.debtId);
        if (debt) {
          debt.balanceMinor = Math.max(0, debt.balanceMinor - undoPayload.debtBump);
          repo.saveDebt(debt);
        }
      }
    }
    undoPayload = null;
    el("undoToast")?.classList.add("hidden");
    savePlanner();
    refresh();
  }

  function syncDebtSheetSelects(kind, currency) {
    setCSelectOptions(
      document.querySelector('[data-cselect="debtKind"]'),
      [
        { value: "person", label: "Person" },
        { value: "bank", label: "Bank / overdraft" },
        { value: "card_loan", label: "Card or loan" },
      ],
      kind || "card_loan"
    );
    setCSelectOptions(
      document.querySelector('[data-cselect="debtCurrency"]'),
      [
        { value: "GBP", label: "£ GBP" },
        { value: "EUR", label: "€ EUR" },
      ],
      currency === "EUR" ? "EUR" : "GBP"
    );
  }

  function openDebtSheet(id) {
    el("debtSheetError")?.classList.add("hidden");
    if (id) {
      const d = repo.getDebt(id);
      if (!d) return;
      el("debtEditId").value = d.id;
      el("debtSheetTitle").textContent = "Edit debt";
      el("debtName").value = d.name || "";
      syncDebtSheetSelects(d.kind, d.currency);
      el("debtBalance").value = String(Data.fromMinor(d.balanceMinor));
      el("debtRate").value = String(d.ratePercent || 0);
      el("debtPlanned").value = String(Data.fromMinor(d.plannedMonthlyMinor || 0));
      el("debtDelete")?.classList.remove("hidden");
      el("debtRecordPay")?.classList.remove("hidden");
    } else {
      el("debtEditId").value = "";
      el("debtSheetTitle").textContent = "Add a debt";
      el("debtName").value = "";
      syncDebtSheetSelects("card_loan", "GBP");
      el("debtBalance").value = "";
      el("debtRate").value = "0";
      el("debtPlanned").value = "";
      el("debtDelete")?.classList.add("hidden");
      el("debtRecordPay")?.classList.add("hidden");
    }
    openSheet("debtSheetOverlay", "debtSheet");
    el("debtName")?.focus();
  }

  function saveDebtFromSheet() {
    const err = el("debtSheetError");
    const name = (el("debtName").value || "").trim();
    const bal = parseMajorInput(el("debtBalance").value);
    if (!name) {
      err.textContent = "Enter a name.";
      err.classList.remove("hidden");
      return;
    }
    if (!Number.isFinite(bal)) {
      err.textContent = "Enter a valid balance.";
      err.classList.remove("hidden");
      return;
    }
    const planned = parseMajorInput(el("debtPlanned").value || "0");
    const rate = parseMajorInput(el("debtRate").value || "0");
    const id = el("debtEditId").value || uid();
    repo.saveDebt({
      id,
      name,
      kind: el("debtKind").value,
      balanceMinor: Data.toMinor(bal),
      currency: el("debtCurrency").value === "EUR" ? "EUR" : "GBP",
      ratePercent: Number.isFinite(rate) ? rate : 0,
      plannedMonthlyMinor: Number.isFinite(planned) ? Data.toMinor(planned) : 0,
    });
    savePlanner();
    closeSheet("debtSheetOverlay", "debtSheet");
    refresh();
  }

  function deleteDebtFromSheet() {
    const id = el("debtEditId").value;
    if (!id) return;
    repo.deleteDebt(id);
    state.transactions = state.transactions.filter((t) => t.debtId !== id);
    savePlanner();
    closeSheet("debtSheetOverlay", "debtSheet");
    refresh();
  }

  function openPaySheet(debtId) {
    const d = repo.getDebt(debtId);
    if (!d) return;
    el("paySheetError")?.classList.add("hidden");
    el("payDebtId").value = d.id;
    el("payDebtContext").textContent = `${d.name || "Debt"} · balance ${formatMoneyMinor(d.balanceMinor, d.currency)}`;
    const suggest = Math.min(d.plannedMonthlyMinor || 0, d.balanceMinor);
    el("payAmount").value = suggest > 0 ? String(Data.fromMinor(suggest)) : "";
    el("payDate").value = todayYmd();
    setCDayValue(document.querySelector('[data-cday="payDate"]'), todayYmd(), true);
    el("payNote").value = "";
    openSheet("paySheetOverlay", "paySheet");
    el("payAmount")?.focus();
  }

  function savePaymentFromSheet() {
    const err = el("paySheetError");
    const debtId = el("payDebtId").value;
    const d = repo.getDebt(debtId);
    if (!d) return;
    const major = parseMajorInput(el("payAmount").value);
    if (!Number.isFinite(major) || major <= 0) {
      err.textContent = "Enter an amount greater than zero.";
      err.classList.remove("hidden");
      return;
    }
    const payMinor = Math.min(Data.toMinor(major), d.balanceMinor);
    if (payMinor <= 0) {
      err.textContent = "Nothing left to pay on this debt.";
      err.classList.remove("hidden");
      return;
    }
    d.balanceMinor -= payMinor;
    repo.saveDebt(d);
    repo.saveTransaction({
      id: uid(),
      date: el("payDate").value || todayYmd(),
      type: "expense",
      amountMinor: payMinor,
      currency: d.currency || "GBP",
      category: "Debt payment",
      scope: "personal",
      note: (el("payNote").value || "").trim() || d.name,
      debtId: d.id,
    });
    savePlanner();
    closeSheet("paySheetOverlay", "paySheet");
    refresh();
  }

  /* —— Export —— */
  function exportCsv() {
    const range = reportRange();
    const txs = txsInRange(range.start, range.end);
    const rows = [["date", "type", "category", "scope", "amount", "currency", "note", "receipt"]];
    txs.forEach((t) => {
      rows.push([
        t.date,
        t.type,
        t.category,
        t.scope,
        (Data.fromMinor(t.amountMinor)).toFixed(2),
        t.currency,
        (t.note || "").replace(/"/g, '""'),
        t.receiptId ? "yes" : "no",
      ]);
    });
    const csv = rows.map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `veiro-${range.label.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function exportPdfPrint() {
    const range = reportRange();
    const txs = txsInRange(range.start, range.end);
    const w = window.open("", "_blank");
    if (!w) return;
    const lines = txs
      .map(
        (t) =>
          `<tr><td>${t.date}</td><td>${t.type}</td><td>${t.category}</td><td>${t.scope}</td><td>${formatMoneyMinor(
            t.amountMinor,
            t.currency
          )}</td><td>${t.note || ""}</td><td>${t.receiptId ? "yes" : "no"}</td></tr>`
      )
      .join("");
    w.document.write(`<!DOCTYPE html><html><head><title>Veiro ${range.label}</title>
      <style>body{font-family:system-ui,sans-serif;padding:24px;color:#111}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:8px;text-align:left;font-variant-numeric:tabular-nums}h1{font-size:1.4rem}</style>
      </head><body><h1>Veiro · ${range.label}</h1>
      <p>Income ${el("reportIncome")?.textContent || ""} · Business profit ${el("reportBizProfit")?.textContent || ""} · Left ${el("reportPersonalLeft")?.textContent || ""}</p>
      <table><thead><tr><th>Date</th><th>Type</th><th>Category</th><th>Scope</th><th>Amount</th><th>Note</th><th>Receipt</th></tr></thead><tbody>${lines}</tbody></table>
      </body></html>`);
    w.document.close();
    w.focus();
    w.print();
  }

  /* —— Settings / auth UI —— */
  function openSettings() {
    el("displayName").value = state.profile.displayName || "";
    setCSelectOptions(
      document.querySelector('[data-cselect="prefDisplayCurrency"]'),
      [
        { value: "GBP", label: "Pound (£)" },
        { value: "EUR", label: "Euro (€)" },
      ],
      displayCurrency()
    );
    el("prefGbpPerEur").value = String(gbpPerEurRate());
    const signedIn = !!state.activeFingerprint;
    el("loggedInActions")?.classList.toggle("hidden", !signedIn);
    el("guestAuth")?.classList.toggle("hidden", signedIn);
    el("accountStatus").textContent = signedIn ? state.signedInEmail || "Signed in" : "Guest on this device";
    el("profileModal")?.classList.remove("hidden");
    renderAvatar();
    paintIcons();
  }

  function closeSettings() {
    el("profileModal")?.classList.add("hidden");
  }

  async function registerAccount(email, password, confirm) {
    if (!validEmail(email)) return "Enter a valid email address.";
    if (password.length < 8) return "Use at least 8 characters.";
    if (password !== confirm) return "Passwords do not match.";
    const fp = await emailFingerprint(email);
    if (localStorage.getItem(STORAGE.cred(fp))) return "This email is already registered.";
    await saveCredential(fp, password);
    state.activeFingerprint = fp;
    state.signedInEmail = email.trim().toLowerCase();
    persistSession();
    state.profile.displayName = email.split("@")[0] || "";
    loadPlanner();
    saveProfile();
    savePlanner();
    return null;
  }

  async function loginAccount(email, password) {
    if (!validEmail(email)) return "Enter a valid email.";
    const fp = await emailFingerprint(email);
    const blob = await loadCredential(fp);
    if (!blob) return "No account found for this email.";
    const ok = await verifyPassword(password, blob.salt, blob.hash);
    if (!ok) return "Incorrect password.";
    state.activeFingerprint = fp;
    state.signedInEmail = email.trim().toLowerCase();
    persistSession();
    loadProfile();
    loadPlanner();
    return null;
  }

  function signOut() {
    state.activeFingerprint = null;
    state.signedInEmail = null;
    persistSession();
    loadProfile();
    loadPlanner();
  }

  /* —— Bindings —— */
  function bind() {
    window.addEventListener("hashchange", () => setRoute(parseHash(), false));

    el("homeMonthPrev")?.addEventListener("click", () => {
      viewMonth = shiftYm(viewMonth, -1);
      refresh();
    });
    el("homeMonthNext")?.addEventListener("click", () => {
      viewMonth = shiftYm(viewMonth, 1);
      refresh();
    });

    el("activityMonthPrev")?.addEventListener("click", () => {
      activityMonth = shiftYm(activityMonth, -1);
      renderActivity();
      paintIcons();
    });
    el("activityMonthNext")?.addEventListener("click", () => {
      activityMonth = shiftYm(activityMonth, 1);
      renderActivity();
      paintIcons();
    });

    el("btnAddIncome")?.addEventListener("click", () => addTxInline("income"));
    el("btnAddExpense")?.addEventListener("click", () => addTxInline("expense"));
    ["homeBtnAdd", "bottomNavAdd", "sideNavAdd"].forEach((id) => {
      el(id)?.addEventListener("click", () => addTxInline("expense"));
    });

    document.querySelectorAll("[data-activity-scope]").forEach((b) => {
      b.addEventListener("click", () => {
        const value = b.getAttribute("data-activity-scope") || "personal";
        if (el("activityScope")) el("activityScope").value = value;
        document.querySelectorAll("[data-activity-scope]").forEach((x) => {
          const on = x === b;
          x.classList.toggle("active", on);
          x.setAttribute("aria-selected", on ? "true" : "false");
        });
        editingTxId = null;
        renderActivity();
        paintIcons();
      });
    });

    document.querySelectorAll("[data-report-scope]").forEach((b) => {
      b.addEventListener("click", () => {
        reportScope = b.getAttribute("data-report-scope") || "personal";
        renderReports();
        paintIcons();
      });
    });

    bindCSelects();
    bindCMonths();
    bindCDays();
    setCSelectOptions(
      document.querySelector('[data-cselect="prefDisplayCurrency"]'),
      [
        { value: "GBP", label: "Pound (£)" },
        { value: "EUR", label: "Euro (€)" },
      ],
      displayCurrency()
    );
    setCSelectOptions(
      document.querySelector('[data-cselect="debtKind"]'),
      [
        { value: "person", label: "Person" },
        { value: "bank", label: "Bank / overdraft" },
        { value: "card_loan", label: "Card or loan" },
      ],
      "card_loan"
    );
    setCSelectOptions(
      document.querySelector('[data-cselect="debtCurrency"]'),
      [
        { value: "GBP", label: "£ GBP" },
        { value: "EUR", label: "€ EUR" },
      ],
      "GBP"
    );

    document.querySelectorAll("[data-plan-tab]").forEach((b) => {
      b.addEventListener("click", () => {
        planTab = b.getAttribute("data-plan-tab");
        renderPlan();
        paintIcons();
      });
    });

    el("btnAddDebt")?.addEventListener("click", () => addDebtInline());

    document.querySelectorAll("[data-report-period]").forEach((b) => {
      b.addEventListener("click", () => {
        reportPeriod = b.getAttribute("data-report-period");
        renderReports();
      });
    });
    el("reportPrev")?.addEventListener("click", () => {
      if (reportPeriod === "year") reportAnchor = `${Number(reportAnchor.slice(0, 4)) - 1}-01`;
      else if (reportPeriod === "quarter") reportAnchor = shiftYm(reportAnchor, -3);
      else reportAnchor = shiftYm(reportAnchor, -1);
      renderReports();
    });
    el("reportNext")?.addEventListener("click", () => {
      if (reportPeriod === "year") reportAnchor = `${Number(reportAnchor.slice(0, 4)) + 1}-01`;
      else if (reportPeriod === "quarter") reportAnchor = shiftYm(reportAnchor, 3);
      else reportAnchor = shiftYm(reportAnchor, 1);
      renderReports();
    });
    el("btnExportCsv")?.addEventListener("click", exportCsv);
    el("btnExportPdf")?.addEventListener("click", exportPdfPrint);

    el("txSheetOverlay")?.addEventListener("click", closeTxSheet);
    el("txSheetClose")?.addEventListener("click", closeTxSheet);
    el("txSave")?.addEventListener("click", () => saveTxFromSheet(false));
    el("txSaveAnother")?.addEventListener("click", () => saveTxFromSheet(true));
    el("txDelete")?.addEventListener("click", () => deleteTxFromSheet());
    document.querySelectorAll("[data-tx-type]").forEach((b) => {
      b.addEventListener("click", () => {
        txDraft.type = b.getAttribute("data-tx-type");
        document.querySelectorAll("[data-tx-type]").forEach((x) => x.classList.toggle("active", x === b));
      });
    });
    document.querySelectorAll("[data-tx-scope]").forEach((b) => {
      b.addEventListener("click", () => {
        txDraft.scope = b.getAttribute("data-tx-scope");
        document.querySelectorAll("[data-tx-scope]").forEach((x) => x.classList.toggle("active", x === b));
      });
    });
    el("txAttachReceipt")?.addEventListener("click", () => el("txReceiptInput")?.click());
    el("txReceiptInput")?.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file || !Receipts) return;
      const id = uid();
      await Receipts.putReceipt(id, file, { name: file.name, mime: file.type });
      pendingReceiptId = id;
      txDraft.receiptId = id;
      el("txReceiptStatus").textContent = file.name || "Receipt attached";
    });

    el("debtSheetOverlay")?.addEventListener("click", () => closeSheet("debtSheetOverlay", "debtSheet"));
    el("debtSheetClose")?.addEventListener("click", () => closeSheet("debtSheetOverlay", "debtSheet"));
    el("debtSave")?.addEventListener("click", saveDebtFromSheet);
    el("debtDelete")?.addEventListener("click", deleteDebtFromSheet);
    el("debtRecordPay")?.addEventListener("click", () => {
      const id = el("debtEditId").value;
      closeSheet("debtSheetOverlay", "debtSheet");
      openPaySheet(id);
    });

    el("paySheetOverlay")?.addEventListener("click", () => closeSheet("paySheetOverlay", "paySheet"));
    el("paySheetClose")?.addEventListener("click", () => closeSheet("paySheetOverlay", "paySheet"));
    el("paySave")?.addEventListener("click", savePaymentFromSheet);

    el("undoToastBtn")?.addEventListener("click", undoLast);

    el("btnOpenSettings")?.addEventListener("click", openSettings);
    el("btnCloseProfile")?.addEventListener("click", closeSettings);
    el("profileModal")?.addEventListener("click", (e) => {
      if (e.target === el("profileModal")) closeSettings();
    });
    el("displayName")?.addEventListener("change", () => {
      state.profile.displayName = el("displayName").value.trim();
      saveProfile();
    });
    el("prefDisplayCurrency")?.addEventListener("change", () => {
      state.preferences.currency = el("prefDisplayCurrency").value === "EUR" ? "EUR" : "GBP";
      savePlanner();
      refresh();
    });
    el("prefGbpPerEur")?.addEventListener("change", () => {
      state.preferences = mergePreferences({
        currency: state.preferences.currency,
        gbpPerEur: Number(el("prefGbpPerEur").value),
      });
      savePlanner();
      refresh();
    });
    el("btnExportBackup")?.addEventListener("click", runExportBackup);
    el("btnSaveNow")?.addEventListener("click", () => {
      savePlanner();
      saveProfile();
      const t = el("saveToast");
      t?.classList.remove("hidden");
      setTimeout(() => t?.classList.add("hidden"), 2000);
    });
    el("importBackupInput")?.addEventListener("change", async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (data.improverUxBackup !== 1 || !data.planner) {
          alert("This file is not a Veiro backup.");
          return;
        }
        applyPlannerPayload(data.planner);
        if (data.profile) {
          state.profile.displayName = data.profile.displayName || "";
          saveProfile();
        }
        if (data.photoDataUrl) setPhotoDataUrl(data.photoDataUrl);
        savePlanner();
        closeSettings();
        refresh();
      } catch (_) {
        alert("Could not read that backup file.");
      }
    });

    document.querySelectorAll(".auth-tab").forEach((tab) => {
      tab.addEventListener("click", () => {
        authTab = tab.getAttribute("data-tab");
        document.querySelectorAll(".auth-tab").forEach((t) => {
          const on = t === tab;
          t.classList.toggle("active", on);
          t.setAttribute("aria-selected", on ? "true" : "false");
        });
        el("confirmWrap")?.classList.toggle("hidden", authTab !== "register");
        el("btnAuthSubmit").textContent = authTab === "register" ? "Create account" : "Sign in";
      });
    });
    el("btnAuthSubmit")?.addEventListener("click", async () => {
      const err = el("authError");
      err?.classList.add("hidden");
      const email = el("authEmail").value;
      const password = el("authPassword").value;
      const msg =
        authTab === "register"
          ? await registerAccount(email, password, el("authConfirm").value)
          : await loginAccount(email, password);
      if (msg) {
        err.textContent = msg;
        err.classList.remove("hidden");
        return;
      }
      closeSettings();
      refresh();
    });
    el("btnSignOut")?.addEventListener("click", () => {
      signOut();
      closeSettings();
      refresh();
    });
    el("btnDeleteAccount")?.addEventListener("click", async () => {
      const fp = state.activeFingerprint;
      if (!fp) return;
      const blob = await loadCredential(fp);
      if (!blob) return;
      const ok = await verifyPassword(el("deletePassword").value, blob.salt, blob.hash);
      if (!ok) {
        alert("Incorrect password.");
        return;
      }
      localStorage.removeItem(STORAGE.cred(fp));
      localStorage.removeItem(STORAGE.planner(`email.${fp}`));
      localStorage.removeItem(STORAGE.profile(`email.${fp}`));
      localStorage.removeItem(STORAGE.photo(`email.${fp}`));
      signOut();
      closeSettings();
      refresh();
    });

    el("photoInput")?.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = "";
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        setPhotoDataUrl(String(reader.result));
        renderAvatar();
      };
      reader.readAsDataURL(file);
    });
    el("btnRemovePhoto")?.addEventListener("click", () => {
      setPhotoDataUrl(null);
      renderAvatar();
    });
  }

  function init() {
    loadSession();
    loadProfile();
    loadPlanner();
    bind();
    setRoute(parseHash(), false);
    paintIcons();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
