(function () {
  "use strict";

  const STORAGE = {
    sessionFp: "payoff.session.fingerprint",
    sessionEmail: "payoff.session.email",
    locale: "calmplan.locale",
    cred: (fp) => `payoff.cred.${fp}`,
    profile: (uk) => `payoff.profile.${uk}`,
    planner: (uk) => `payoff.planner.${uk}`,
    photo: (uk) => `payoff.photo.${uk}`,
  };

  const TIER_ORDER = { people: 0, overdraft: 1, other: 2 };

  const SAMPLE_LOANS = [
    { id: "", name: "Owe to a person (e.g. Alex)", balance: 600, apr: 0, monthlyPayment: 50, tier: "people", payments: [] },
    { id: "", name: "Another person", balance: 200, apr: 0, monthlyPayment: 20, tier: "people", payments: [] },
    { id: "", name: "Bank overdraft", balance: 800, apr: 39.9, monthlyPayment: 40, tier: "overdraft", payments: [] },
    { id: "", name: "PayPal Credit (balance)", balance: 400, apr: 23.9, monthlyPayment: 25, tier: "other", payments: [] },
  ];

  let state = {
    userKey: "guest",
    activeFingerprint: null,
    signedInEmail: null,
    profile: { displayName: "" },
    budget: { income: 900, mustPayBills: 400 },
    incomeItems: [{ id: "", name: "Salary / wages", amount: 900, date: "", done: false }],
    billItems: [
      { id: "", name: "Rent / housing", amount: 300, date: "", done: false },
      { id: "", name: "Bills & minimums", amount: 100, date: "", done: false },
    ],
    monthLog: [],
    businessLog: [],
    loans: [],
    investor: { monthlyStake: 0, bankroll: 0, target: 0, ladderLegs: 7, ladderOdds: 3, completedLegs: [] },
  };

  let chartInstance = null;
  let authTab = "signin";
  /** When editing latest business month, holds the removed entry until save or cancel. */
  let businessEditBackup = null;
  /** Business months table: which month row has line-item details expanded (entry id). */
  let businessOpenDetailId = null;

  let monthLogSortDir = "desc";
  let businessMonthSortDir = "desc";

  let incomeDateSortDir = "desc";
  let billDateSortDir = "desc";
  let currentLocale = "en";

  function uid() {
    return crypto.randomUUID();
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  }

  function tr(en, bg) {
    return currentLocale === "bg" ? bg : en;
  }

  const EN_BG_TEXT = {
    "Money": "Пари",
    "Debts": "Дългове",
    "Payoff": "Погасяване",
    "Business": "Бизнес",
    "Football": "Футбол",
    "Income": "Приходи",
    "Expenses": "Разходи",
    "Left after bills": "Остава след сметките",
    "Total income": "Общо приходи",
    "Total expenses": "Общо разходи",
    "Total profits": "Обща печалба",
    "Profit this month": "Печалба този месец",
    "Business months": "Бизнес месеци",
    "Past months": "Минали месеци",
    "Month": "Месец",
    "Left": "Остава",
    "Status": "Статус",
    "Debt": "Дълг",
    "Debt name": "Име на дълга",
    "Planned debt": "Планиран дълг",
    "Planned this month": "Планирано този месец",
    "Planned payments this month": "Планирани плащания този месец",
    "Add to plan": "Добави в плана",
    "Add a debt": "Добави дълг",
    "Add to my list": "Добави в списъка",
    "Across all debts": "Общ преглед на всички дългове",
    "Total still owed": "Общо оставащ дълг",
    "Payoff plan": "План за погасяване",
    "At a glance": "Накратко",
    "Where spare cash could go": "Къде може да отидат свободните пари",
    "Ways to attack the debt": "Начини за изплащане на дълга",
    "Total debt over time": "Общ дълг във времето",
    "Add current month": "Добави текущ месец",
    "Line": "Ред",
    "Total": "Общо",
    "No month saved yet.": "Още няма запазен месец.",
    "No business months yet.": "Още няма бизнес месеци.",
    "No snapshots yet.": "Още няма снимки.",
    "What you put in": "Какво влагаш",
    "Deposits (£)": "Депозити (£)",
    "Bankroll now (£)": "Текущ банкрол (£)",
    "Target (£), optional": "Цел (£), по желание",
    "Ladder legs": "Стъпки",
    "Odds each leg": "Коефициент на стъпка",
    "Scenario math": "Сметки по сценарий",
    "Stay in control": "Остани в контрол",
    "Record a payment": "Запиши плащане",
    "Amount you paid (£)": "Платена сума (£)",
    "Date (optional)": "Дата (по желание)",
    "Note (optional)": "Бележка (по желание)",
    "Save payment": "Запази плащане",
    "Cancel": "Отказ",
    "Add income": "Добави приход",
    "Add expense": "Добави разход",
    "Source": "Източник",
    "Amount (£)": "Сума (£)",
    "Profile": "Профил",
    "Choose photo": "Избери снимка",
    "Remove photo": "Премахни снимката",
    "Display name": "Показвано име",
    "Account": "Акаунт",
    "Data on this device": "Данни на това устройство",
    "Export backup (.json)": "Експортирай архив (.json)",
    "Import backup": "Импортирай архив",
    "Sign out": "Изход",
    "Delete account": "Изтрий акаунт",
    "Email": "Имейл",
    "Confirm password": "Потвърди паролата",
    "Sign in": "Вход",
    "Create account": "Създай акаунт",
    "Save month": "Запази месец",
    "Add month": "Добави месец",
    "Cancel edit": "Откажи редакция",
    "Adjust this month": "Коригирай месеца",
    "Totals from all saved business months.": "Обобщение за всички запазени бизнес месеци."
  };

  const EN_BG_ATTR = {
    "Open profile": "Отвори профил",
    "Switch language to BG": "Смени езика на EN",
    "Switch language to EN": "Смени езика на BG",
    "United Kingdom": "Великобритания",
    "Bulgaria": "България",
    "CalmPlan sections": "Секции на CalmPlan",
    "Business month records": "Записи за бизнес месеци",
    "Monthly snapshots": "Месечни снимки",
    "Planned debt payments": "Планирани плащания по дългове",
    "Latest month income and expenses": "Приходи и разходи за последния месец",
    "Open uxxuimate.com": "Отвори uxxuimate.com",
    "Skip to main content": "Към основното съдържание",
    "e.g. March 2025": "напр. Март 2025",
    "e.g. March 2026": "напр. Март 2026",
    "e.g. 20000": "напр. 20000"
  };

  function reverseMap(map) {
    const out = {};
    Object.keys(map).forEach((k) => {
      out[map[k]] = k;
    });
    return out;
  }

  function applyBulkLocaleTexts() {
    const toBg = currentLocale === "bg";
    const textMap = toBg ? EN_BG_TEXT : reverseMap(EN_BG_TEXT);
    const attrMap = toBg ? EN_BG_ATTR : reverseMap(EN_BG_ATTR);

    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const textNodes = [];
    while (walker.nextNode()) textNodes.push(walker.currentNode);
    textNodes.forEach((node) => {
      const raw = node.nodeValue || "";
      if (!raw.trim()) return;
      const compact = raw.replace(/\s+/g, " ").trim();
      const translated = textMap[compact];
      if (!translated) return;
      const lead = raw.match(/^\s*/)?.[0] || "";
      const trail = raw.match(/\s*$/)?.[0] || "";
      node.nodeValue = `${lead}${translated}${trail}`;
    });

    document.querySelectorAll("[placeholder]").forEach((elx) => {
      const cur = elx.getAttribute("placeholder") || "";
      if (attrMap[cur]) elx.setAttribute("placeholder", attrMap[cur]);
    });
    document.querySelectorAll("[aria-label]").forEach((elx) => {
      const cur = elx.getAttribute("aria-label") || "";
      if (attrMap[cur]) elx.setAttribute("aria-label", attrMap[cur]);
    });
  }

  /** Parse typed amounts (e.g. 19.99, 19,99) for business draft text inputs. */
  function parseBusinessAmountInput(raw) {
    if (raw == null) return 0;
    const s = String(raw).trim().replace(",", ".");
    if (!s) return 0;
    const n = parseFloat(s);
    return Number.isFinite(n) && n >= 0 ? round2(n) : 0;
  }

  function compareLineItemDateDesc(dateA, dateB) {
    const da = dateA && /^\d{4}-\d{2}-\d{2}$/.test(String(dateA).slice(0, 10)) ? String(dateA).slice(0, 10) : "";
    const db = dateB && /^\d{4}-\d{2}-\d{2}$/.test(String(dateB).slice(0, 10)) ? String(dateB).slice(0, 10) : "";
    if (!da && !db) return 0;
    if (!da) return 1;
    if (!db) return -1;
    return db.localeCompare(da);
  }

  function sortedLineItemDisplayOrder(items, dir = "desc") {
    return items
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        const cDesc = compareLineItemDateDesc(a.row.date, b.row.date);
        const order = dir === "asc" ? -cDesc : cDesc;
        return order !== 0 ? order : a.i - b.i;
      });
  }

  function sortMoneyItemsByDateDesc(arr) {
    if (!Array.isArray(arr)) return;
    arr.sort((a, b) => {
      const c = compareLineItemDateDesc(a.date, b.date);
      if (c !== 0) return c;
      return String(a.id || "").localeCompare(String(b.id || ""));
    });
  }

  function money(n) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", maximumFractionDigits: 0 }).format(n);
  }

  function moneyFull(n) {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n);
  }

  function padInvestorCompleted(inv) {
    const n = Math.min(30, Math.max(1, Math.round(Number(inv.ladderLegs) || 1)));
    inv.ladderLegs = n;
    const prev = Array.isArray(inv.completedLegs) ? inv.completedLegs.map(Boolean) : [];
    inv.completedLegs = Array.from({ length: n }, (_, i) => !!prev[i]);
    const prevDrafts = Array.isArray(inv.legDrafts) ? inv.legDrafts : [];
    inv.legDrafts = Array.from({ length: n }, (_, i) => {
      const d = prevDrafts[i] && typeof prevDrafts[i] === "object" ? prevDrafts[i] : {};
      return {
        start:
          d.start == null || d.start === "" || Number.isNaN(Number(d.start))
            ? null
            : Math.max(0, Number(d.start)),
        odds:
          d.odds == null || d.odds === "" || Number.isNaN(Number(d.odds))
            ? null
            : Math.max(1.01, Number(d.odds)),
      };
    });
  }

  function mergeInvestor(raw) {
    if (!raw || typeof raw !== "object") {
      const inv = { monthlyStake: 0, bankroll: 0, target: 0, ladderLegs: 7, ladderOdds: 3, completedLegs: [], legDrafts: [] };
      padInvestorCompleted(inv);
      return inv;
    }
    const inv = {
      monthlyStake: Math.max(0, Number(raw.monthlyStake) || 0),
      bankroll: Math.max(0, Number(raw.bankroll) || 0),
      target: Math.max(0, Number(raw.target) || 0),
      ladderLegs: Math.min(30, Math.max(1, Math.round(Number(raw.ladderLegs) || 7))),
      ladderOdds: Math.max(1.01, Number(raw.ladderOdds) || 3),
      completedLegs: Array.isArray(raw.completedLegs) ? raw.completedLegs.map(Boolean) : [],
      legDrafts: Array.isArray(raw.legDrafts) ? raw.legDrafts : [],
    };
    padInvestorCompleted(inv);
    return inv;
  }

  function defaultInvestorGuest() {
    const inv = { monthlyStake: 100, bankroll: 100, target: 20000, ladderLegs: 7, ladderOdds: 3, completedLegs: [], legDrafts: [] };
    padInvestorCompleted(inv);
    return inv;
  }

  function normalizeTier(t) {
    if (t === "people" || t === "overdraft" || t === "other") return t;
    return "other";
  }

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
    if (minTier === 0) {
      return bucket.reduce((best, x) => (x.balance < best.balance ? x : best)).i;
    }
    return bucket.reduce((best, x) => (x.annualRatePercent > best.annualRatePercent ? x : best)).i;
  }

  function simulate(loans, strategy, monthlyIncome, mustPayBills) {
    const states = loans.map((l) => ({
      id: l.id,
      name: l.name,
      balance: Math.max(0, Number(l.balance) || 0),
      annualRatePercent: Math.max(0, Number(l.apr) || 0),
      minimumPayment: Math.max(0, Number(l.monthlyPayment) || 0),
      tier: normalizeTier(l.tier),
    }));

    let totalInterest = 0;
    let totalPaid = 0;
    let months = 0;
    const maxMonths = 600;
    const history = [];
    const income = Math.max(0, monthlyIncome);
    const bills = Math.max(0, mustPayBills);

    while (months < maxMonths) {
      const totalBal = states.reduce((s, x) => s + x.balance, 0);
      history.push(round2(totalBal));
      if (totalBal <= 0.01) break;

      const active = states.filter((x) => x.balance > 0.01);
      const sumMin = active.reduce((s, x) => s + x.minimumPayment, 0);
      const available = income - bills;

      if (available + 0.001 < sumMin) {
        return {
          insolvent: true,
          totalInterest: round2(totalInterest),
          monthsToDebtFree: null,
          history,
          totalPaid: round2(totalPaid),
        };
      }

      const extra = available - sumMin;

      for (let i = 0; i < states.length; i++) {
        if (states[i].balance <= 0.01) continue;
        const monthlyRate = states[i].annualRatePercent / 100 / 12;
        const interest = round2(states[i].balance * monthlyRate);
        states[i].balance = round2(states[i].balance + interest);
        totalInterest = round2(totalInterest + interest);
      }

      for (let i = 0; i < states.length; i++) {
        if (states[i].balance <= 0.01) continue;
        const pay = Math.min(states[i].minimumPayment, states[i].balance);
        states[i].balance = round2(states[i].balance - pay);
        totalPaid = round2(totalPaid + pay);
      }

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

    const finalTotal = states.reduce((s, x) => s + x.balance, 0);
    const debtFree = finalTotal <= 0.01 ? months : null;
    return {
      insolvent: false,
      totalInterest: round2(totalInterest),
      monthsToDebtFree: debtFree,
      history,
      totalPaid: round2(totalPaid),
    };
  }

  function strategySubtext(r) {
    if (r.insolvent) return tr("These numbers don’t cover every planned payment this month", "Тези числа не покриват всички планирани плащания този месец");
    if (r.monthsToDebtFree != null) return tr("Rough interest over the journey", "Ориентировъчна лихва за периода") + `: ${moneyFull(r.totalInterest)}`;
    return tr("On paper this mix may not reach zero, check rates and monthly payments", "По сметки този план може да не стигне до нула - провери лихвите и месечните плащания");
  }

  function priorityExtraTarget(loanStates) {
    const states = loanStates.map((l, i) => ({
      name: l.name,
      balance: Number(l.balance) || 0,
      apr: Number(l.apr) || 0,
      tier: normalizeTier(l.tier),
      i,
    }));
    const active = states.filter((x) => x.balance > 0.01);
    if (!active.length) return null;
    const minTier = Math.min(...active.map((x) => TIER_ORDER[x.tier] ?? 2));
    const bucket = active.filter((x) => (TIER_ORDER[x.tier] ?? 2) === minTier);
    let pick;
    if (minTier === 0) {
      pick = bucket.reduce((b, x) => (x.balance < b.balance ? x : b));
      return { name: pick.name, reason: tr("For people you know, we start with the smallest balance, quick wins and clearer heads.", "За дългове към близки започваме от най-малкия баланс - бързи резултати и по-ясна картина.") };
    }
    pick = bucket.reduce((b, x) => (x.apr > b.apr ? x : b));
    const label = minTier === 1
      ? tr("On overdraft / bank debt", "При овърдрафт / банков дълг")
      : tr("In this bucket", "В тази група");
    return { name: pick.name, reason: `${label}, ${tr("the steepest rate is", "най-високата лихва е")} ${pick.apr.toFixed(1)}%, ${tr("that’s where extra hurts least to ignore.", "там допълнителното плащане има най-голям ефект.")}` };
  }

  async function emailFingerprint(email) {
    const norm = email.trim().toLowerCase();
    const buf = new TextEncoder().encode(norm);
    const hash = await crypto.subtle.digest("SHA-256", buf);
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  }

  function randomSalt() {
    const a = new Uint8Array(16);
    crypto.getRandomValues(a);
    return a;
  }

  async function hashPassword(password, salt) {
    const enc = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveBits"]);
    const bits = await crypto.subtle.deriveBits(
      { name: "PBKDF2", salt, iterations: 120000, hash: "SHA-256" },
      keyMaterial,
      256
    );
    return new Uint8Array(bits);
  }

  function b64(u8) {
    let s = "";
    for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i]);
    return btoa(s);
  }

  function b64decode(s) {
    const bin = atob(s);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function validEmail(e) {
    const x = e.trim().toLowerCase();
    return x.length >= 5 && x.includes("@") && x.split("@").length === 2;
  }

  async function saveCredential(fp, password) {
    const salt = randomSalt();
    const hash = await hashPassword(password, salt);
    localStorage.setItem(STORAGE.cred(fp), JSON.stringify({ salt: b64(salt), hash: b64(hash) }));
  }

  async function loadCredential(fp) {
    const raw = localStorage.getItem(STORAGE.cred(fp));
    if (!raw) return null;
    try {
      const o = JSON.parse(raw);
      return { salt: b64decode(o.salt), hash: b64decode(o.hash) };
    } catch {
      return null;
    }
  }

  async function verifyPassword(password, salt, storedHash) {
    const h = await hashPassword(password, salt);
    if (h.length !== storedHash.length) return false;
    for (let i = 0; i < h.length; i++) if (h[i] !== storedHash[i]) return false;
    return true;
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(at)) at = new Date().toISOString().slice(0, 10);
    const note = typeof p.note === "string" ? p.note.slice(0, 200) : "";
    return { id: p.id || uid(), amount, at, note };
  }

  function migrateLoans(loans) {
    if (!Array.isArray(loans)) return [];
    return loans.map((l) => {
      const rawPay = Array.isArray(l.payments) ? l.payments.map(paymentFromRaw).filter(Boolean) : [];
      const monthlyPayment = Math.max(
        0,
        Number(l.monthlyPayment) || (Number(l.minPayment) || 0) + (Number(l.extraMonthly) || 0)
      );
      return {
        id: l.id || uid(),
        name: typeof l.name === "string" ? l.name : "",
        balance: Number(l.balance) || 0,
        apr: Number(l.apr) || 0,
        monthlyPayment,
        tier: normalizeTier(l.tier),
        payments: rawPay,
      };
    });
  }

  function lineItemFromRaw(raw) {
    if (!raw || typeof raw !== "object") return { id: uid(), name: "", amount: 0, date: "", done: false };
    return {
      id: raw.id || uid(),
      name: raw.name || "",
      amount: Number(raw.amount) || 0,
      date: typeof raw.date === "string" ? raw.date : "",
      done: typeof raw.done === "boolean" ? raw.done : false,
    };
  }

  function businessLineFromRaw(raw) {
    if (!raw || typeof raw !== "object") return { id: uid(), name: "", amount: 0 };
    return {
      id: raw.id || uid(),
      name: typeof raw.name === "string" ? raw.name.slice(0, 120) : "",
      amount: Math.max(0, Number(raw.amount) || 0),
    };
  }

  function businessEntryFromRaw(raw) {
    if (!raw || typeof raw !== "object") {
      return { id: uid(), label: "", income: 0, expenses: 0, incomeItems: [], expenseItems: [] };
    }
    const id = raw.id || uid();
    const label = typeof raw.label === "string" ? raw.label.slice(0, 40) : "";
    let incomeItems = Array.isArray(raw.incomeItems) ? raw.incomeItems.map(businessLineFromRaw) : [];
    let expenseItems = Array.isArray(raw.expenseItems) ? raw.expenseItems.map(businessLineFromRaw) : [];
    let income = Math.max(0, Number(raw.income) || 0);
    let expenses = Math.max(0, Number(raw.expenses) || 0);
    if (!incomeItems.length && income > 0) {
      incomeItems = [{ id: uid(), name: "Income", amount: round2(income) }];
    }
    if (!expenseItems.length && expenses > 0) {
      expenseItems = [{ id: uid(), name: "Expense", amount: round2(expenses) }];
    }
    const sumInc = round2(incomeItems.reduce((s, x) => s + (Number(x.amount) || 0), 0));
    const sumExp = round2(expenseItems.reduce((s, x) => s + (Number(x.amount) || 0), 0));
    if (incomeItems.length) income = sumInc;
    if (expenseItems.length) expenses = sumExp;
    return { id, label, income, expenses, incomeItems, expenseItems };
  }

  function businessMonthTotals(entry) {
    const inc = Array.isArray(entry.incomeItems) && entry.incomeItems.length
      ? round2(entry.incomeItems.reduce((s, x) => s + (Number(x.amount) || 0), 0))
      : round2(Number(entry.income) || 0);
    const exp = Array.isArray(entry.expenseItems) && entry.expenseItems.length
      ? round2(entry.expenseItems.reduce((s, x) => s + (Number(x.amount) || 0), 0))
      : round2(Number(entry.expenses) || 0);
    return { income: inc, expenses: exp };
  }

  function applyPlannerPayload(o) {
    if (!o || typeof o !== "object") return false;
    const income = Number(o.income) || 0;
    const mustPay = o.mustPayBills != null ? Number(o.mustPayBills) : Number(o.expenses) || 0;
    state.budget = { income, mustPayBills: mustPay };
    state.loans = migrateLoans(Array.isArray(o.loans) ? o.loans : []);
    state.billItems = Array.isArray(o.billItems) ? o.billItems.map(lineItemFromRaw) : [];
    state.incomeItems = Array.isArray(o.incomeItems) ? o.incomeItems.map(lineItemFromRaw) : [];
    if (state.incomeItems.length === 0 && income > 0) {
      state.incomeItems = [{ id: uid(), name: "Income", amount: income, date: todayYmd(), done: false }];
    }
    if (state.billItems.length === 0 && mustPay > 0) {
      state.billItems = [{ id: uid(), name: "Expenses", amount: mustPay, date: todayYmd(), done: false }];
    }
    sortMoneyItemsByDateDesc(state.incomeItems);
    sortMoneyItemsByDateDesc(state.billItems);
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
    return true;
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
    if (key === "guest") {
      state.budget = { income: 900, mustPayBills: 400 };
      state.incomeItems = [{ id: uid(), name: "Salary / wages", amount: 900, date: todayYmd(), done: false }];
      state.billItems = [
        { id: uid(), name: "Rent / housing", amount: 300, date: todayYmd(), done: false },
        { id: uid(), name: "Bills & minimums", amount: 100, date: todayYmd(), done: false },
      ];
      sortMoneyItemsByDateDesc(state.incomeItems);
      sortMoneyItemsByDateDesc(state.billItems);
      state.monthLog = [];
      state.businessLog = [];
      state.loans = SAMPLE_LOANS.map((l) => ({ ...l, id: uid() }));
      state.investor = defaultInvestorGuest();
    } else {
      state.budget = { income: 0, mustPayBills: 0 };
      state.incomeItems = [];
      state.billItems = [];
      state.monthLog = [];
      state.businessLog = [];
      state.loans = [];
      state.investor = mergeInvestor(null);
    }
  }

  function savePlanner() {
    const key = plannerKeyFromSession();
    state.userKey = key;
    localStorage.setItem(
      STORAGE.planner(key),
      JSON.stringify({
        income: state.budget.income,
        mustPayBills: state.budget.mustPayBills,
        incomeItems: state.incomeItems,
        billItems: state.billItems,
        monthLog: state.monthLog,
        businessLog: state.businessLog,
        loans: state.loans,
        investor: state.investor,
      })
    );
  }

  function loadProfile() {
    const key = plannerKeyFromSession();
    const raw = localStorage.getItem(STORAGE.profile(key));
    if (raw) {
      try {
        const o = JSON.parse(raw);
        state.profile.displayName = o.displayName || "";
        return;
      } catch (_) {}
    }
    state.profile.displayName = "";
  }

  function saveProfile() {
    const key = plannerKeyFromSession();
    localStorage.setItem(STORAGE.profile(key), JSON.stringify({ displayName: state.profile.displayName }));
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

  async function registerAccount(email, password, confirm) {
    if (!validEmail(email)) return "Enter a valid email address.";
    if (password.length < 8) return "Use at least 8 characters for your password.";
    if (password !== confirm) return "Passwords do not match.";
    const fp = await emailFingerprint(email);
    if (localStorage.getItem(STORAGE.cred(fp))) return "This email is already registered. Sign in instead.";
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
    if (!validEmail(email)) return "Enter a valid email address.";
    if (password.length < 8) return "Use at least 8 characters.";
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

  async function deleteAccount(password) {
    const fp = state.activeFingerprint;
    if (!fp) return "Not signed in.";
    const blob = await loadCredential(fp);
    if (!blob) return "No credentials.";
    const ok = await verifyPassword(password, blob.salt, blob.hash);
    if (!ok) return "Incorrect password.";
    const uk = plannerKeyFromSession();
    localStorage.removeItem(STORAGE.planner(uk));
    localStorage.removeItem(STORAGE.profile(uk));
    localStorage.removeItem(STORAGE.photo(uk));
    localStorage.removeItem(STORAGE.cred(fp));
    signOut();
    return null;
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setBusinessAddDetailsOpen(shouldOpen) {
    const d = el("businessAddDetails");
    if (d && typeof shouldOpen === "boolean") d.open = shouldOpen;
  }

  function scrollBusinessAddCardIntoView() {
    const card = el("businessAddCard");
    if (!card) return;
    const smooth = !(typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        card.scrollIntoView({ behavior: smooth ? "smooth" : "auto", block: "start" });
      });
    });
  }

  function applyLocaleBadge(locale) {
    const code = el("localeCode");
    const flag = el("localeFlag");
    const btn = el("btnLocaleToggle");
    const isBg = locale === "bg";
    if (code) code.textContent = isBg ? "BG" : "EN";
    if (flag) {
      flag.style.backgroundImage = isBg ? 'url("Bulgaria.png")' : 'url("United Kingdom.png")';
      flag.setAttribute("aria-label", isBg ? "Bulgaria" : "United Kingdom");
    }
    if (btn) btn.setAttribute("aria-label", isBg ? "Switch language to EN" : "Switch language to BG");
  }

  function applyLocaleUI() {
    const isBg = currentLocale === "bg";
    const lang = isBg ? "bg" : "en-GB";
    document.documentElement.lang = lang;

    const safeQuery = (selector) => {
      try {
        return document.querySelector(selector);
      } catch (_) {
        return null;
      }
    };

    const setText = (selector, en, bg) => {
      const n = safeQuery(selector);
      if (n) n.textContent = isBg ? bg : en;
    };
    const setHtml = (selector, en, bg) => {
      const n = safeQuery(selector);
      if (n) n.innerHTML = isBg ? bg : en;
    };
    const setAttr = (selector, attr, en, bg) => {
      const n = safeQuery(selector);
      if (n) n.setAttribute(attr, isBg ? bg : en);
    };

    setText(".skip-link", "Skip to main content", "Към основното съдържание");
    setText(".tagline", "Your money, your debts", "Твоите пари, твоите дългове");
    setAttr(".app-tab-bar", "aria-label", "CalmPlan sections", "Секции на CalmPlan");
    setText("#tabBtnMoney .app-tab-text", "Money", "Пари");
    setText("#tabBtnDebts .app-tab-text", "Debts", "Дългове");
    setText("#tabBtnPayoff .app-tab-text", "Payoff", "Погасяване");
    setText("#tabBtnBusiness .app-tab-text", "Business", "Бизнес");
    setText("#tabBtnInvestor .app-tab-text", "Football", "Футбол");

    setText("#panelMoney .panel-title", "Money this month", "Пари този месец");
    setText(
      "#panelMoney .panel-sub.muted",
      "Add what comes in and what has to go out. We’ll show what’s left for debt payments.",
      "Добави какво влиза и какво излиза. Ще ти покажем колко остава за плащания по дългове."
    );
    setText(
      ".panel-sub--autosave",
      "Saves automatically on this device - export a backup from Profile if you change phones or clear browser data.",
      "Запазва се автоматично на това устройство - експортирай архив от Профил, ако сменяш телефон или изчистиш данните на браузъра."
    );
    setText("#moneyQuickLeftLabel", "Left after bills", "Остава след сметките");
    setText(".money-quick-cards article:nth-child(1) .money-quick-card__label", "Income", "Приходи");
    setText(".money-quick-cards article:nth-child(2) .money-quick-card__label", "Expenses", "Разходи");
    setHtml("#money-income-heading", '<i data-lucide="wallet" aria-hidden="true"></i> Income', '<i data-lucide="wallet" aria-hidden="true"></i> Приходи');
    setHtml("#money-expenses-heading", '<i data-lucide="receipt" aria-hidden="true"></i> Expenses', '<i data-lucide="receipt" aria-hidden="true"></i> Разходи');
    setHtml("#btnAddIncomeItem", '<i data-lucide="plus"></i> Add income', '<i data-lucide="plus"></i> Добави приход');
    setHtml("#btnAddBillItem", '<i data-lucide="plus"></i> Add expense', '<i data-lucide="plus"></i> Добави разход');
    setText("#months-log-heading", "Past months", "Минали месеци");
    setText('#panelMoney .card[aria-labelledby="months-log-heading"] .hint', "Save a snapshot when you want a record. It won’t change your live numbers.", "Запази снимка, когато искаш запис. Това не променя текущите числа.");
    setAttr("#monthLogLabel", "placeholder", "e.g. March 2025", "напр. Март 2025");
    setText("#monthLogTable thead th:nth-child(1)", "Month", "Месец");
    setText("#monthLogTable thead th:nth-child(2)", "Income", "Приходи");
    setText("#monthLogTable thead th:nth-child(3)", "Expenses", "Разходи");
    setText("#monthLogTable thead th:nth-child(4)", "Left", "Остава");
    setHtml("#btnAddMonthLog", '<i data-lucide="calendar-plus"></i> Save snapshot', '<i data-lucide="calendar-plus"></i> Запази снимка');
    setText("#monthLogEmpty", "No snapshots yet.", "Още няма снимки.");

    setText("#panelDebts .panel-title", "Your debts", "Твоите дългове");
    setText("#panelDebts .panel-sub", "Add each debt as its own card. Optionally set Payment this month (£) when you add it so we can total your plan and pre-fill Record payment. When you pay, tap Record payment to lower the balance.", "Добави всеки дълг като отделна карта. По желание задай Плащане този месец (£), за да изчислим плана и да попълним Запиши плащане. Когато платиш, натисни Запиши плащане, за да намалиш остатъка.");
    setText('#panelDebts .debts-month-card .hint', 'We add up Payment this month (£) from Add a debt (per card). Use Record payment to log what you actually paid. “What’s left” after bills comes from the Money tab.', "Събираме Плащане този месец (£) от Добави дълг (по карта). Използвай Запиши плащане, за да запишеш реално платеното. „Остава“ след сметките идва от таб Пари.");
    setText('.debt-add-details__eyebrow', "Open to enter a new debt", "Отвори, за да въведеш нов дълг");
    setText('#debtAddDetails .hint', "Fill this in, then Add to my list. It becomes a card you can edit, pay down, or remove anytime.", "Попълни това и натисни Добави в списъка. Ще стане карта, която можеш да редактираш, плащаш или премахваш по всяко време.");
    setText('#debtAddDetails .field-label:nth-of-type(1)', "Who or what you owe", "На кого или за какво дължиш");
    setText('#debtAddDetails .field-label:nth-of-type(2)', "Balance left (£)", "Оставащ баланс (£)");
    setText('#debtAddDetails .field-label:nth-of-type(3)', "Interest rate % (0 if none)", "Лихва % (0 ако няма)");
    setText('#debtAddDetails .field-label:nth-of-type(4)', "Payment this month (£)", "Плащане този месец (£)");
    setText('#debtAddDetails .field-label:nth-of-type(5)', "Type (affects payoff order)", "Тип (влияе на реда за погасяване)");
    setText('#debtDraftTier option[value="people"]', "Someone you know (friend, family…)", "Близък човек (приятел, семейство…)");
    setText('#debtDraftTier option[value="overdraft"]', "Overdraft or bank line", "Овърдрафт или банков дълг");
    setText('#debtDraftTier option[value="other"]', "Card, loan, Buy Now Pay Later…", "Карта, заем, купи сега плати после…");
    setText('#debtsTotalsSection .hint', "Running total from every card above.", "Общ сбор от всички карти по-горе.");
    setText('#debtsTotalsSection .money-lines-total .muted.small', "Total still owed", "Общо оставащ дълг");
    setHtml("#debts-plan-heading", '<i data-lucide="banknote" aria-hidden="true"></i> Planned payments this month', '<i data-lucide="banknote" aria-hidden="true"></i> Планирани плащания този месец');
    setHtml("#debt-add-heading", '<i data-lucide="plus-circle" aria-hidden="true"></i> Add a debt', '<i data-lucide="plus-circle" aria-hidden="true"></i> Добави дълг');
    setHtml("#btnCommitLoan", '<i data-lucide="check"></i> Add to my list', '<i data-lucide="check"></i> Добави в списъка');
    setHtml("#debts-totals-heading", '<i data-lucide="calculator" aria-hidden="true"></i> Across all debts', '<i data-lucide="calculator" aria-hidden="true"></i> Общ преглед на всички дългове');

    setText("#panelPayoff .panel-title", "Payoff plan", "План за погасяване");
    setText('#panelPayoff .panel-sub', "A suggested order, two classic methods to compare, and a chart of total debt shrinking.", "Предложен ред, два класически метода за сравнение и графика как общият дълг намалява.");
    setText("#payoffAtAGlance .payoff-at-a-glance__title", "At a glance", "Накратко");
    setText("#focusSection .section-label.tight", "Where spare cash could go", "Къде може да отидат свободните пари");
    setText("#panelPayoff .priority-hero .card-heading", "Our default: people first", "По подразбиране: първо близки хора");
    setText('#panelPayoff .priority-hero .tiny.muted', "Extra cash goes to people you know first (smallest balance), then overdraft (highest rate), then everything else.", "Допълнителните пари отиват първо към близки хора (най-малък баланс), после овърдрафт (най-висока лихва), после всичко останало.");
    setText("#panelPayoff .strategy-grid .mint .card-heading", "Highest rate first (avalanche)", "Първо най-висока лихва (avalanche)");
    setText("#panelPayoff .strategy-grid .mint .tiny.muted", "Always hit the biggest interest rate. Ignores the “people first” idea.", "Винаги атакува най-високата лихва. Игнорира „първо близки хора“.");
    setText("#panelPayoff .strategy-grid .violet .card-heading", "Smallest balance first (snowball)", "Първо най-малък баланс (snowball)");
    setText("#panelPayoff .strategy-grid .violet .tiny.muted", "Clear small debts for momentum. Ignores categories and rates.", "Погасява малките дългове за инерция. Игнорира категории и лихви.");
    setText("#chartEmpty", "Add at least one debt on the Debts tab to see this chart.", "Добави поне един дълг в таб Дългове, за да видиш тази графика.");
    setText("#strategy-heading", "Ways to attack the debt", "Начини за изплащане на дълга");
    setText("#chart-heading", "Total debt over time", "Общ дълг във времето");

    setText("#panelBusiness .panel-title", "Business", "Бизнес");
    setText("#panelBusiness .panel-sub", "Simple monthly tracking: income, expenses, and clear profit numbers.", "Лесно месечно проследяване: приходи, разходи и ясна печалба.");
    setText(".business-add-details__eyebrow", "Open to enter income and expenses", "Отвори, за да въведеш приходи и разходи");
    setText("#businessMonthLabel", "", "");
    setAttr("#businessMonthLabel", "placeholder", "e.g. March 2026", "напр. Март 2026");
    setText('#panelBusiness .business-month-field .field-label', "Month", "Месец");
    setText('#panelBusiness .business-draft-block--income .business-draft-block-title', "Income", "Приходи");
    setText('#panelBusiness .business-draft-block--expense .business-draft-block-title', "Expenses", "Разходи");
    setHtml("#btnBusinessAddIncome", '<i data-lucide="plus"></i> Line', '<i data-lucide="plus"></i> Ред');
    setHtml("#btnBusinessAddExpense", '<i data-lucide="plus"></i> Line', '<i data-lucide="plus"></i> Ред');
    setText('#panelBusiness .business-draft-block--income .business-draft-total .muted.small', "Total", "Общо");
    setText('#panelBusiness .business-draft-block--expense .business-draft-total .muted.small', "Total", "Общо");
    setText("#businessLatestMonthLabel", "No month saved yet.", "Още няма запазен месец.");
    setText("#businessProfitBreakdown .business-profit-breakdown__row:nth-child(1) .muted.small", "Income", "Приходи");
    setText("#businessProfitBreakdown .business-profit-breakdown__row:nth-child(2) .muted.small", "Expenses", "Разходи");
    setHtml("#btnBusinessEditLatest", '<i data-lucide="pencil"></i> Adjust this month', '<i data-lucide="pencil"></i> Коригирай месеца');
    setText("#btnBusinessCancelEdit", "Cancel edit", "Откажи редакция");
    setText("#panelBusiness .business-summary-card[aria-labelledby='business-profit-heading'] .business-summary-hint", "Latest saved month. Use Adjust to edit it in the form above.", "Последно запазен месец. Използвай Коригирай, за да редактираш във формата горе.");
    setText("#businessSummaryTotalsLead", "Totals from all saved business months.", "Обобщение за всички запазени бизнес месеци.");
    setText('#panelBusiness [aria-labelledby="business-history-heading"] .hint', "Tap or click a month to see each income and expense line. You can adjust any month from the details panel.", "Натисни месец, за да видиш всеки ред приход и разход. Можеш да коригираш всеки месец от панела с детайли.");
    setText("#businessMonthTable thead th:nth-child(1)", "Month", "Месец");
    setText("#businessMonthTable thead th:nth-child(2)", "Income", "Приходи");
    setText("#businessMonthTable thead th:nth-child(3)", "Expenses", "Разходи");
    setText("#businessMonthTable thead th:nth-child(4)", "Profit", "Печалба");
    setHtml("#business-input-heading", '<i data-lucide="calendar-range" aria-hidden="true"></i> Add current month', '<i data-lucide="calendar-range" aria-hidden="true"></i> Добави текущ месец');
    setText("#business-profit-heading", "Profit this month", "Печалба този месец");
    setText("#business-total-heading", "Total profits", "Обща печалба");
    setText("#business-total-income-heading", "Total income", "Общо приходи");
    setText("#business-total-expense-heading", "Total expenses", "Общо разходи");
    setText("#business-history-heading", "Business months", "Бизнес месеци");
    setText("#businessMonthEmpty", "No business months yet.", "Още няма бизнес месеци.");

    setText("#panelInvestor .panel-title", "Football", "Футбол");
    setText("#panelInvestor .panel-sub", "Plan how monthly deposits could compound. Illustrative numbers only, not advice or encouragement to gamble.", "Планирай как месечните депозити могат да се натрупват. Само илюстративни числа, не е съвет или насърчаване за залагане.");
    setText("#inv-inputs-heading", "What you put in", "Какво влагаш");
    setText('#panelInvestor .field-label', "Deposits (£)", "Депозити (£)");
    setText('#panelInvestor .row.two .field:nth-child(2) .field-label', "Bankroll now (£)", "Текущ банкрол (£)");
    setText('#panelInvestor .field.full .field-label', "Target (£), optional", "Цел (£), по желание");
    setAttr("#invTarget", "placeholder", "e.g. 20000", "напр. 20000");
    setText('#panelInvestor .row.two:nth-of-type(2) .field:nth-child(1) .field-label', "Ladder legs", "Стъпки");
    setText('#panelInvestor .row.two:nth-of-type(2) .field:nth-child(2) .field-label', "Odds each leg", "Коефициент на стъпка");
    setHtml("#invPreset73", '<i data-lucide="layers"></i> 7 legs × 3', '<i data-lucide="layers"></i> 7 стъпки × 3');
    setText("#inv-out-heading", "Scenario math", "Сметки по сценарий");
    setText("#invLadderWrap .investor-block-title", "Each day: previous balance × odds (full re-stake). Day 1 uses your bankroll as the starting amount.", "Всеки ден: предишен баланс × коефициент (пълно преиграване). Ден 1 използва банкрола като начална сума.");
    setText("#panelInvestor .investor-footnote", "Each “step” or “day” here means one winning leg at the stated odds. Tick Done when you’ve completed that day’s leg (saved with your plan). Real outcomes are not guaranteed.", "Всяка „стъпка“ или „ден“ тук означава един печеливш ход при зададения коефициент. Отбележи Готово, когато изпълниш стъпката за деня (запазва се с плана). Реалните резултати не са гарантирани.");
    setHtml("#inv-rem-heading", '<i data-lucide="shield-check"></i> Stay in control', '<i data-lucide="shield-check"></i> Остани в контрол');
    setText("#panelInvestor .investor-rules li:nth-child(1)", "Cap selections: avoid stacking more than three picks on one ticket.", "Ограничи селекциите: избягвай повече от три избора в един фиш.");
    setText("#panelInvestor .investor-rules li:nth-child(2)", "Treat this tab as a calculator, not a reason to chase losses.", "Използвай този таб като калкулатор, не като причина да гониш загуби.");
    setText("#panelInvestor .investor-rules li:nth-child(3)", "Patience: small, rare stakes beat all-in pressure.", "Търпение: малките и редки залози са по-добри от all-in натиск.");

    setText("#payDebtTitle", "Record a payment", "Запиши плащане");
    setHtml("#btnPayDebtConfirm", '<i data-lucide="check"></i> Save payment', '<i data-lucide="check"></i> Запази плащане');
    setText("#btnPayDebtCancel", "Cancel", "Отказ");
    setText("#addIncomeTitle", "Add income", "Добави приход");
    setHtml("#btnAddIncomeConfirm", '<i data-lucide="check"></i> Add income', '<i data-lucide="check"></i> Добави приход');
    setText("#btnAddIncomeCancel", "Cancel", "Отказ");
    setText("#addExpenseTitle", "Add expense", "Добави разход");
    setHtml("#btnAddExpenseConfirm", '<i data-lucide="check"></i> Add expense', '<i data-lucide="check"></i> Добави разход');
    setText("#btnAddExpenseCancel", "Cancel", "Отказ");
    setText("#profileTitle", "Profile", "Профил");
    setHtml("#btnRemovePhoto", '<i data-lucide="image-off"></i> Remove photo', '<i data-lucide="image-off"></i> Премахни снимката');
    setText('#profileModal label[for], #profileModal .field-label', "Display name", "Показвано име");
    setText("#accountPanel .section-label.tight", "Account", "Акаунт");
    setText("#accountStatus", "Guest on this device", "Гост на това устройство");
    setText("#accountPanel .data-local-block .section-label.tight", "Data on this device", "Данни на това устройство");
    setHtml("#btnExportBackup", '<i data-lucide="download"></i> Export backup (.json)', '<i data-lucide="download"></i> Експортирай архив (.json)');
    setText(".backup-import-text", "Import backup", "Импортирай архив");
    setText("#btnSignOut", "Sign out", "Изход");
    setText("#btnDeleteAccount", "Delete account", "Изтрий акаунт");
    setText("#btnAuthSubmit", authTab === "register" ? "Create account" : "Sign in", authTab === "register" ? "Създай акаунт" : "Вход");
    setText('.auth-tab[data-tab="signin"]', "Sign in", "Вход");
    setText('.auth-tab[data-tab="register"]', "Create account", "Създай акаунт");
    setText('#guestAuth label:nth-of-type(1) .field-label', "Email", "Имейл");
    setText('#guestAuth label:nth-of-type(2) .field-label', "Password (min 8 characters)", "Парола (мин. 8 символа)");
    setText('#confirmWrap .field-label', "Confirm password", "Потвърди паролата");

    setHtml(
      ".site-footer-legal__meta",
      "© 2026 · All rights reserved · Designed by",
      "© 2026 · Всички права запазени · Дизайн от"
    );

    const title = document.querySelector("title");
    if (title) title.textContent = "CalmPlan";
    const desc = document.querySelector('meta[name="description"]');
    if (desc) {
      desc.setAttribute(
        "content",
        isBg
          ? "CalmPlan - планирай приходи, задължителни разходи и изплащане на дългове на едно място."
          : "CalmPlan - plan income, must-pay bills, and debt payoff in one place. UK."
      );
    }
    applyBulkLocaleTexts();
    paintIcons();
  }

  function bindLocaleToggle() {
    const btn = el("btnLocaleToggle");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    try {
      const saved = localStorage.getItem(STORAGE.locale);
      if (saved === "bg" || saved === "en") currentLocale = saved;
    } catch (_) {}
    applyLocaleBadge(currentLocale);
    applyLocaleUI();
    btn.addEventListener("click", () => {
      currentLocale = currentLocale === "en" ? "bg" : "en";
      applyLocaleBadge(currentLocale);
      applyLocaleUI();
      refresh();
      renderInvestor();
      try {
        localStorage.setItem(STORAGE.locale, currentLocale);
      } catch (_) {}
    });
  }

  function syncBusinessMonthSubmitLabel() {
    const span = el("businessMonthSubmitLabel");
    const btn = el("btnAddBusinessMonth");
    const editing = !!businessEditBackup;
    if (span) span.textContent = editing ? (currentLocale === "bg" ? "Запази месец" : "Save month") : (currentLocale === "bg" ? "Добави месец" : "Add month");
    if (btn) {
      btn.setAttribute(
        "aria-label",
        editing
          ? currentLocale === "bg"
            ? "Запази промените за този бизнес месец"
            : "Save updates to this business month"
          : currentLocale === "bg"
            ? "Добави нов бизнес месец към записите"
            : "Add a new business month to your records"
      );
    }
  }

  function setDebtAddDetailsOpen(shouldOpen) {
    const d = el("debtAddDetails");
    if (d && typeof shouldOpen === "boolean") d.open = shouldOpen;
  }

  function setPlannedDebtDetailsOpen(shouldOpen) {
    const d = el("plannedDebtDetails");
    if (d && typeof shouldOpen === "boolean") d.open = shouldOpen;
  }

  function node(tag, className) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    return n;
  }

  const DEBT_TIER_OPTIONS = [
    ["people", "Someone you know"],
    ["overdraft", "Overdraft / bank"],
    ["other", "Card, loan, BNPL…"],
  ];

  function buildMoneyLineRow(row, index, field, indexAttr, delAttr) {
    const wrap = node("div", "bill-line");
    const src = node("span", "money-cell-text bill-line-source");
    src.setAttribute("aria-label", tr("Name", "Име"));
    src.textContent = row.name || "";

    const amt = node("span", "money-cell-text bill-line-amount money-cell-text--amount");
    amt.setAttribute("aria-label", tr("Amount", "Сума"));
    // Match the existing look: amounts in the rows are displayed without the "£" symbol.
    amt.textContent = money(row.amount || 0);

    const dt = node("span", "money-cell-text bill-line-date money-cell-text--date");
    dt.setAttribute("aria-label", tr("Date", "Дата"));
    dt.textContent = formatDateDMY(row.date || "");

    const btn = node("button", "money-row-x bill-line-del");
    btn.type = "button";
    btn.setAttribute("aria-label", tr("Remove line", "Премахни ред"));
    btn.setAttribute(delAttr, String(index));
    const ix = node("i");
    ix.setAttribute("data-lucide", "x");
    btn.appendChild(ix);

    wrap.append(src, amt, dt, btn);
    return wrap;
  }

  function buildMoneyTableRow(row, index, field) {
    // field: "income" | "bill"
    const tr = node("tr", "");
    const isIncome = field === "income";
    const idxAttr = isIncome ? "data-ii" : "data-i";
    const delAttr = isIncome ? "data-income-del" : "data-bill-del";
    const kPrefix = isIncome ? "data-income" : "data-bill";

    const tdName = node("td");
    const src = node("input", "money-line-input money-line-input--name");
    src.type = "text";
    src.value = row.name || "";
    src.setAttribute(kPrefix, "name");
    src.setAttribute(idxAttr, String(index));
    tdName.appendChild(src);

    const tdAmt = node("td");
    const amt = node("input", "money-line-input money-line-input--amount");
    amt.type = "number";
    amt.min = "0";
    amt.step = "0.01";
    amt.inputMode = "decimal";
    amt.value = String(Number(row.amount) || 0);
    amt.setAttribute(kPrefix, "amount");
    amt.setAttribute(idxAttr, String(index));
    tdAmt.appendChild(amt);

    const tdDate = node("td");
    const dt = node("input", "money-line-input money-line-input--date");
    dt.type = "date";
    dt.value = row.date || "";
    dt.setAttribute(kPrefix, "date");
    dt.setAttribute(idxAttr, String(index));
    tdDate.appendChild(dt);

    const tdStatus = node("td", "money-line-status-cell");

    const statusCol = node("div", "money-line-status-wrap");
    const del = node("button", "money-line-del-btn");
    del.type = "button";
    del.setAttribute("aria-label", tr("Remove line", "Премахни ред"));
    del.setAttribute(delAttr, String(index));
    const ix = node("i");
    ix.setAttribute("data-lucide", "x");
    del.appendChild(ix);

    statusCol.appendChild(del);
    tdStatus.appendChild(statusCol);
    tr.append(tdName, tdAmt, tdDate, tdStatus);
    return tr;
  }

  function buildIosSummaryRow(label, valueText, valueModifierClass, isFooter) {
    const row = node("div", isFooter ? "ios-summary-row ios-summary-row--footer" : "ios-summary-row");
    row.setAttribute("role", "listitem");
    const lab = node("span", "ios-summary-label");
    lab.textContent = label;
    const val = node("strong", `ios-summary-value ${valueModifierClass}`);
    val.textContent = valueText;
    row.append(lab, val);
    return row;
  }

  function buildDebtsPayWarnParagraph(sumPlanned, leftForDebt) {
    const p = node("p", "debts-pay-warn");
    p.append("Remaining planned debt payments (");
    const s1 = node("strong");
    s1.textContent = moneyFull(sumPlanned);
    p.append(s1, ") are more than what’s left after bills (");
    const s2 = node("strong");
    s2.textContent = moneyFull(leftForDebt);
    p.append(s2, "). Adjust the numbers on Money or Debts.");
    return p;
  }

  function mountDebtsPaySummary(dps, sumPlanned, leftForDebt, spareAfterPlan) {
    dps.replaceChildren();
    const wrap = node("div", "ios-summary-group ios-summary-group--embedded debts-pay-ios");
    wrap.setAttribute("role", "region");
    wrap.setAttribute("aria-label", tr("What you still plan to pay toward debts this month", "Какво още планираш да платиш по дълговете този месец"));
    const list = node("div", "ios-summary-list");
    list.setAttribute("role", "list");
    const headroomClass = spareAfterPlan >= 0 ? "ios-summary-value--accent" : "ios-summary-value--warn";
    list.append(
      buildIosSummaryRow("Still planned to all debts", moneyFull(sumPlanned), "ios-summary-value--text", false),
      buildIosSummaryRow("After bills (Money tab)", moneyFull(leftForDebt), "ios-summary-value--text", false),
      buildIosSummaryRow("Left after this plan", moneyFull(spareAfterPlan), headroomClass, true)
    );
    wrap.appendChild(list);
    if (sumPlanned > leftForDebt + 0.005) wrap.appendChild(buildDebtsPayWarnParagraph(sumPlanned, leftForDebt));
    dps.appendChild(wrap);
  }

  function setMoneyDebtContextVisible(debtCtx, sumPlanned, spareAfterPlan) {
    debtCtx.replaceChildren();
    debtCtx.append("You’re planning ");
    const planStrong = node("strong", "ios-ctx-blue");
    planStrong.textContent = moneyFull(sumPlanned);
    debtCtx.append(planStrong, " to debts this month. After that, about ");
    const spareStrong = node("strong", spareAfterPlan >= 0 ? "ios-ctx-blue" : "ios-ctx-warn");
    spareStrong.textContent = moneyFull(spareAfterPlan);
    debtCtx.append(spareStrong, " is left for savings or life.");
  }

  function renderPlannedDebtsCard() {
    const tbody = el("plannedDebtsBody");
    const totalEl = el("plannedDebtsTotal");
    const empty = el("plannedDebtsEmpty");
    if (!tbody || !totalEl) return;

    const ymKey = ymKeyFromYmd(todayYmd());
    // Show "planned payments this month" as the remaining planned amount,
    // so deleting a recorded planned payment increases this total again.
    const sumRemaining = state.loans.reduce((s, loan) => {
      const plannedTotal = Math.max(0, Number(loan.monthlyPayment) || 0);
      const paidThisYm = paymentsThisYmSum(loan, ymKey);
      return s + Math.max(0, Math.round(plannedTotal - paidThisYm));
    }, 0);
    totalEl.textContent = money(sumRemaining);

    tbody.replaceChildren();

    const shouldShow = (loan) => {
      const mp = Math.max(0, Number(loan.monthlyPayment) || 0);
      const paid = paymentsThisYmSum(loan, ymKey);
      const bal = Math.max(0, Number(loan.balance) || 0);
      return mp > 0.005 || paid > 0.005 || bal > 0.005;
    };

    const shown = [];
    state.loans.forEach((loan, i) => {
      if (shouldShow(loan)) shown.push(i);
    });

    if (!shown.length) {
      if (empty) empty.classList.remove("hidden");
      paintIcons();
      return;
    }
    if (empty) empty.classList.add("hidden");

    shown.forEach((i) => {
      const loan = state.loans[i];
      const name = (loan.name || "").trim() || "Debt";
      const plannedTotal = Math.max(0, Number(loan.monthlyPayment) || 0);
      const paidThisYm = paymentsThisYmSum(loan, ymKey);
      const remainingPlanned = round2(Math.max(0, plannedTotal - paidThisYm));
      const remainingWhole = Math.max(0, Math.round(remainingPlanned));
      const bal = Math.max(0, Number(loan.balance) || 0);
      const balWhole = Math.max(0, Math.floor(bal));

      const tr = node("tr");
      const tdName = node("td");
      tdName.className = "planned-debt-name-cell";
      const nameInp = node("input", "planned-debt-name-input");
      nameInp.type = "text";
      nameInp.maxLength = 120;
      nameInp.setAttribute("data-plan-name-i", String(i));
      nameInp.setAttribute("aria-label", tr("Debt name", "Име на дълга"));
      nameInp.placeholder = "Name";
      nameInp.value = loan.name || "";
      tdName.appendChild(nameInp);

      const tdAmt = node("td");
      const inp = node("input", "planned-debt-input");
      inp.type = "number";
      inp.step = "1";
      inp.min = "0";
      inp.max = String(balWhole);
      inp.value = String(remainingWhole);
      inp.setAttribute("data-plan-i", String(i));
      inp.setAttribute("aria-label", `Planned payment for ${name}`);
      tdAmt.appendChild(inp);

      const tdStatus = node("td");
      tdStatus.style.textAlign = "right";

      if (remainingWhole > 0) {
        const del = node("button", "debt-payment-delete-btn btn-with-lucide planned-debt-remove-btn");
        del.type = "button";
        del.setAttribute(
          "aria-label",
          `Remove ${name} from your plan and debt list`
        );
        del.setAttribute("title", "Remove this debt entirely");
        del.setAttribute("data-plan-remove-loan", String(i));
        const icDel = node("i");
        icDel.setAttribute("data-lucide", "trash-2");
        del.appendChild(icDel);
        tdStatus.appendChild(del);
      } else {
        const status = node("span", "planned-debt-status-pill");
        if (paidThisYm > 0.005) {
          status.classList.add("planned-debt-status-pill--done");
          const ic = node("i");
          ic.setAttribute("data-lucide", "check");
          status.appendChild(ic);
          status.appendChild(document.createTextNode(" Recorded"));
        } else {
          status.classList.add("planned-debt-status-pill--none");
          status.textContent = "-";
        }
        tdStatus.appendChild(status);
      }
      tr.append(tdName, tdAmt, tdStatus);
      tbody.appendChild(tr);
    });

    paintIcons();
  }

  function bindPlannedDebtsOnce() {
    const tbody = el("plannedDebtsBody");
    if (!tbody || tbody.dataset.delegateBound) return;
    tbody.dataset.delegateBound = "1";

    tbody.addEventListener("click", (e) => {
      const delBtn = e.target.closest("[data-plan-remove-loan]");
      if (!delBtn) return;
      const i = Number(delBtn.getAttribute("data-plan-remove-loan"));
      if (Number.isNaN(i) || !state.loans[i]) return;
      state.loans.splice(i, 1);
      savePlanner();
      refresh();
    });

    tbody.addEventListener("input", (e) => {
      const inp = e.target.closest(".planned-debt-input");
      if (!inp) return;
      const i = Number(inp.getAttribute("data-plan-i"));
      const loan = state.loans[i];
      if (!loan) return;
      const ymKey = ymKeyFromYmd(todayYmd());
      const paidThisYm = paymentsThisYmSum(loan, ymKey);
      const bal = Math.max(0, Number(loan.balance) || 0);
      const balWhole = Math.max(0, Math.floor(bal));
      const newRemainingWhole = Math.max(0, Math.round(Number(inp.value) || 0));
      const clampedRemainingWhole = Math.min(newRemainingWhole, balWhole);
      loan.monthlyPayment = round2(paidThisYm + clampedRemainingWhole);
      savePlanner();
      // Don't call refresh on every keystroke; avoids fighting focus.
    });

    tbody.addEventListener("change", (e) => {
      const amtInp = e.target.closest(".planned-debt-input");
      if (amtInp) {
        savePlanner();
        refresh({ skipLoans: true });
        return;
      }
      const nameInp = e.target.closest(".planned-debt-name-input");
      if (nameInp) {
        const ix = Number(nameInp.getAttribute("data-plan-name-i"));
        const loan = state.loans[ix];
        if (loan) loan.name = String(nameInp.value || "").trim().slice(0, 120);
        savePlanner();
        refresh({ skipLoans: true });
      }
    });

    tbody.addEventListener("input", (e) => {
      const inp = e.target.closest(".planned-debt-name-input");
      if (!inp) return;
      const i = Number(inp.getAttribute("data-plan-name-i"));
      const loan = state.loans[i];
      if (!loan) return;
      loan.name = String(inp.value || "").trim().slice(0, 120);
      savePlanner();
    });
  }

  function bindPlannedDebtAddOnce() {
    const btn = el("btnPlannedDebtAdd");
    if (!btn || btn.dataset.bound) return;
    btn.dataset.bound = "1";
    btn.addEventListener("click", () => {
      const errEl = el("plannedDebtAddError");
      if (errEl) {
        errEl.classList.add("hidden");
        errEl.textContent = "";
      }
      const nameInput = el("plannedDebtNewName");
      const amtInput = el("plannedDebtNewAmt");
      const name = (nameInput && nameInput.value ? nameInput.value : "").trim();
      const whole = Math.max(0, Math.round(Number(amtInput && amtInput.value) || 0));
      if (!name) {
        if (errEl) {
          errEl.textContent = tr("Enter a name for this debt.", "Въведи име за този дълг.");
          errEl.classList.remove("hidden");
        }
        setPlannedDebtDetailsOpen(true);
        return;
      }
      if (whole <= 0) {
        if (errEl) {
          errEl.textContent = tr("Enter how much you plan to pay this month (whole pounds).", "Въведи колко планираш да платиш този месец (цяла сума).");
          errEl.classList.remove("hidden");
        }
        setPlannedDebtDetailsOpen(true);
        return;
      }
      state.loans.push({
        id: uid(),
        name: name.slice(0, 120),
        balance: whole,
        apr: 0,
        monthlyPayment: whole,
        tier: "other",
        payments: [],
      });
      if (nameInput) nameInput.value = "";
      if (amtInput) amtInput.value = "";
      savePlanner();
      refresh();
    });
  }

  function buildMonthLogRow(entry, index) {
    const left = entry.income - entry.mustPayBills;
    const tr = node("tr");
    [entry.label, moneyFull(entry.income), moneyFull(entry.mustPayBills), moneyFull(left)].forEach((cellText) => {
      const td = node("td");
      td.textContent = cellText;
      tr.appendChild(td);
    });
    const tdBtn = node("td");
    const btn = node("button", "del-snap");
    btn.type = "button";
    btn.setAttribute("aria-label", tr("Remove snapshot", "Изтрий снимка"));
    btn.setAttribute("data-log-del", String(index));
    const ix = node("i");
    ix.setAttribute("data-lucide", "x");
    btn.appendChild(ix);
    tdBtn.appendChild(btn);
    tr.appendChild(tdBtn);
    return tr;
  }

  function buildBusinessDraftRow(kind) {
    const wrap = node("div", "business-draft-row");
    wrap.setAttribute("data-draft-kind", kind);
    const name = node("input", "business-draft-name business-draft-input");
    name.type = "text";
    name.setAttribute("autocomplete", "off");
    name.placeholder = kind === "income" ? "Source" : "Item";
    name.setAttribute("aria-label", kind === "income" ? "Income source" : "Expense name");
    const amt = node("input", "business-draft-amt business-draft-input");
    amt.type = "text";
    amt.inputMode = "decimal";
    amt.setAttribute("lang", "en-GB");
    amt.placeholder = "0.00";
    amt.setAttribute("aria-label", tr("Amount", "Сума"));
    amt.setAttribute("autocomplete", "off");
    const btn = node("button", "business-draft-remove");
    btn.type = "button";
    btn.setAttribute("aria-label", tr("Remove line", "Премахни ред"));
    btn.setAttribute("data-business-draft-remove", "1");
    const ix = node("i");
    ix.setAttribute("data-lucide", "x");
    btn.appendChild(ix);
    wrap.append(name, amt, btn);
    return wrap;
  }

  function sumBusinessDraftContainer(container) {
    if (!container) return 0;
    let s = 0;
    container.querySelectorAll(".business-draft-amt").forEach((inp) => {
      s += parseBusinessAmountInput(inp.value);
    });
    return round2(s);
  }

  function updateBusinessDraftTotals() {
    const i = sumBusinessDraftContainer(el("businessIncomeDraft"));
    const x = sumBusinessDraftContainer(el("businessExpenseDraft"));
    const ti = el("businessIncomeDraftTotal");
    const te = el("businessExpenseDraftTotal");
    if (ti) ti.textContent = moneyFull(i);
    if (te) te.textContent = moneyFull(x);
  }

  function readBusinessDraftLines(container, fallbackLabel) {
    const out = [];
    if (!container) return out;
    container.querySelectorAll(".business-draft-row").forEach((row) => {
      const nameRaw = row.querySelector(".business-draft-name")?.value?.trim() || "";
      const amount = parseBusinessAmountInput(row.querySelector(".business-draft-amt")?.value);
      if (!nameRaw && amount <= 0) return;
      const name = nameRaw || fallbackLabel;
      out.push({ id: uid(), name, amount: round2(amount) });
    });
    return out;
  }

  function resetBusinessDraft() {
    const inc = el("businessIncomeDraft");
    const exp = el("businessExpenseDraft");
    if (!inc || !exp) return;
    inc.replaceChildren();
    exp.replaceChildren();
    inc.appendChild(buildBusinessDraftRow("income"));
    exp.appendChild(buildBusinessDraftRow("expense"));
    updateBusinessDraftTotals();
    paintIcons();
  }

  function fillBusinessDraftFromEntry(entry) {
    const inc = el("businessIncomeDraft");
    const exp = el("businessExpenseDraft");
    if (!inc || !exp) return;
    inc.replaceChildren();
    exp.replaceChildren();
    const incLines = Array.isArray(entry.incomeItems) ? entry.incomeItems : [];
    const expLines = Array.isArray(entry.expenseItems) ? entry.expenseItems : [];
    const useLines = (lines) =>
      lines.filter((x) => String(x.name || "").trim() || (Number(x.amount) || 0) > 0);
    const inUse = useLines(incLines);
    const exUse = useLines(expLines);
    if (!inUse.length) {
      inc.appendChild(buildBusinessDraftRow("income"));
    } else {
      inUse.forEach((line) => {
        const row = buildBusinessDraftRow("income");
        row.querySelector(".business-draft-name").value = String(line.name || "").trim();
        const a = Number(line.amount) || 0;
        row.querySelector(".business-draft-amt").value = a > 0 ? String(round2(a)) : "";
        inc.appendChild(row);
      });
    }
    if (!exUse.length) {
      exp.appendChild(buildBusinessDraftRow("expense"));
    } else {
      exUse.forEach((line) => {
        const row = buildBusinessDraftRow("expense");
        row.querySelector(".business-draft-name").value = String(line.name || "").trim();
        const a = Number(line.amount) || 0;
        row.querySelector(".business-draft-amt").value = a > 0 ? String(round2(a)) : "";
        exp.appendChild(row);
      });
    }
    updateBusinessDraftTotals();
    paintIcons();
  }

  function startEditBusinessMonthAtIndex(index) {
    if (businessEditBackup) return;
    if (index < 0 || index >= state.businessLog.length) return;
    const entry = state.businessLog[index];
    businessEditBackup = {
      id: entry.id,
      label: entry.label,
      income: entry.income,
      expenses: entry.expenses,
      incomeItems: Array.isArray(entry.incomeItems) ? entry.incomeItems.map((x) => ({ ...x })) : [],
      expenseItems: Array.isArray(entry.expenseItems) ? entry.expenseItems.map((x) => ({ ...x })) : [],
    };
    state.businessLog.splice(index, 1);
    businessOpenDetailId = null;
    if (el("businessMonthLabel")) el("businessMonthLabel").value = businessEditBackup.label || "";
    fillBusinessDraftFromEntry(businessEditBackup);
    const lead = el("businessAddLead");
    if (lead) {
      lead.textContent =
        tr(
          "You’re editing a saved month. Save month to apply your changes, or Cancel to restore the previous version.",
          "Редактираш запазен месец. Натисни „Запази месец“, за да приложиш промените, или „Отказ“, за да върнеш предишната версия."
        );
    }
    savePlanner();
    renderBusinessLog();
    setBusinessAddDetailsOpen(true);
    paintIcons();
    scrollBusinessAddCardIntoView();
  }

  function startEditLatestBusinessMonth() {
    if (!state.businessLog.length || businessEditBackup) return;
    startEditBusinessMonthAtIndex(0);
  }

  function cancelLatestBusinessMonthEdit() {
    if (!businessEditBackup) return;
    state.businessLog.unshift({
      id: businessEditBackup.id,
      label: businessEditBackup.label,
      income: businessEditBackup.income,
      expenses: businessEditBackup.expenses,
      incomeItems: businessEditBackup.incomeItems.map((x) => ({ ...x })),
      expenseItems: businessEditBackup.expenseItems.map((x) => ({ ...x })),
    });
    businessEditBackup = null;
    if (el("businessMonthLabel")) el("businessMonthLabel").value = "";
    resetBusinessDraft();
    const lead = el("businessAddLead");
    if (lead) {
      lead.textContent =
        tr(
          "Add your monthly incomes, expenses, and lines as you like, then save. You can use decimals (e.g. 19.99).",
          "Добави месечните си приходи, разходи и редове, след това запази. Може да използваш десетични стойности (напр. 19.99)."
        );
    }
    savePlanner();
    renderBusinessLog();
    setBusinessAddDetailsOpen(false);
  }

  function bindBusinessDraftOnce() {
    const panel = el("panelBusiness");
    if (!panel || panel.dataset.businessDraftBound) return;
    panel.dataset.businessDraftBound = "1";
    el("businessAddDetails")?.addEventListener("toggle", () => paintIcons());
    panel.addEventListener("click", (e) => {
      if (e.target.closest("#btnBusinessAddIncome")) {
        el("businessIncomeDraft")?.appendChild(buildBusinessDraftRow("income"));
        updateBusinessDraftTotals();
        paintIcons();
        return;
      }
      if (e.target.closest("#btnBusinessAddExpense")) {
        el("businessExpenseDraft")?.appendChild(buildBusinessDraftRow("expense"));
        updateBusinessDraftTotals();
        paintIcons();
        return;
      }
      const rm = e.target.closest("[data-business-draft-remove]");
      if (!rm) return;
      const row = rm.closest(".business-draft-row");
      const list = row?.parentElement;
      if (!list || !row) return;
      const rows = list.querySelectorAll(".business-draft-row");
      if (rows.length <= 1) {
        row.querySelectorAll("input").forEach((inp) => {
          inp.value = "";
        });
        updateBusinessDraftTotals();
        return;
      }
      row.remove();
      updateBusinessDraftTotals();
      paintIcons();
    });
    panel.addEventListener("input", (e) => {
      if (e.target.closest("#businessIncomeDraft") || e.target.closest("#businessExpenseDraft")) {
        updateBusinessDraftTotals();
      }
    });
  }

  function buildBusinessLogRows(entry, index) {
    const { income, expenses } = businessMonthTotals(entry);
    const profit = round2(income - expenses);
    const eid = entry.id || "";
    const isOpen = Boolean(eid && businessOpenDetailId === eid);
    const tr = node("tr", `business-month-summary-row${isOpen ? " business-month-summary-row--open" : ""}`);
    tr.setAttribute("data-business-toggle", eid);
    tr.setAttribute("role", "button");
    tr.setAttribute("tabindex", "0");
    tr.setAttribute("aria-expanded", isOpen ? "true" : "false");
    tr.setAttribute(
      "aria-label",
      `${entry.label || "Month"}: ${moneyFull(income)} income, ${moneyFull(expenses)} expenses. ${isOpen ? "Collapse" : "Expand"} line items.`
    );
    [entry.label, moneyFull(income), moneyFull(expenses), moneyFull(profit)].forEach((cellText) => {
      const td = node("td");
      td.textContent = cellText;
      tr.appendChild(td);
    });
    const tdBtn = node("td", "business-month-actions-cell");
    const btn = node("button", "del-snap");
    btn.type = "button";
    btn.setAttribute("aria-label", tr("Remove business month", "Изтрий бизнес месец"));
    btn.setAttribute("data-business-del", String(index));
    const ix = node("i");
    ix.setAttribute("data-lucide", "x");
    btn.appendChild(ix);
    tdBtn.appendChild(btn);
    tr.appendChild(tdBtn);

    const incItems = Array.isArray(entry.incomeItems)
      ? entry.incomeItems.filter((x) => (x.name && String(x.name).trim()) || (Number(x.amount) || 0) > 0)
      : [];
    const expItems = Array.isArray(entry.expenseItems)
      ? entry.expenseItems.filter((x) => (x.name && String(x.name).trim()) || (Number(x.amount) || 0) > 0)
      : [];

    const tr2 = node("tr", `business-log-detail${isOpen ? "" : " business-log-detail--collapsed"}`);
    tr2.setAttribute("data-business-detail-for", eid);
    const td = node("td");
    td.colSpan = 5;
    const inner = node("div", "business-log-detail-inner");
    const hint = node("p", "muted small business-log-detail-hint");
    hint.textContent =
      "What you entered for this month. Use Adjust to change it in the form above, or click the row again to hide.";
    const grid = node("div", "business-log-detail-grid");
    const colInc = node("div", "business-log-detail-col");
    const hInc = node("p", "business-log-detail-col-title");
    hInc.textContent = tr("Income lines", "Редове приходи");
    const ulInc = node("ul", "business-log-lines");
    if (incItems.length) {
      incItems.forEach((x) => {
        const li = node("li");
        const name = (x.name && String(x.name).trim()) || "Income";
        li.textContent = `${name} · ${moneyFull(x.amount)}`;
        ulInc.appendChild(li);
      });
    } else {
      const li = node("li", "business-log-lines-empty");
      li.textContent = income > 0 ? `Total ${moneyFull(income)} (no separate lines stored)` : "-";
      ulInc.appendChild(li);
    }
    colInc.append(hInc, ulInc);
    const colExp = node("div", "business-log-detail-col");
    const hExp = node("p", "business-log-detail-col-title");
    hExp.textContent = tr("Expense lines", "Редове разходи");
    const ulExp = node("ul", "business-log-lines");
    if (expItems.length) {
      expItems.forEach((x) => {
        const li = node("li");
        const name = (x.name && String(x.name).trim()) || "Expense";
        li.textContent = `${name} · ${moneyFull(x.amount)}`;
        ulExp.appendChild(li);
      });
    } else {
      const li = node("li", "business-log-lines-empty");
      li.textContent = expenses > 0 ? `Total ${moneyFull(expenses)} (no separate lines stored)` : "-";
      ulExp.appendChild(li);
    }
    colExp.append(hExp, ulExp);
    grid.append(colInc, colExp);
    const actions = node("div", "business-log-detail-actions");
    if (!businessEditBackup) {
      const adj = node("button", "btn secondary small-btn btn-with-lucide");
      adj.type = "button";
      adj.setAttribute("data-business-edit", String(index));
      adj.setAttribute("aria-label", `Adjust ${entry.label || "this month"}`);
      const ip = node("i");
      ip.setAttribute("data-lucide", "pencil");
      adj.append(ip, document.createTextNode(" Adjust this month"));
      actions.appendChild(adj);
    }
    inner.append(hint, grid, actions);
    td.appendChild(inner);
    tr2.appendChild(td);

    const frag = document.createDocumentFragment();
    frag.appendChild(tr);
    frag.appendChild(tr2);
    return frag;
  }

  function appendLabelledNumberField(parent, labelText, dataK, index, value, step) {
    const lab = node("label", "field");
    const span = node("span", "field-label");
    span.textContent = labelText;
    const inp = node("input");
    inp.type = "number";
    inp.min = "0";
    inp.step = step;
    inp.value = String(value);
    inp.setAttribute("data-k", dataK);
    inp.setAttribute("data-i", String(index));
    lab.append(span, inp);
    parent.appendChild(lab);
  }

  function buildDebtCard(loan, index) {
    const t = normalizeTier(loan.tier);
    const bal = Math.max(0, Number(loan.balance) || 0);
    const mp = Math.max(0, Number(loan.monthlyPayment) || 0);
    const payments = Array.isArray(loan.payments) ? loan.payments : [];
    const paidOff = bal <= 0.005;
    const ymKey = ymKeyFromYmd(todayYmd());
    const paidThisYm = paymentsThisYmSum(loan, ymKey);
    const remainingPlanned = plannedRemainingForLoan(loan, ymKey);
    const remainingWhole = Math.max(0, Math.round(remainingPlanned));

    const article = node("article", "card glass money-card debt-card");
    article.setAttribute("data-loan-index", String(index));

    const top = node("div", "debt-card-top");
    const nameIn = node("input", "debt-card-title-input");
    nameIn.type = "text";
    nameIn.placeholder = "Name this debt";
    nameIn.setAttribute("aria-label", tr("Name of debt", "Име на дълга"));
    nameIn.value = loan.name;
    nameIn.setAttribute("data-k", "name");
    nameIn.setAttribute("data-i", String(index));
    const rm = node("button", "btn-trash debt-card-remove");
    rm.type = "button";
    rm.setAttribute("aria-label", tr("Remove this debt", "Премахни този дълг"));
    rm.setAttribute("data-del", String(index));
    const irm = node("i");
    irm.setAttribute("data-lucide", "trash-2");
    rm.appendChild(irm);
    top.append(nameIn, rm);

    const balLab = node("p", "debt-card-balance-label muted small");
    balLab.textContent = paidOff ? "Balance" : "You still owe";
    const balEl = node("p", "debt-card-balance");
    const balStrong = node("strong");
    balStrong.textContent = moneyFull(bal);
    balEl.appendChild(balStrong);


    const tierLab = node("label", "field loan-tier debt-card-tier");
    const tierSpan = node("span", "field-label");
    tierSpan.textContent = tr("Type (changes suggested payoff order)", "Тип (влияе на предложения ред за погасяване)");
    const sel = node("select");
    sel.setAttribute("data-k", "tier");
    sel.setAttribute("data-i", String(index));
    DEBT_TIER_OPTIONS.forEach(([val, lab]) => {
      const opt = node("option");
      opt.value = val;
      opt.textContent = lab;
      if (val === t) opt.selected = true;
      sel.appendChild(opt);
    });
    tierLab.append(tierSpan, sel);

    const fieldsDebt = node("div", "debt-card-fields debt-card-fields--debt");
    appendLabelledNumberField(fieldsDebt, "Balance left (£)", "balance", index, loan.balance, "0.01");
    appendLabelledNumberField(fieldsDebt, "Interest % (0 if none)", "apr", index, loan.apr, "0.1");

    const detailsDebt = node("details", "debt-card-details");
    const sumDetails = node("summary", "debt-card-details__summary");
    sumDetails.textContent = tr("Balance, rate & type", "Баланс, лихва и тип");
    const detailsBody = node("div", "debt-card-details__body");
    detailsBody.append(tierLab, fieldsDebt);
    detailsDebt.append(sumDetails, detailsBody);

    article.append(top, balLab, balEl);

    if (paidOff) {
      const po = node("p", "debt-card-paid-off muted small");
      po.textContent = tr("Nothing left on this one. Remove it if you like, or keep it for your records.", "Този дълг е изплатен. Може да го премахнеш или да го оставиш за история.");
      article.appendChild(po);
    } else {
      const actions = node("div", "debt-card-actions");
      const b1 = node("button", "btn primary btn-with-lucide");
      b1.type = "button";
      b1.setAttribute("data-pay-record", String(index));
      const i1 = node("i");
      i1.setAttribute("data-lucide", "banknote");
      b1.append(i1, document.createTextNode(" Record payment"));
      actions.append(b1);
      article.appendChild(actions);
    }

    article.appendChild(detailsDebt);

    const showPlannedRow = !paidOff && remainingWhole > 0;
    if (showPlannedRow || payments.length > 0) {
      const det = node("details", "debt-payment-log");
      const sum = node("summary", "debt-payment-log__summary");
      if (showPlannedRow && payments.length > 0) {
        sum.textContent = `Planned & recorded payments (${payments.length} recorded)`;
      } else if (showPlannedRow) {
        sum.textContent = tr("Planned payment for this month", "Планирано плащане за този месец");
      } else {
        sum.textContent = `Payments you’ve recorded (${payments.length})`;
      }

      const ul = node("ul", "debt-payment-log__list");

      if (showPlannedRow) {
        const li = node("li", "debt-payment-row");
        const txt = node("span", "debt-payment-row__text");
        txt.textContent = `Planned (this month) · ${money(remainingWhole)}`;
        const actions = node("div", "debt-payment-row__actions");

        const tick = node("button", "debt-payment-complete-btn btn-with-lucide");
        tick.type = "button";
        tick.setAttribute("aria-label", tr("Mark planned payment as paid", "Отбележи планираното плащане като платено"));
        tick.setAttribute("data-pay-plan-complete-loan", String(index));
        const ix1 = node("i");
        ix1.setAttribute("data-lucide", "check");
        tick.appendChild(ix1);
        actions.appendChild(tick);

        const del = node("button", "debt-payment-delete-btn");
        del.type = "button";
        del.setAttribute("aria-label", tr("Clear planned payment for this month", "Изчисти планираното плащане за този месец"));
        del.setAttribute("data-pay-del-planned-loan", String(index));
        const ix = node("i");
        ix.setAttribute("data-lucide", "trash-2");
        del.appendChild(ix);
        actions.appendChild(del);

        li.append(txt, actions);

        ul.appendChild(li);
      }

      payments.slice(0, 20).forEach((p) => {
        const li = node("li", "debt-payment-row");
        const notePart = p.note ? ` · ${p.note}` : "";
        const txt = node("span", "debt-payment-row__text");
        txt.textContent = `${formatShortDate(p.at)} · ${moneyFull(p.amount)}${notePart}`;
        li.appendChild(txt);

        const del = node("button", "debt-payment-delete-btn");
        del.type = "button";
        del.setAttribute("aria-label", tr("Delete this recorded payment", "Изтрий това записано плащане"));
        del.setAttribute("data-pay-del-loan", String(index));
        del.setAttribute("data-pay-del", String(p.id || ""));
        const ix = node("i");
        ix.setAttribute("data-lucide", "trash-2");
        del.appendChild(ix);
        li.appendChild(del);

        ul.appendChild(li);
      });

      det.append(sum, ul);
      article.appendChild(det);
    }

    return article;
  }

  function bindMoneyLineListsOnce() {
    const inc = el("incomeItemsList");
    if (inc && !inc.dataset.delegateBound) {
      inc.dataset.delegateBound = "1";
      inc.addEventListener("input", (e) => {
        if (e.target.matches("[data-income]")) onIncomeItemInput(e);
      });
      inc.addEventListener("change", (e) => {
        if (e.target.matches("[data-income]")) {
          onIncomeItemInput(e);
          return;
        }
      });
      inc.addEventListener("click", (e) => {
        const b = e.target.closest("[data-income-del]");
        if (!b) return;
        const i = Number(b.getAttribute("data-income-del"));
        state.incomeItems.splice(i, 1);
        savePlanner();
        refresh({ skipLoans: true });
      });
    }
    const bills = el("billItemsList");
    if (bills && !bills.dataset.delegateBound) {
      bills.dataset.delegateBound = "1";
      bills.addEventListener("input", (e) => {
        if (e.target.matches("[data-bill]")) onBillItemInput(e);
      });
      bills.addEventListener("change", (e) => {
        if (e.target.matches("[data-bill]")) {
          onBillItemInput(e);
          return;
        }
      });
      bills.addEventListener("click", (e) => {
        const b = e.target.closest("[data-bill-del]");
        if (!b) return;
        const i = Number(b.getAttribute("data-bill-del"));
        state.billItems.splice(i, 1);
        savePlanner();
        refresh({ skipLoans: true });
      });
    }
  }

  function bindLoanListOnce() {
    const list = el("loanList");
    if (!list || list.dataset.delegateBound) return;
    list.dataset.delegateBound = "1";
    list.addEventListener("click", (e) => {
      const delBtn = e.target.closest("[data-del]");
      if (delBtn) {
        const i = Number(delBtn.getAttribute("data-del"));
        state.loans.splice(i, 1);
        savePlanner();
        refresh();
        return;
      }

      const delPlannedBtn = e.target.closest("[data-pay-del-planned-loan]");
      if (delPlannedBtn) {
        const loanIndex = Number(delPlannedBtn.getAttribute("data-pay-del-planned-loan"));
        const loan = state.loans[loanIndex];
        if (!loan) return;
        const ymKey = ymKeyFromYmd(todayYmd());
        const paidThisYm = paymentsThisYmSum(loan, ymKey);
        loan.monthlyPayment = round2(Math.round(paidThisYm));
        savePlanner();
        refresh();
        return;
      }

      const delPayBtn = e.target.closest("[data-pay-del]");
      if (delPayBtn) {
        const loanIndex = Number(delPayBtn.getAttribute("data-pay-del-loan"));
        const paymentId = delPayBtn.getAttribute("data-pay-del");
        if (deleteLoanPayment(loanIndex, paymentId)) {
          savePlanner();
          refresh();
        }
        return;
      }

      const planCompleteBtn = e.target.closest("[data-pay-plan-complete-loan]");
      if (planCompleteBtn) {
        const loanIndex = Number(planCompleteBtn.getAttribute("data-pay-plan-complete-loan"));
        const loan = state.loans[loanIndex];
        if (!loan) return;
        const ymKey = ymKeyFromYmd(todayYmd());
        const remainingPlanned = plannedRemainingForLoan(loan, ymKey);
        const remainingWhole = Math.max(0, Math.round(remainingPlanned));
        const bal = Math.max(0, Number(loan.balance) || 0);
        const balWhole = Math.floor(bal);
        const payWhole = Math.min(remainingWhole, balWhole);
        if (payWhole <= 0) return;
        if (recordLoanPayment(loanIndex, payWhole, "Planned debt payment", todayYmd())) {
          savePlanner();
          refresh();
        }
        return;
      }

      const pr = e.target.closest("[data-pay-record]");
      if (pr) {
        openPayDebtModal(Number(pr.getAttribute("data-pay-record")));
        return;
      }
      // No automatic "use planned amount" action: planned -> paid happens only via tick.
    });
    list.addEventListener("input", (e) => {
      if (e.target.matches("input[data-k], select[data-k]")) onLoanFieldChange(e);
    });
    list.addEventListener("change", (e) => {
      if (e.target.matches("input[data-k], select[data-k]")) onLoanFieldChange(e);
    });
  }

  function bindMonthLogTableOnce() {
    const tbody = el("monthLogBody");
    if (!tbody || tbody.dataset.delegateBound) return;
    tbody.dataset.delegateBound = "1";
    tbody.addEventListener("click", (e) => {
      const b = e.target.closest("[data-log-del]");
      if (!b) return;
      const i = Number(b.getAttribute("data-log-del"));
      state.monthLog.splice(i, 1);
      savePlanner();
      renderMonthLog();
    });
  }

  function bindBusinessTableOnce() {
    const tbody = el("businessMonthBody");
    if (!tbody || tbody.dataset.delegateBound) return;
    tbody.dataset.delegateBound = "1";
    tbody.addEventListener("click", (e) => {
      const editBtn = e.target.closest("[data-business-edit]");
      if (editBtn) {
        e.preventDefault();
        const i = Number(editBtn.getAttribute("data-business-edit"));
        if (!Number.isNaN(i)) startEditBusinessMonthAtIndex(i);
        return;
      }
      const b = e.target.closest("[data-business-del]");
      if (b) {
        const i = Number(b.getAttribute("data-business-del"));
        const removed = state.businessLog[i];
        state.businessLog.splice(i, 1);
        if (removed && businessOpenDetailId === removed.id) businessOpenDetailId = null;
        savePlanner();
        renderBusinessLog();
        return;
      }
      if (e.target.closest(".business-month-actions-cell")) return;
      const row = e.target.closest("[data-business-toggle]");
      if (!row) return;
      const id = row.getAttribute("data-business-toggle") || "";
      if (!id) return;
      businessOpenDetailId = businessOpenDetailId === id ? null : id;
      renderBusinessLog();
    });
    tbody.addEventListener("keydown", (e) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      const row = e.target.closest("[data-business-toggle]");
      if (!row) return;
      e.preventDefault();
      const id = row.getAttribute("data-business-toggle") || "";
      if (!id) return;
      businessOpenDetailId = businessOpenDetailId === id ? null : id;
      renderBusinessLog();
    });
  }

  function bindMonthTableSortingOnce() {
    const monthTable = el("monthLogTable");
    if (monthTable && !monthTable.dataset.sortBound) {
      monthTable.dataset.sortBound = "1";
      if (!monthTable.dataset.sortDir) monthTable.dataset.sortDir = monthLogSortDir;
      const th = monthTable.querySelector("thead th:first-child");
      if (th) {
        th.addEventListener("click", () => {
          monthLogSortDir = monthTable.dataset.sortDir === "asc" ? "desc" : "asc";
          monthTable.dataset.sortDir = monthLogSortDir;
          renderMonthLog();
        });
      }
    }

    const businessTable = el("businessMonthTable");
    if (businessTable && !businessTable.dataset.sortBound) {
      businessTable.dataset.sortBound = "1";
      if (!businessTable.dataset.sortDir) businessTable.dataset.sortDir = businessMonthSortDir;
      const th = businessTable.querySelector("thead th:first-child");
      if (th) {
        th.addEventListener("click", () => {
          businessMonthSortDir = businessTable.dataset.sortDir === "asc" ? "desc" : "asc";
          businessTable.dataset.sortDir = businessMonthSortDir;
          renderBusinessLog();
        });
      }
    }
  }

  function paintIcons() {
    try {
      if (typeof lucide !== "undefined" && lucide.createIcons) {
        lucide.createIcons({
          attrs: {
            class: "lucide",
            "stroke-width": 1.75,
          },
        });
      }
    } catch (_) {}
  }

  function billItemsSum() {
    return state.billItems.reduce((s, b) => s + (Number(b.amount) || 0), 0);
  }

  function incomeItemsSum() {
    return state.incomeItems.reduce((s, row) => s + (Number(row.amount) || 0), 0);
  }

  /** Money tab: budget totals always equal sums of income / expense lines. */
  function applyOptionalLinesToBudgetFields() {
    const sIn = incomeItemsSum();
    const sMp = billItemsSum();
    state.budget.income = sIn;
    state.budget.mustPayBills = sMp;
    const incomeField = el("income");
    const mustPayField = el("mustPayBills");
    if (incomeField) incomeField.value = sIn;
    if (mustPayField) mustPayField.value = sMp;
  }

  function renderIncomeItems() {
    const list = el("incomeItemsList");
    if (!list) return;
    list.replaceChildren();

    const head = node("div", "money-lines-head");
    const hName = node("span", "money-lines-head-cell");
    hName.textContent = tr("Name", "Име");
    const hAmt = node("span", "money-lines-head-cell money-lines-head-cell--amount");
    hAmt.textContent = tr("Amount", "Сума");
    const hDate = node("span", "money-lines-head-cell money-lines-head-cell--date");
    hDate.textContent = tr("Date", "Дата");
    hDate.setAttribute("role", "button");
    hDate.tabIndex = 0;
    hDate.setAttribute("aria-label", tr("Sort expenses by date", "Сортирай разходите по дата"));
    hDate.addEventListener("click", () => {
      billDateSortDir = billDateSortDir === "asc" ? "desc" : "asc";
      renderBillItems();
    });
    const hStatus = node("span", "money-lines-head-cell money-lines-head-cell--status");
    hStatus.textContent = tr("Status", "Статус");
    head.append(hName, hAmt, hDate, hStatus);
    list.appendChild(head);

    sortedLineItemDisplayOrder(state.incomeItems, incomeDateSortDir).forEach(({ row, i: index }) => {
      list.appendChild(buildMoneyLineRow(row, index, "income", "data-ii", "data-income-del"));
    });
    const sumEl = el("incomeItemsSum");
    if (sumEl) sumEl.textContent = moneyFull(incomeItemsSum());
    paintIcons();
  }

  function onIncomeItemInput(e) {
    const inp = e.target;
    const i = Number(inp.getAttribute("data-ii"));
    const k = inp.getAttribute("data-income");
    if (k === "name") state.incomeItems[i].name = inp.value;
    else if (k === "date") state.incomeItems[i].date = inp.value;
    else state.incomeItems[i].amount = Number(inp.value) || 0;
    savePlanner();
    el("incomeItemsSum").textContent = moneyFull(incomeItemsSum());
    // Avoid rerendering money inputs while typing on iPhone (prevents focus loss).
    if (k === "amount")
      refresh({ skipLoans: true, skipMoneyLines: true, skipMonthLog: true, skipNavAvatar: true, skipInvestor: true });
  }

  function renderBillItems() {
    const list = el("billItemsList");
    if (!list) return;
    list.replaceChildren();

    const head = node("div", "money-lines-head");
    const hName = node("span", "money-lines-head-cell");
    hName.textContent = tr("Name", "Име");
    const hAmt = node("span", "money-lines-head-cell money-lines-head-cell--amount");
    hAmt.textContent = tr("Amount", "Сума");
    const hDate = node("span", "money-lines-head-cell money-lines-head-cell--date");
    hDate.textContent = tr("Date", "Дата");
    hDate.setAttribute("role", "button");
    hDate.tabIndex = 0;
    hDate.setAttribute("aria-label", tr("Sort income by date", "Сортирай приходите по дата"));
    hDate.addEventListener("click", () => {
      incomeDateSortDir = incomeDateSortDir === "asc" ? "desc" : "asc";
      renderIncomeItems();
    });
    const hStatus = node("span", "money-lines-head-cell money-lines-head-cell--status");
    hStatus.textContent = tr("Status", "Статус");
    head.append(hName, hAmt, hDate, hStatus);
    list.appendChild(head);

    sortedLineItemDisplayOrder(state.billItems, billDateSortDir).forEach(({ row: b, i: index }) => {
      list.appendChild(buildMoneyLineRow(b, index, "bill", "data-i", "data-bill-del"));
    });
    const sumEl = el("billItemsSum");
    if (sumEl) sumEl.textContent = moneyFull(billItemsSum());
    paintIcons();
  }

  function onBillItemInput(e) {
    const inp = e.target;
    const i = Number(inp.getAttribute("data-i"));
    const k = inp.getAttribute("data-bill");
    if (k === "name") state.billItems[i].name = inp.value;
    else if (k === "date") state.billItems[i].date = inp.value;
    else state.billItems[i].amount = Number(inp.value) || 0;
    savePlanner();
    el("billItemsSum").textContent = moneyFull(billItemsSum());
    // Avoid rerendering money inputs while typing on iPhone (prevents focus loss).
    if (k === "amount")
      refresh({ skipLoans: true, skipMoneyLines: true, skipMonthLog: true, skipNavAvatar: true, skipInvestor: true });
  }

  function formatShortDate(ymd) {
    if (!ymd || typeof ymd !== "string") return "";
    const d = ymd.slice(0, 10);
    try {
      const x = new Date(`${d}T12:00:00`);
      if (Number.isNaN(x.getTime())) return d;
      return x.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    } catch {
      return d;
    }
  }

  function formatDateDMY(ymd) {
    if (!ymd || typeof ymd !== "string") return "";
    const d = ymd.slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return d;
    // yyyy-mm-dd -> dd/mm/yyyy
    return `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`;
  }

  function todayYmd() {
    return new Date().toISOString().slice(0, 10);
  }

  function ymKeyFromYmd(ymd) {
    // yyyy-mm-dd -> yyyy-mm
    if (!ymd || typeof ymd !== "string" || ymd.length < 7) return "";
    return ymd.slice(0, 7);
  }

  /** yyyy-mm from payment row date (ISO date or datetime prefix). */
  function ymKeyFromPaymentAt(at) {
    if (!at || typeof at !== "string") return "";
    const m = at.trim().match(/^(\d{4}-\d{2}-\d{2})/);
    return m ? m[1].slice(0, 7) : "";
  }

  function paymentsThisYmSum(loan, ymKey) {
    if (!loan || !Array.isArray(loan.payments) || !ymKey) return 0;
    let s = 0;
    loan.payments.forEach((p) => {
      if (ymKeyFromPaymentAt(p && p.at) !== ymKey) return;
      s += Number(p && p.amount != null ? p.amount : 0) || 0;
    });
    return round2(s);
  }

  function plannedRemainingForLoan(loan, ymKey) {
    const mp = Math.max(0, Number(loan?.monthlyPayment) || 0);
    const paidThisYm = paymentsThisYmSum(loan, ymKey);
    return round2(Math.max(0, mp - paidThisYm));
  }

  function recordLoanPayment(loanIndex, amount, note, atYmd) {
    const loan = state.loans[loanIndex];
    if (!loan) return false;
    const pay = Math.max(0, round2(Number(amount) || 0));
    if (pay <= 0) return false;
    const bal = Math.max(0, Number(loan.balance) || 0);
    const applied = round2(Math.min(pay, bal));
    if (applied <= 0) return false;
    loan.balance = round2(bal - applied);
    if (!Array.isArray(loan.payments)) loan.payments = [];
    const at =
      typeof atYmd === "string" && /^\d{4}-\d{2}-\d{2}$/.test(atYmd.trim()) ? atYmd.trim() : new Date().toISOString().slice(0, 10);
    loan.payments.unshift({
      id: uid(),
      amount: applied,
      at,
      note: (note || "").trim().slice(0, 200),
    });
    if (loan.payments.length > 60) loan.payments.length = 60;
    return true;
  }

  function deleteLoanPayment(loanIndex, paymentId) {
    const loan = state.loans[loanIndex];
    if (!loan || !Array.isArray(loan.payments) || !paymentId) return false;
    const idx = loan.payments.findIndex((p) => p && p.id === paymentId);
    if (idx < 0) return false;
    const amt = Math.max(0, Number(loan.payments[idx]?.amount) || 0);
    loan.payments.splice(idx, 1);
    loan.balance = round2(Math.max(0, Number(loan.balance) || 0) + amt);
    return true;
  }

  function openPayDebtModal(index) {
    const loan = state.loans[index];
    if (!loan) return;
    const bal = Math.max(0, Number(loan.balance) || 0);
    const ymKey = ymKeyFromYmd(todayYmd());
    const remainingPlanned = plannedRemainingForLoan(loan, ymKey);
    const suggested = round2(Math.min(remainingPlanned, bal));
    const title = el("payDebtTitle");
    const ctx = el("payDebtContext");
    if (title) title.textContent = tr("Record a payment", "Запиши плащане");
    if (ctx) {
      const label = (loan.name || "").trim() || "this debt";
      ctx.textContent = `Lowers what you owe on “${label}”. Right now the balance is ${moneyFull(bal)}.`;
    }
    const hid = el("payDebtLoanIndex");
    if (hid) hid.value = String(index);
    const amtEl = el("payDebtAmount");
    if (amtEl) amtEl.value = suggested > 0 ? String(suggested) : bal > 0 ? "" : "0";
    const noteEl = el("payDebtNote");
    if (noteEl) noteEl.value = "";
    const errEl = el("payDebtError");
    if (errEl) {
      errEl.classList.add("hidden");
      errEl.textContent = "";
    }
    const dateEl = el("payDebtDate");
    if (dateEl) dateEl.value = new Date().toISOString().slice(0, 10);
    const modal = el("payDebtModal");
    if (modal) modal.classList.remove("hidden");
    paintIcons();
  }

  function closePayDebtModal() {
    const modal = el("payDebtModal");
    if (modal) modal.classList.add("hidden");
  }

  function openAddIncomeModal() {
    const modal = el("addIncomeModal");
    if (!modal) return;
    const srcEl = el("addIncomeSource");
    const amtEl = el("addIncomeAmount");
    const dateEl = el("addIncomeDate");
    const errEl = el("addIncomeError");

    if (srcEl) srcEl.value = "";
    if (amtEl) amtEl.value = "";
    if (dateEl) dateEl.value = todayYmd();
    if (errEl) {
      errEl.classList.add("hidden");
      errEl.textContent = "";
    }
    modal.classList.remove("hidden");
    paintIcons();
  }

  function closeAddIncomeModal() {
    const modal = el("addIncomeModal");
    if (modal) modal.classList.add("hidden");
  }

  function commitAddIncomeModal() {
    const errEl = el("addIncomeError");
    if (errEl) {
      errEl.classList.add("hidden");
      errEl.textContent = "";
    }

    const srcEl = el("addIncomeSource");
    const amtEl = el("addIncomeAmount");
    const dateEl = el("addIncomeDate");

    const source = (srcEl?.value || "").trim();
    const amount = Number(amtEl?.value);

    if (!source) {
      if (errEl) {
        errEl.textContent = tr("Add a source name (e.g. Salary / wages).", "Добави име на източника (напр. Заплата).");
        errEl.classList.remove("hidden");
      }
      return false;
    }
    if (!(amount > 0)) {
      if (errEl) {
        errEl.textContent = tr("Enter an amount above zero.", "Въведи сума над нула.");
        errEl.classList.remove("hidden");
      }
      return false;
    }

    const date = dateEl?.value || "";
    state.incomeItems.push({ id: uid(), name: source, amount: round2(amount), date, done: false });
    sortMoneyItemsByDateDesc(state.incomeItems);
    savePlanner();
    closeAddIncomeModal();
    refresh({ skipLoans: true });
    return true;
  }

  function openAddExpenseModal() {
    const modal = el("addExpenseModal");
    if (!modal) return;
    const srcEl = el("addExpenseSource");
    const amtEl = el("addExpenseAmount");
    const dateEl = el("addExpenseDate");
    const errEl = el("addExpenseError");

    if (srcEl) srcEl.value = "";
    if (amtEl) amtEl.value = "";
    if (dateEl) dateEl.value = todayYmd();
    if (errEl) {
      errEl.classList.add("hidden");
      errEl.textContent = "";
    }
    modal.classList.remove("hidden");
    paintIcons();
  }

  function closeAddExpenseModal() {
    const modal = el("addExpenseModal");
    if (modal) modal.classList.add("hidden");
  }

  function commitAddExpenseModal() {
    const errEl = el("addExpenseError");
    if (errEl) {
      errEl.classList.add("hidden");
      errEl.textContent = "";
    }

    const srcEl = el("addExpenseSource");
    const amtEl = el("addExpenseAmount");
    const dateEl = el("addExpenseDate");

    const source = (srcEl?.value || "").trim();
    const amount = Number(amtEl?.value);

    if (!source) {
      if (errEl) {
        errEl.textContent = tr("Add a source name (e.g. Rent / housing).", "Добави име на разхода (напр. Наем).");
        errEl.classList.remove("hidden");
      }
      return false;
    }
    if (!(amount > 0)) {
      if (errEl) {
        errEl.textContent = tr("Enter an amount above zero.", "Въведи сума над нула.");
        errEl.classList.remove("hidden");
      }
      return false;
    }

    const date = dateEl?.value || "";
    state.billItems.push({ id: uid(), name: source, amount: round2(amount), date, done: false });
    sortMoneyItemsByDateDesc(state.billItems);
    savePlanner();
    closeAddExpenseModal();
    refresh({ skipLoans: true });
    return true;
  }

  function monthLabelToYymm(label) {
    const s = String(label || "").trim();
    if (!s) return null;
    // yyyy-mm
    const m1 = s.match(/^(\d{4})-(\d{1,2})$/);
    if (m1) {
      const y = Number(m1[1]);
      const mo = Number(m1[2]);
      if (Number.isFinite(y) && Number.isFinite(mo) && mo >= 1 && mo <= 12) return y * 100 + mo;
    }
    // e.g. March 2026
    const m2 = s.match(/^([A-Za-z]{3,9})\s+(\d{4})$/);
    if (m2) {
      const mon = m2[1].slice(0, 3).toLowerCase();
      const year = Number(m2[2]);
      const map = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
      const mo = map[mon];
      if (mo && Number.isFinite(year)) return year * 100 + mo;
    }
    return null;
  }

  function renderMonthLog() {
    const tbody = el("monthLogBody");
    const empty = el("monthLogEmpty");
    if (!tbody) return;
    tbody.replaceChildren();
    if (!state.monthLog.length) {
      if (empty) empty.classList.remove("hidden");
      return;
    }
    if (empty) empty.classList.add("hidden");

    const dir = monthLogSortDir === "asc" ? 1 : -1;
    const monthRows = state.monthLog.map((m, index) => ({ m, index }));
    monthRows.sort((a, b) => {
      const am = monthLabelToYymm(a.m.label);
      const bm = monthLabelToYymm(b.m.label);
      if (am != null && bm != null) return dir * (am - bm);
      return dir * String(a.m.label || "").localeCompare(String(b.m.label || ""));
    });
    monthRows.forEach(({ m, index }) => tbody.appendChild(buildMonthLogRow(m, index)));
    paintIcons();
  }

  function renderBusinessLog() {
    syncBusinessMonthSubmitLabel();
    const tbody = el("businessMonthBody");
    const empty = el("businessMonthEmpty");
    const latestProfitEl = el("businessProfitMonth");
    const totalEarningsEl = el("businessTotalEarnings");
    const totalIncomeEl = el("businessTotalIncome");
    const totalExpensesEl = el("businessTotalExpenses");
    const labEl = el("businessLatestMonthLabel");
    const incDisp = el("businessLatestIncomeDisplay");
    const expDisp = el("businessLatestExpenseDisplay");
    const editBtn = el("btnBusinessEditLatest");
    const cancelBtn = el("btnBusinessCancelEdit");

    const totals = state.businessLog.reduce(
      (acc, row) => {
        const t = businessMonthTotals(row);
        acc.income += t.income;
        acc.expenses += t.expenses;
        return acc;
      },
      { income: 0, expenses: 0 }
    );
    const totalIncome = round2(totals.income);
    const totalExpenses = round2(totals.expenses);
    const totalEarnings = round2(totalIncome - totalExpenses);

    let latestProfit = 0;
    let latestInc = 0;
    let latestExp = 0;

    if (businessEditBackup && state.businessLog.length === 0) {
      const tb = businessMonthTotals(businessEditBackup);
      latestInc = tb.income;
      latestExp = tb.expenses;
      latestProfit = round2(tb.income - tb.expenses);
      if (labEl) {
        const lab = (businessEditBackup.label || "").trim();
        labEl.textContent = lab ? `Editing: ${lab}` : "Editing month";
      }
    } else if (state.businessLog.length > 0) {
      const t0 = businessMonthTotals(state.businessLog[0]);
      latestInc = t0.income;
      latestExp = t0.expenses;
      latestProfit = round2(t0.income - t0.expenses);
      if (labEl) labEl.textContent = (state.businessLog[0].label || "").trim() || "Latest month";
    } else {
      if (labEl) labEl.textContent = tr("No month saved yet.", "Още няма запазен месец.");
    }

    if (incDisp) incDisp.textContent = moneyFull(latestInc);
    if (expDisp) expDisp.textContent = moneyFull(latestExp);
    if (latestProfitEl) {
      latestProfitEl.textContent = moneyFull(latestProfit);
      latestProfitEl.classList.toggle("mint", latestProfit >= 0);
      latestProfitEl.classList.toggle("big-stat--warn", latestProfit < 0);
    }
    if (totalEarningsEl) totalEarningsEl.textContent = moneyFull(totalEarnings);
    if (totalIncomeEl) totalIncomeEl.textContent = moneyFull(totalIncome);
    if (totalExpensesEl) totalExpensesEl.textContent = moneyFull(totalExpenses);

    if (editBtn) editBtn.classList.toggle("hidden", state.businessLog.length === 0 || !!businessEditBackup);
    if (cancelBtn) cancelBtn.classList.toggle("hidden", !businessEditBackup);

    if (!tbody) return;
    tbody.replaceChildren();
    if (!state.businessLog.length) {
      if (empty) empty.classList.remove("hidden");
      paintIcons();
      return;
    }
    if (empty) empty.classList.add("hidden");

    const dir = businessMonthSortDir === "asc" ? 1 : -1;
    const monthRows = state.businessLog.map((m, index) => ({ m, index }));
    monthRows.sort((a, b) => {
      const am = monthLabelToYymm(a.m.label);
      const bm = monthLabelToYymm(b.m.label);
      if (am != null && bm != null) return dir * (am - bm);
      return dir * String(a.m.label || "").localeCompare(String(b.m.label || ""));
    });
    monthRows.forEach(({ m, index }) => tbody.appendChild(buildBusinessLogRows(m, index)));
    paintIcons();
  }

  function updatePayoffAtAGlance(sumPlanned, leftForDebt, spareAfterPlan) {
    const sec = el("payoffAtAGlance");
    const list = el("payoffAtAGlanceList");
    const foot = el("payoffAtAGlanceFoot");
    if (!sec || !list || !foot) return;
    list.replaceChildren();
    if (!state.loans.length) {
      sec.classList.add("hidden");
      return;
    }
    sec.classList.remove("hidden");
    const li1 = node("li");
    const s1 = node("strong");
    s1.textContent = moneyFull(leftForDebt);
    li1.append("After bills (Money): ", s1);
    list.appendChild(li1);
    const li2 = node("li");
    const s2 = node("strong");
    s2.textContent = moneyFull(sumPlanned);
    li2.append("Still planned to debts this month: ", s2);
    list.appendChild(li2);
    const li3 = node("li");
    const s3 = node("strong");
    s3.textContent = moneyFull(spareAfterPlan);
    if (spareAfterPlan < -0.005) s3.style.color = "var(--warning)";
    li3.append("Left after planned debt payments: ", s3);
    list.appendChild(li3);
    foot.textContent =
      "Recorded payments this month reduce this total. Change planned amounts on Debts (Payment this month £), or income and bills on Money.";
  }

  function renderLoans() {
    const list = el("loanList");
    if (!list) return;
    list.replaceChildren();
    state.loans.forEach((loan, index) => {
      list.appendChild(buildDebtCard(loan, index));
    });
    paintIcons();
  }

  function onLoanFieldChange(e) {
    const input = e.target;
    const i = Number(input.getAttribute("data-i"));
    const k = input.getAttribute("data-k");
    if (k === "name") state.loans[i].name = input.value;
    else if (k === "tier") state.loans[i].tier = input.value;
    else if (k === "monthlyPayment")
      state.loans[i].monthlyPayment = round2(Math.max(0, Number(input.value) || 0));
    else state.loans[i][k] = Number(input.value) || 0;
    savePlanner();
    refresh({ skipLoans: true });
  }

  function sumDebtByTier() {
    const sums = { people: 0, overdraft: 0, other: 0 };
    state.loans.forEach((l) => {
      const t = normalizeTier(l.tier);
      sums[t] += Math.max(0, Number(l.balance) || 0);
    });
    return sums;
  }

  function refresh(opts = {}) {
    applyOptionalLinesToBudgetFields();
    const income = Number(el("income").value) || 0;
    const mustPay = Number(el("mustPayBills").value) || 0;
    state.budget.income = income;
    state.budget.mustPayBills = mustPay;

    const leftForDebt = income - mustPay;
    const quickIncome = el("moneyQuickIncome");
    if (quickIncome) quickIncome.textContent = moneyFull(income);
    const quickExpenses = el("moneyQuickExpenses");
    if (quickExpenses) quickExpenses.textContent = moneyFull(mustPay);
    const quickLeft = el("moneyQuickLeft");
    if (quickLeft) quickLeft.textContent = moneyFull(leftForDebt);
    const shortfall = leftForDebt < -0.005;
    const quickLeftCard = el("moneyQuickLeftCard");
    if (quickLeftCard) quickLeftCard.classList.toggle("money-quick-card--shortfall", shortfall);
    if (quickLeft) quickLeft.classList.toggle("money-quick-card__value--shortfall", shortfall);

    savePlanner();

    const ymKey = ymKeyFromYmd(todayYmd());
    const sumPlannedRemaining = round2(
      state.loans.reduce((s, l) => s + plannedRemainingForLoan(l, ymKey), 0)
    );
    const spareAfterPlan = leftForDebt - sumPlannedRemaining;
    const insolvent = leftForDebt + 0.001 < sumPlannedRemaining && state.loans.length > 0;

    const dps = el("debtsPaySummary");
    if (dps) {
      if (!state.loans.length) {
        dps.classList.add("hidden");
        dps.replaceChildren();
      } else {
        dps.classList.remove("hidden");
        mountDebtsPaySummary(dps, sumPlannedRemaining, leftForDebt, spareAfterPlan);
      }
    }

    updatePayoffAtAGlance(sumPlannedRemaining, leftForDebt, spareAfterPlan);

    const total = state.loans.reduce((s, l) => s + Math.max(0, Number(l.balance) || 0), 0);
    el("totalDebt").textContent = moneyFull(total);
    const sums = sumDebtByTier();
    const tierLine = el("debtByTier");
    if (total > 0) {
      tierLine.textContent = `People you know: ${moneyFull(sums.people)} · Overdraft / bank: ${moneyFull(sums.overdraft)} · Everything else: ${moneyFull(sums.other)}`;
      tierLine.classList.remove("hidden");
    } else {
      tierLine.textContent = "";
      tierLine.classList.add("hidden");
    }

    const pr = simulate(state.loans, "priority", income, mustPay);
    const av = simulate(state.loans, "avalanche", income, mustPay);
    const sn = simulate(state.loans, "snowball", income, mustPay);

    el("prMonths").textContent = pr.monthsToDebtFree != null ? `~${pr.monthsToDebtFree} months to clear it all` : "…";
    el("prInterest").textContent = strategySubtext(pr);
    el("avMonths").textContent = av.monthsToDebtFree != null ? `~${av.monthsToDebtFree} months` : "…";
    el("snMonths").textContent = sn.monthsToDebtFree != null ? `~${sn.monthsToDebtFree} months` : "…";
    el("avInterest").textContent = strategySubtext(av);
    el("snInterest").textContent = strategySubtext(sn);

    const rec = el("recommendation");
    if (state.loans.length === 0) {
      rec.textContent = tr(
        "Add what you owe on Debts and keep Money honest, then this picture matches real life.",
        "Добави дълговете в таб „Дългове“ и поддържай таб „Пари“ актуален, за да е реална картината."
      );
    } else if (pr.insolvent || av.insolvent) {
      rec.textContent = tr(
        "Right now, after bills, there isn’t enough for the payments you’ve set on each debt. Fix that first; avalanche vs snowball only helps once the plan fits.",
        "В момента след сметките няма достатъчно за плащанията, които си задал за всеки дълг. Първо оправи това; avalanche и snowball помагат, когато планът вече е реалистичен."
      );
    } else if (pr.monthsToDebtFree == null) {
      rec.textContent = tr(
        "With these balances and rates, the maths may not reach zero, double-check interest and monthly payments.",
        "С тези баланси и лихви сметката може да не стигне до нула - провери лихвите и месечните плащания."
      );
    } else {
      const peopleCount = state.loans.filter((l) => normalizeTier(l.tier) === "people" && Number(l.balance) > 0).length;
      rec.textContent =
        peopleCount > 0
          ? `Our default: clear money owed to people first (smallest balance), then tackle overdraft by highest rate, then the rest. “Pure avalanche” ignores that, compare the numbers above.`
          : `No “someone you know” debts tagged. We still pay overdraft before other types. Tag personal IOUs if you want them first.`;
    }

    const focusSec = el("focusSection");
    const tip = priorityExtraTarget(state.loans);
    const focusEl = el("focusText");
    if (tip && spareAfterPlan > 0 && !insolvent) {
      focusSec.classList.remove("hidden");
      if (focusEl) {
        focusEl.replaceChildren();
        focusEl.append("If you can, put what’s left after your plan toward ");
        const nm = node("strong");
        nm.textContent = tip.name;
        focusEl.append(nm, `. ${tip.reason}`);
      }
    } else if (!insolvent && state.loans.length && spareAfterPlan <= 0) {
      focusSec.classList.remove("hidden");
      if (focusEl) {
        focusEl.textContent =
          "Your planned payments use everything after bills, that’s fine. When you free up cash, start with the smallest debt to someone you know.";
      }
    } else focusSec.classList.add("hidden");

    if (!opts.skipLoans) renderLoans();
    if (!opts.skipPlannedDebts) renderPlannedDebtsCard();
    if (!opts.skipMoneyLines) {
      renderIncomeItems();
      renderBillItems();
    }
    if (!opts.skipMonthLog) renderMonthLog();
    renderBusinessLog();
    updateChart(pr.history, av.history);
    if (!opts.skipNavAvatar) updateNavAvatar();
    if (!opts.skipInvestor) renderInvestor();
  }

  function updateChart(prH, avH) {
    const empty = el("chartEmpty");
    const canvas = el("debtChart");
    if (state.loans.length === 0) {
      empty.classList.remove("hidden");
      if (chartInstance) {
        chartInstance.destroy();
        chartInstance = null;
      }
      return;
    }
    empty.classList.add("hidden");
    const maxLen = Math.max(prH.length, avH.length);
    const labels = Array.from({ length: maxLen }, (_, i) => i);
    const pad = (arr) => {
      const out = arr.slice();
      while (out.length < maxLen) out.push(0);
      return out;
    };

    if (chartInstance) chartInstance.destroy();
    chartInstance = new Chart(canvas.getContext("2d"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "People first (recommended)",
            data: pad(prH),
            borderColor: "#ff3d7a",
            backgroundColor: "rgba(255,61,122,0.12)",
            tension: 0.35,
            fill: false,
            pointRadius: 0,
            borderWidth: 2,
          },
          {
            label: "Pure avalanche",
            data: pad(avH),
            borderColor: "#5e9eff",
            backgroundColor: "rgba(94,158,255,0.1)",
            tension: 0.35,
            fill: false,
            pointRadius: 0,
            borderWidth: 1.5,
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: {
          legend: { labels: { color: "rgba(235,228,245,0.78)" } },
        },
        scales: {
          x: {
            title: { display: true, text: "Months", color: "rgba(200,192,220,0.55)" },
            ticks: { color: "rgba(190,182,210,0.52)", maxTicksLimit: 8 },
            grid: { color: "rgba(255,255,255,0.04)" },
          },
          y: {
            ticks: {
              color: "rgba(190,182,210,0.52)",
              callback: (v) => money(v),
            },
            grid: { color: "rgba(255,255,255,0.04)" },
          },
        },
      },
    });
  }

  function updateNavAvatar() {
    const url = getPhotoDataUrl();
    const nav = document.querySelector("#navAvatar");
    const prev = el("photoPreview");
    if (url) {
      nav.style.backgroundImage = `url("${url}")`;
      prev.style.backgroundImage = `url("${url}")`;
      prev.textContent = "";
    } else {
      nav.style.backgroundImage = "";
      prev.style.backgroundImage = "";
      const initials = (state.profile.displayName || "?")
        .trim()
        .split(/\s+/)
        .slice(0, 2)
        .map((w) => w[0])
        .join("")
        .toUpperCase() || "?";
      prev.textContent = initials;
    }
  }

  function openModal() {
    el("profileModal").classList.remove("hidden");
    el("displayName").value = state.profile.displayName;
    updateAccountPanel();
    updateNavAvatar();
    el("authError").classList.add("hidden");
    paintIcons();
  }

  function closeModal() {
    el("profileModal").classList.add("hidden");
    state.profile.displayName = el("displayName").value.trim();
    saveProfile();
    updateNavAvatar();
  }

  function updateAccountPanel() {
    const loggedIn = !!state.activeFingerprint;
    el("accountStatus").textContent = loggedIn ? state.signedInEmail || "Signed in" : "Guest on this device";
    el("loggedInActions").classList.toggle("hidden", !loggedIn);
    el("guestAuth").classList.toggle("hidden", loggedIn);
  }

  function setAuthTab(tab) {
    authTab = tab;
    el("guestAuth").querySelectorAll(".auth-tab").forEach((t) => {
      const on = t.getAttribute("data-tab") === tab;
      t.classList.toggle("active", on);
      t.setAttribute("aria-selected", on);
    });
    el("confirmWrap").classList.toggle("hidden", tab !== "register");
    el("btnAuthSubmit").textContent = tab === "register" ? tr("Create account", "Създай акаунт") : tr("Sign in", "Вход");
  }

  const APP_TAB_KEY = "payoff.mainTab";

  function setAppTab(id) {
    const valid = ["money", "debts", "payoff", "business", "investor"].includes(id) ? id : "money";
    document.querySelectorAll(".app-tab").forEach((btn) => {
      const on = btn.getAttribute("data-app-tab") === valid;
      btn.classList.toggle("active", on);
      btn.setAttribute("aria-selected", on);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      const on = panel.getAttribute("data-panel") === valid;
      panel.classList.toggle("active", on);
    });
    try {
      sessionStorage.setItem(APP_TAB_KEY, valid);
    } catch (_) {}
  }

  async function resizeImageFile(file, maxSide = 400) {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / bmp.width, maxSide / bmp.height);
    const w = Math.round(bmp.width * scale);
    const h = Math.round(bmp.height * scale);
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const ctx = c.getContext("2d");
    ctx.drawImage(bmp, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.82);
  }

  function syncInvestorDomFromState() {
    const stakeEl = el("invMonthlyStake");
    if (!stakeEl) return;
    const i = state.investor;
    stakeEl.value = i.monthlyStake || "";
    el("invBankroll").value = i.bankroll || "";
    el("invTarget").value = i.target || "";
    el("invLadderLegs").value = i.ladderLegs;
    el("invLadderOdds").value = i.ladderOdds;
    padInvestorCompleted(state.investor);
  }

  function readInvestorFromDom() {
    const stakeEl = el("invMonthlyStake");
    if (!stakeEl) return;
    state.investor.monthlyStake = Math.max(0, Number(stakeEl.value) || 0);
    state.investor.bankroll = Math.max(0, Number(el("invBankroll").value) || 0);
    state.investor.target = Math.max(0, Number(el("invTarget").value) || 0);
    state.investor.ladderLegs = Math.min(30, Math.max(1, Math.round(Number(el("invLadderLegs").value) || 1)));
    state.investor.ladderOdds = Math.max(1.01, Number(el("invLadderOdds").value) || 1.01);
    padInvestorCompleted(state.investor);
  }

  function renderInvestor() {
    const outTarget = el("invTargetAnalysis");
    if (!outTarget) return;

    padInvestorCompleted(state.investor);
    const i = state.investor;
    const B = i.bankroll;
    const T = i.target;
    const legs = i.ladderLegs;
    const oL = i.ladderOdds;
    const monthly = i.monthlyStake;

    let targetHtml = "";
    if (B <= 0) {
      targetHtml = `<p class="investor-analysis-line muted">${tr("Enter a bankroll above to run the numbers.", "Въведи начален банкрол, за да видиш сметките.")}</p>`;
    } else if (!T || T <= B) {
      targetHtml = `<p class="investor-analysis-line muted">${tr("Add a target above your bankroll to see how many winning steps you’d need at different odds (e.g. 2× vs 3× per step).", "Добави цел над текущия банкрол, за да видиш колко печеливши стъпки трябват при различни коефициенти (напр. 2× срещу 3× на стъпка).")}</p>`;
      if (monthly > 0) {
        targetHtml += `<p class="investor-analysis-line">${tr("Deposits this month", "Депозити този месец")}: <strong>${moneyFull(monthly)}</strong> (${tr("not compounded into the ladder below unless you add it to bankroll", "не се включват в схемата по-долу, освен ако не ги добавиш към банкрола")}).</p>`;
      }
    } else {
      const ratio = T / B;
      const n2 = Math.ceil(Math.log(ratio) / Math.LN2);
      const n3 = Math.ceil(Math.log(ratio) / Math.log(3));
      const nL = oL > 1 ? Math.ceil(Math.log(ratio) / Math.log(oL)) : null;
      targetHtml = `<p class="investor-analysis-line">${tr("Growth needed", "Необходим ръст")}: <strong>×${round2(ratio)}</strong> ${tr("from", "от")} ${moneyFull(B)} ${tr("to", "до")} ${moneyFull(T)}.</p>`;
      targetHtml += `<p class="investor-analysis-line">${tr("At", "При")} <strong>2.0</strong> ${tr("odds every winning step", "коефициент на всяка печеливша стъпка")}: ${tr("about", "около")} <strong>${n2}</strong> ${tr("steps", "стъпки")} (${tr("e.g.", "напр.")} ${n2} ${tr("сесии при една стъпка на ден", "sessions if you do one step per day")}).</p>`;
      targetHtml += `<p class="investor-analysis-line">${tr("At", "При")} <strong>3.0</strong> ${tr("odds every winning step", "коефициент на всяка печеливша стъпка")}: ${tr("about", "около")} <strong>${n3}</strong> ${tr("steps", "стъпки")}.</p>`;
      if (nL != null && Math.abs(oL - 2) > 0.05 && Math.abs(oL - 3) > 0.05) {
        targetHtml += `<p class="investor-analysis-line">${tr("At your ladder odds", "При твоя коефициент")} <strong>${round2(oL)}</strong>: ${tr("about", "около")} <strong>${nL}</strong> ${tr("winning steps", "печеливши стъпки")}.</p>`;
      }
      if (monthly > 0) {
        targetHtml += `<p class="investor-analysis-line muted small">${tr("Monthly deposits", "Месечните депозити")} (${moneyFull(monthly)}) ${tr("are separate from this compound path unless you bank them.", "са отделни от тази схема, освен ако не ги добавиш към банкрола.")}</p>`;
      }
    }
    outTarget.innerHTML = targetHtml;

    const ladderHost = el("invLadderTable");
    if (ladderHost && B > 0 && oL > 1) {
      const rows = [];
      let balance = B;
      const checks = i.completedLegs || [];
      const drafts = Array.isArray(i.legDrafts) ? i.legDrafts : [];
      for (let day = 1; day <= legs; day++) {
        const draft = drafts[day - 1] || {};
        const startDraft = draft.start == null || draft.start === "" ? null : Number(draft.start);
        const oddsDraft = draft.odds == null || draft.odds === "" ? null : Number(draft.odds);
        const start = startDraft != null && Number.isFinite(startDraft) ? Math.max(0, startDraft) : balance;
        const odds = oddsDraft != null && Number.isFinite(oddsDraft) ? Math.max(1.01, oddsDraft) : oL;
        const end = start * odds;
        const done = !!checks[day - 1];
        const startVal = round2(start);
        const oddsVal = round2(odds);
        rows.push(
          `<tr class="${done ? "inv-day-done" : ""}"><td class="inv-check-cell"><label class="inv-check-label"><input type="checkbox" class="inv-day-check" data-inv-day="${day}" ${done ? "checked" : ""} aria-label="Day ${day} completed" /></label></td><td>${day}</td><td><input type="number" class="inv-ladder-input inv-ladder-input--money" data-inv-start="${day}" min="0" step="0.01" value="${startVal}" ${done ? "disabled" : ""} aria-label="Day ${day} balance in" /></td><td><input type="number" class="inv-ladder-input inv-ladder-input--odds" data-inv-odds="${day}" min="1.01" step="0.01" value="${oddsVal}" ${done ? "disabled" : ""} aria-label="Day ${day} odds" /></td><td>${moneyFull(end)}</td></tr>`
        );
        balance = end;
      }
      ladderHost.innerHTML = `<table><thead><tr><th>Done</th><th>Day</th><th>Balance</th><th>Odds</th><th>Bank</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
    } else if (ladderHost) {
      ladderHost.innerHTML = `<p class="tiny muted">${tr("Set bankroll and ladder odds to preview each leg.", "Задай банкрол и коефициент, за да видиш всяка стъпка.")}</p>`;
    }
  }

  function bindInvestorLadderChecks() {
    const wrap = el("invLadderWrap");
    if (!wrap || wrap.dataset.invChecksBound) return;
    wrap.dataset.invChecksBound = "1";
    wrap.addEventListener("change", (e) => {
      const t = e.target;
      if (!t || !t.classList || !t.classList.contains("inv-day-check")) return;
      const day = Number(t.getAttribute("data-inv-day"));
      if (!day) return;
      readInvestorFromDom();
      state.investor.completedLegs[day - 1] = t.checked;
      savePlanner();
      renderInvestor();
      paintIcons();
    });
    wrap.addEventListener("input", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      const startDay = Number(t.getAttribute("data-inv-start"));
      const oddsDay = Number(t.getAttribute("data-inv-odds"));
      if (!startDay && !oddsDay) return;
      readInvestorFromDom();
      const day = startDay || oddsDay;
      const idx = day - 1;
      if (idx < 0) return;
      if (!Array.isArray(state.investor.legDrafts)) state.investor.legDrafts = [];
      if (!state.investor.legDrafts[idx]) state.investor.legDrafts[idx] = { start: null, odds: null };
      if (startDay) {
        const v = t.value.trim();
        state.investor.legDrafts[idx].start = v === "" ? null : Math.max(0, Number(v) || 0);
      } else if (oddsDay) {
        const v = t.value.trim();
        state.investor.legDrafts[idx].odds = v === "" ? null : Math.max(1.01, Number(v) || 1.01);
      }
      savePlanner();
    });
    wrap.addEventListener("change", (e) => {
      const t = e.target;
      if (!(t instanceof HTMLInputElement)) return;
      const day = Number(t.getAttribute("data-inv-start") || t.getAttribute("data-inv-odds"));
      if (!day) return;
      savePlanner();
      renderInvestor();
    });
  }

  function bindInvestor() {
    function resetInvestorLadderState() {
      state.investor.completedLegs = [];
      state.investor.legDrafts = [];
      padInvestorCompleted(state.investor);
    }

    ["invMonthlyStake", "invBankroll", "invTarget", "invLadderLegs", "invLadderOdds"].forEach((id) => {
      const n = el(id);
      if (!n) return;
      n.addEventListener("input", () => {
        readInvestorFromDom();
        savePlanner();
        renderInvestor();
      });
    });
    const p73 = el("invPreset73");
    if (p73) {
      p73.addEventListener("click", () => {
        el("invLadderLegs").value = 7;
        el("invLadderOdds").value = 3;
        readInvestorFromDom();
        resetInvestorLadderState();
        savePlanner();
        renderInvestor();
      });
    }
    const pEx = el("invPresetTarget");
    if (pEx) {
      pEx.addEventListener("click", () => {
        el("invBankroll").value = 100;
        el("invTarget").value = 20000;
        el("invLadderLegs").value = 7;
        el("invLadderOdds").value = 3;
        readInvestorFromDom();
        resetInvestorLadderState();
        savePlanner();
        renderInvestor();
      });
    }
  }

  function syncFormFromState() {
    applyOptionalLinesToBudgetFields();
    syncInvestorDomFromState();
  }

  function init() {
    loadSession();
    loadPlanner();
    loadProfile();
    bindLocaleToggle();

    syncFormFromState();

    bindMoneyLineListsOnce();
    bindLoanListOnce();
    bindPlannedDebtsOnce();
    bindPlannedDebtAddOnce();
    el("plannedDebtDetails")?.addEventListener("toggle", () => paintIcons());
    bindMonthLogTableOnce();
    bindBusinessTableOnce();
    bindMonthTableSortingOnce();
    bindBusinessDraftOnce();
    resetBusinessDraft();

    el("btnAddIncomeItem").addEventListener("click", () => {
      openAddIncomeModal();
    });

    el("btnAddBillItem").addEventListener("click", () => {
      openAddExpenseModal();
    });

    el("btnAddMonthLog").addEventListener("click", () => {
      const label = el("monthLogLabel").value.trim() || `Month ${state.monthLog.length + 1}`;
      state.monthLog.unshift({
        id: uid(),
        label,
        income: Number(el("income").value) || 0,
        mustPayBills: Number(el("mustPayBills").value) || 0,
      });
      el("monthLogLabel").value = "";
      savePlanner();
      renderMonthLog();
    });

    el("btnAddBusinessMonth")?.addEventListener("click", () => {
      const errEl = el("businessSaveError");
      if (errEl) {
        errEl.classList.add("hidden");
        errEl.textContent = "";
      }
      const label = (el("businessMonthLabel")?.value || "").trim() || `Month ${state.businessLog.length + 1}`;
      const incomeItems = readBusinessDraftLines(el("businessIncomeDraft"), "Income");
      const expenseItems = readBusinessDraftLines(el("businessExpenseDraft"), "Expense");
      const income = round2(incomeItems.reduce((s, x) => s + x.amount, 0));
      const expenses = round2(expenseItems.reduce((s, x) => s + x.amount, 0));
      if (income <= 0 && expenses <= 0) {
        if (errEl) {
          errEl.textContent = tr("Add at least one income or expense amount (or a label with an amount).", "Добави поне един приход или разход (или ред с име и сума).");
          errEl.classList.remove("hidden");
        }
        setBusinessAddDetailsOpen(true);
        return;
      }
      const newId = businessEditBackup ? businessEditBackup.id : uid();
      businessEditBackup = null;
      businessOpenDetailId = newId;
      state.businessLog.unshift({
        id: newId,
        label,
        income,
        expenses,
        incomeItems,
        expenseItems,
      });
      if (el("businessMonthLabel")) el("businessMonthLabel").value = "";
      resetBusinessDraft();
      const lead = el("businessAddLead");
      if (lead) {
        lead.textContent = tr(
          "Add your monthly incomes, expenses, and lines as you like, then save. You can use decimals (e.g. 19.99).",
          "Добави месечните си приходи, разходи и редове, след това запази. Може да използваш десетични стойности (напр. 19.99)."
        );
      }
      savePlanner();
      renderBusinessLog();
      setBusinessAddDetailsOpen(false);
    });

    el("btnBusinessEditLatest")?.addEventListener("click", () => startEditLatestBusinessMonth());
    el("btnBusinessCancelEdit")?.addEventListener("click", () => cancelLatestBusinessMonthEdit());

    el("btnCommitLoan").addEventListener("click", () => {
      const err = el("debtDraftError");
      if (err) {
        err.classList.add("hidden");
        err.textContent = "";
      }
      const name = el("debtDraftName").value.trim();
      if (!name) {
        if (err) {
          err.textContent = tr("Give this debt a name, you’ll thank yourself later.", "Дай име на този дълг - после ще ти е по-лесно.");
          err.classList.remove("hidden");
        }
        setDebtAddDetailsOpen(true);
        return;
      }
      const balance = Math.max(0, Number(el("debtDraftBalance").value) || 0);
      const apr = Math.max(0, Number(el("debtDraftApr").value) || 0);
      const monthlyPayment = Math.max(0, Number(el("debtDraftPayment").value) || 0);
      const tier = normalizeTier(el("debtDraftTier").value);
      state.loans.push({
        id: uid(),
        name,
        balance,
        apr,
        monthlyPayment,
        tier,
        payments: [],
      });
      el("debtDraftName").value = "";
      el("debtDraftBalance").value = "";
      el("debtDraftApr").value = "";
      el("debtDraftPayment").value = "";
      el("debtDraftTier").value = "other";
      savePlanner();
      setDebtAddDetailsOpen(false);
      refresh();
    });

    const btnPayConfirm = el("btnPayDebtConfirm");
    if (btnPayConfirm) {
      btnPayConfirm.addEventListener("click", () => {
        const errEl = el("payDebtError");
        if (errEl) {
          errEl.classList.add("hidden");
          errEl.textContent = "";
        }
        const i = Number(el("payDebtLoanIndex").value);
        if (Number.isNaN(i) || !state.loans[i]) {
          closePayDebtModal();
          return;
        }
        const amount = Number(el("payDebtAmount").value);
        if (!(amount > 0)) {
          if (errEl) {
            errEl.textContent = tr("Enter the amount you actually paid (above zero).", "Въведи реално платената сума (над нула).");
            errEl.classList.remove("hidden");
          }
          return;
        }
        const note = el("payDebtNote").value;
        const dateVal = el("payDebtDate").value;
        if (recordLoanPayment(i, amount, note, dateVal)) {
          savePlanner();
          closePayDebtModal();
          refresh();
        } else if (errEl) {
          errEl.textContent = tr("That payment didn’t apply, check the amount and balance.", "Плащането не беше приложено - провери сумата и остатъка.");
          errEl.classList.remove("hidden");
        }
      });
    }
    el("btnClosePayDebt")?.addEventListener("click", closePayDebtModal);
    el("btnPayDebtCancel")?.addEventListener("click", closePayDebtModal);
    el("payDebtModal")?.addEventListener("click", (e) => {
      if (e.target === el("payDebtModal")) closePayDebtModal();
    });

    el("btnCloseAddIncome")?.addEventListener("click", closeAddIncomeModal);
    el("btnAddIncomeCancel")?.addEventListener("click", closeAddIncomeModal);
    el("addIncomeModal")?.addEventListener("click", (e) => {
      if (e.target === el("addIncomeModal")) closeAddIncomeModal();
    });
    el("btnAddIncomeConfirm")?.addEventListener("click", () => commitAddIncomeModal());

    el("btnCloseAddExpense")?.addEventListener("click", closeAddExpenseModal);
    el("btnAddExpenseCancel")?.addEventListener("click", closeAddExpenseModal);
    el("addExpenseModal")?.addEventListener("click", (e) => {
      if (e.target === el("addExpenseModal")) closeAddExpenseModal();
    });
    el("btnAddExpenseConfirm")?.addEventListener("click", () => commitAddExpenseModal());

    bindInvestor();
    bindInvestorLadderChecks();

    function buildBackupObject() {
      return {
        improverUxBackup: 1,
        exportedAt: new Date().toISOString(),
        planner: {
          income: state.budget.income,
          mustPayBills: state.budget.mustPayBills,
          incomeItems: state.incomeItems,
          billItems: state.billItems,
          monthLog: state.monthLog,
          businessLog: state.businessLog,
          loans: state.loans,
          investor: state.investor,
        },
        profile: { displayName: state.profile.displayName || "" },
        photoDataUrl: getPhotoDataUrl() || null,
      };
    }

    el("btnExportBackup")?.addEventListener("click", () => {
      const payload = buildBackupObject();
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      const stamp = new Date().toISOString().slice(0, 10);
      a.href = URL.createObjectURL(blob);
      a.download = `calmplan-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      paintIcons();
    });

    // Mobile Safari can ignore label->hidden file input activation.
    // Keep the label UX, but force an explicit file picker open.
    el("btnImportBackup")?.addEventListener("click", (e) => {
      const input = el("importBackupInput");
      if (!input) return;
      e.preventDefault();
      input.click();
    });

    el("importBackupInput")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!window.confirm(tr("Replace everything in this app on this device with this backup?", "Да заменя ли всички данни в приложението на това устройство с този архив?"))) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.improverUxBackup !== 1 || !data.planner || typeof data.planner !== "object") {
          window.alert(tr("That file doesn’t look like a CalmPlan backup.", "Този файл не изглежда като архив на CalmPlan."));
          return;
        }
        applyPlannerPayload(data.planner);
        businessEditBackup = null;
        businessOpenDetailId = null;
        savePlanner();
        if (data.profile && typeof data.profile === "object") {
          state.profile.displayName = typeof data.profile.displayName === "string" ? data.profile.displayName : "";
          saveProfile();
        }
        if (typeof data.photoDataUrl === "string" && data.photoDataUrl) setPhotoDataUrl(data.photoDataUrl);
        syncFormFromState();
        el("displayName").value = state.profile.displayName || "";
        renderIncomeItems();
        renderBillItems();
        renderMonthLog();
        renderBusinessLog();
        resetBusinessDraft();
        updateNavAvatar();
        updateAccountPanel();
        refresh();
        paintIcons();
      } catch (_) {
        window.alert(tr("Could not read that backup file.", "Не успях да прочета този архивен файл."));
      }
    });

    el("btnProfile").addEventListener("click", openModal);
    el("btnCloseProfile").addEventListener("click", closeModal);
    el("profileModal").addEventListener("click", (e) => {
      if (e.target === el("profileModal")) closeModal();
    });

    el("displayName").addEventListener("input", () => {
      state.profile.displayName = el("displayName").value;
      saveProfile();
      updateNavAvatar();
    });

    el("photoInput").addEventListener("change", async (e) => {
      const f = e.target.files?.[0];
      if (!f) return;
      try {
        const dataUrl = await resizeImageFile(f);
        setPhotoDataUrl(dataUrl);
        updateNavAvatar();
      } catch (_) {}
      e.target.value = "";
    });

    el("btnRemovePhoto").addEventListener("click", () => {
      setPhotoDataUrl(null);
      updateNavAvatar();
    });

    el("guestAuth").querySelectorAll(".auth-tab").forEach((t) => {
      t.addEventListener("click", () => setAuthTab(t.getAttribute("data-tab")));
    });

    document.querySelectorAll(".app-tab").forEach((btn) => {
      btn.addEventListener("click", () => setAppTab(btn.getAttribute("data-app-tab")));
    });

    try {
      const saved = sessionStorage.getItem(APP_TAB_KEY);
      if (saved) setAppTab(saved);
    } catch (_) {}

    el("btnAuthSubmit").addEventListener("click", async () => {
      const errEl = el("authError");
      errEl.classList.add("hidden");
      const email = el("authEmail").value;
      const pw = el("authPassword").value;
      const cf = el("authConfirm").value;
      let err = null;
      if (authTab === "register") err = await registerAccount(email, pw, cf);
      else err = await loginAccount(email, pw);
      if (err) {
        errEl.textContent = err;
        errEl.classList.remove("hidden");
        return;
      }
      el("authEmail").value = "";
      el("authPassword").value = "";
      el("authConfirm").value = "";
      loadPlanner();
      syncFormFromState();
      businessEditBackup = null;
      businessOpenDetailId = null;
      resetBusinessDraft();
      updateAccountPanel();
      refresh();
    });

    el("btnSignOut").addEventListener("click", () => {
      signOut();
      loadPlanner();
      syncFormFromState();
      businessEditBackup = null;
      businessOpenDetailId = null;
      resetBusinessDraft();
      updateAccountPanel();
      refresh();
    });

    el("btnDeleteAccount").addEventListener("click", async () => {
      const errEl = el("authError");
      errEl.classList.add("hidden");
      const err = await deleteAccount(el("deletePassword").value);
      if (err) {
        errEl.textContent = err;
        errEl.classList.remove("hidden");
        return;
      }
      el("deletePassword").value = "";
      syncFormFromState();
      businessEditBackup = null;
      businessOpenDetailId = null;
      resetBusinessDraft();
      updateAccountPanel();
      refresh();
    });

    setAuthTab("signin");
    refresh();
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();
})();
