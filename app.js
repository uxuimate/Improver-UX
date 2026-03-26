(function () {
  "use strict";

  const STORAGE = {
    sessionFp: "payoff.session.fingerprint",
    sessionEmail: "payoff.session.email",
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

  function uid() {
    return crypto.randomUUID();
  }

  function round2(n) {
    return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
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

  function sortedLineItemDisplayOrder(items) {
    return items
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        const c = compareLineItemDateDesc(a.row.date, b.row.date);
        return c !== 0 ? c : a.i - b.i;
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
  }

  function mergeInvestor(raw) {
    if (!raw || typeof raw !== "object") {
      const inv = { monthlyStake: 0, bankroll: 0, target: 0, ladderLegs: 7, ladderOdds: 3, completedLegs: [] };
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
    };
    padInvestorCompleted(inv);
    return inv;
  }

  function defaultInvestorGuest() {
    const inv = { monthlyStake: 100, bankroll: 100, target: 20000, ladderLegs: 7, ladderOdds: 3, completedLegs: [] };
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
    if (r.insolvent) return "These numbers don’t cover every planned payment this month";
    if (r.monthsToDebtFree != null) return `Rough interest over the journey: ${moneyFull(r.totalInterest)}`;
    return "On paper this mix may not reach zero, check rates and monthly payments";
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
      return { name: pick.name, reason: "For people you know, we start with the smallest balance, quick wins and clearer heads." };
    }
    pick = bucket.reduce((b, x) => (x.apr > b.apr ? x : b));
    const label = minTier === 1 ? "On overdraft / bank debt" : "In this bucket";
    return { name: pick.name, reason: `${label}, the steepest rate is ${pick.apr.toFixed(1)}%, that’s where extra hurts least to ignore.` };
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
    src.setAttribute("aria-label", "Name");
    src.textContent = row.name || "";

    const amt = node("span", "money-cell-text bill-line-amount money-cell-text--amount");
    amt.setAttribute("aria-label", "Amount");
    // Match the existing look: amounts in the rows are displayed without the "£" symbol.
    amt.textContent = money(row.amount || 0);

    const dt = node("span", "money-cell-text bill-line-date money-cell-text--date");
    dt.setAttribute("aria-label", "Date");
    dt.textContent = formatDateDMY(row.date || "");

    const btn = node("button", "money-row-x bill-line-del");
    btn.type = "button";
    btn.setAttribute("aria-label", "Remove line");
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
    del.setAttribute("aria-label", "Remove line");
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
    p.append("Planned debt payments (");
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
    wrap.setAttribute("aria-label", "What you planned to pay toward debts this month");
    const list = node("div", "ios-summary-list");
    list.setAttribute("role", "list");
    const headroomClass = spareAfterPlan >= 0 ? "ios-summary-value--accent" : "ios-summary-value--warn";
    list.append(
      buildIosSummaryRow("Planned to all debts", moneyFull(sumPlanned), "ios-summary-value--text", false),
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
    btn.setAttribute("aria-label", "Remove snapshot");
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
    amt.setAttribute("aria-label", "Amount");
    amt.setAttribute("autocomplete", "off");
    const btn = node("button", "business-draft-remove");
    btn.type = "button";
    btn.setAttribute("aria-label", "Remove line");
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

  function startEditLatestBusinessMonth() {
    if (!state.businessLog.length || businessEditBackup) return;
    const entry = state.businessLog[0];
    businessEditBackup = {
      id: entry.id,
      label: entry.label,
      income: entry.income,
      expenses: entry.expenses,
      incomeItems: Array.isArray(entry.incomeItems) ? entry.incomeItems.map((x) => ({ ...x })) : [],
      expenseItems: Array.isArray(entry.expenseItems) ? entry.expenseItems.map((x) => ({ ...x })) : [],
    };
    state.businessLog.shift();
    if (el("businessMonthLabel")) el("businessMonthLabel").value = businessEditBackup.label || "";
    fillBusinessDraftFromEntry(businessEditBackup);
    const lead = el("businessAddLead");
    if (lead) {
      lead.textContent =
        "You’re editing this month. Add month to save your changes, or Cancel to restore the previous save.";
    }
    savePlanner();
    renderBusinessLog();
    paintIcons();
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
        "Add your monthly incomes, expenses, and lines as you like, then save. You can use decimals (e.g. 19.99).";
    }
    savePlanner();
    renderBusinessLog();
  }

  function bindBusinessDraftOnce() {
    const panel = el("panelBusiness");
    if (!panel || panel.dataset.businessDraftBound) return;
    panel.dataset.businessDraftBound = "1";
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
    const tr = node("tr");
    [entry.label, moneyFull(income), moneyFull(expenses), moneyFull(profit)].forEach((cellText) => {
      const td = node("td");
      td.textContent = cellText;
      tr.appendChild(td);
    });
    const tdBtn = node("td");
    const btn = node("button", "del-snap");
    btn.type = "button";
    btn.setAttribute("aria-label", "Remove business month");
    btn.setAttribute("data-business-del", String(index));
    const ix = node("i");
    ix.setAttribute("data-lucide", "x");
    btn.appendChild(ix);
    tdBtn.appendChild(btn);
    tr.appendChild(tdBtn);

    const incItems = Array.isArray(entry.incomeItems) ? entry.incomeItems.filter((x) => x.name || x.amount) : [];
    const expItems = Array.isArray(entry.expenseItems) ? entry.expenseItems.filter((x) => x.name || x.amount) : [];
    const frag = document.createDocumentFragment();
    frag.appendChild(tr);
    if (incItems.length + expItems.length > 0) {
      const tr2 = node("tr", "business-log-detail");
      const td = node("td");
      td.colSpan = 5;
      const det = node("details");
      const sum = node("summary");
      sum.textContent = "Line items";
      const ul = node("ul", "business-log-lines");
      incItems.forEach((x) => {
        const li = node("li");
        li.textContent = `In: ${x.name || "Income"} · ${moneyFull(x.amount)}`;
        ul.appendChild(li);
      });
      expItems.forEach((x) => {
        const li = node("li");
        li.textContent = `Out: ${x.name || "Expense"} · ${moneyFull(x.amount)}`;
        ul.appendChild(li);
      });
      det.append(sum, ul);
      td.appendChild(det);
      tr2.appendChild(td);
      frag.appendChild(tr2);
    }
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
    const plannedApply = round2(Math.min(mp, bal));
    const newBal = Math.max(0, round2(bal - plannedApply));
    const payments = Array.isArray(loan.payments) ? loan.payments : [];
    const paidOff = bal <= 0.005;
    const capPart = mp > bal ? " (capped by what’s left)" : "";

    const article = node("article", "card glass money-card debt-card");
    article.setAttribute("data-loan-index", String(index));

    const top = node("div", "debt-card-top");
    const nameIn = node("input", "debt-card-title-input");
    nameIn.type = "text";
    nameIn.placeholder = "Name this debt";
    nameIn.setAttribute("aria-label", "Name of debt");
    nameIn.value = loan.name;
    nameIn.setAttribute("data-k", "name");
    nameIn.setAttribute("data-i", String(index));
    const rm = node("button", "btn-trash debt-card-remove");
    rm.type = "button";
    rm.setAttribute("aria-label", "Remove this debt");
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

    const planned = node("div", "debt-card-planned");
    const pMain = node("p", "debt-card-planned-main");
    pMain.append("You’re planning ");
    const planAmt = node("strong");
    planAmt.textContent = moneyFull(plannedApply);
    pMain.append(planAmt, ` this month toward this debt${capPart}.`);
    const pSub = node("p", "debt-card-planned-sub muted small");
    pSub.append("If you paid that much, you’d be down to about ");
    const newBalS = node("strong");
    newBalS.textContent = moneyFull(newBal);
    pSub.append(newBalS, " before interest.");
    planned.append(pMain, pSub);

    const tierLab = node("label", "field loan-tier debt-card-tier");
    const tierSpan = node("span", "field-label");
    tierSpan.textContent = "Type (changes suggested payoff order)";
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

    const fieldsPlan = node("div", "debt-card-fields debt-card-fields--plan");
    appendLabelledNumberField(fieldsPlan, "Payment this month (£)", "monthlyPayment", index, mp, "0.01");

    article.append(top, balLab, balEl, planned, tierLab, fieldsDebt, fieldsPlan);

    if (paidOff) {
      const po = node("p", "debt-card-paid-off muted small");
      po.textContent = "Nothing left on this one. Remove it if you like, or keep it for your records.";
      article.appendChild(po);
    } else {
      const actions = node("div", "debt-card-actions");
      const b1 = node("button", "btn primary btn-with-lucide");
      b1.type = "button";
      b1.setAttribute("data-pay-record", String(index));
      const i1 = node("i");
      i1.setAttribute("data-lucide", "banknote");
      b1.append(i1, document.createTextNode(" Record payment"));
      const b2 = node("button", "btn secondary btn-with-lucide");
      b2.type = "button";
      b2.setAttribute("data-pay-planned", String(index));
      if (plannedApply <= 0) b2.disabled = true;
      const i2 = node("i");
      i2.setAttribute("data-lucide", "zap");
      b2.append(i2, document.createTextNode(` Use planned amount (${moneyFull(plannedApply)})`));
      actions.append(b1, b2);
      article.appendChild(actions);
    }

    if (payments.length > 0) {
      const det = node("details", "debt-payment-log");
      const sum = node("summary", "debt-payment-log__summary");
      sum.textContent = `Payments you’ve recorded (${payments.length})`;
      const ul = node("ul", "debt-payment-log__list");
      payments.slice(0, 20).forEach((p) => {
        const li = node("li");
        const notePart = p.note ? ` · ${p.note}` : "";
        li.textContent = `${formatShortDate(p.at)} · ${moneyFull(p.amount)}${notePart}`;
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
      const pr = e.target.closest("[data-pay-record]");
      if (pr) {
        openPayDebtModal(Number(pr.getAttribute("data-pay-record")));
        return;
      }
      const pp = e.target.closest("[data-pay-planned]");
      if (pp && !pp.disabled) {
        const i = Number(pp.getAttribute("data-pay-planned"));
        const loan = state.loans[i];
        if (!loan) return;
        const b = Math.max(0, Number(loan.balance) || 0);
        const mPay = Math.max(0, Number(loan.monthlyPayment) || 0);
        const amt = round2(Math.min(mPay, b));
        if (amt <= 0) return;
        if (recordLoanPayment(i, amt, "Planned monthly payment")) {
          savePlanner();
          refresh();
        }
      }
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
      const b = e.target.closest("[data-business-del]");
      if (!b) return;
      const i = Number(b.getAttribute("data-business-del"));
      state.businessLog.splice(i, 1);
      savePlanner();
      renderBusinessLog();
    });
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
    hName.textContent = "Name";
    const hAmt = node("span", "money-lines-head-cell money-lines-head-cell--amount");
    hAmt.textContent = "Amount";
    const hDate = node("span", "money-lines-head-cell money-lines-head-cell--date");
    hDate.textContent = "Date";
    const hStatus = node("span", "money-lines-head-cell money-lines-head-cell--status");
    hStatus.textContent = "Status";
    head.append(hName, hAmt, hDate, hStatus);
    list.appendChild(head);

    sortedLineItemDisplayOrder(state.incomeItems).forEach(({ row, i: index }) => {
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
    hName.textContent = "Name";
    const hAmt = node("span", "money-lines-head-cell money-lines-head-cell--amount");
    hAmt.textContent = "Amount";
    const hDate = node("span", "money-lines-head-cell money-lines-head-cell--date");
    hDate.textContent = "Date";
    const hStatus = node("span", "money-lines-head-cell money-lines-head-cell--status");
    hStatus.textContent = "Status";
    head.append(hName, hAmt, hDate, hStatus);
    list.appendChild(head);

    sortedLineItemDisplayOrder(state.billItems).forEach(({ row: b, i: index }) => {
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

  function openPayDebtModal(index) {
    const loan = state.loans[index];
    if (!loan) return;
    const bal = Math.max(0, Number(loan.balance) || 0);
    const mp = Math.max(0, Number(loan.monthlyPayment) || 0);
    const suggested = round2(Math.min(mp, bal));
    const title = el("payDebtTitle");
    const ctx = el("payDebtContext");
    if (title) title.textContent = "Record a payment";
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
        errEl.textContent = "Add a source name (e.g. Salary / wages).";
        errEl.classList.remove("hidden");
      }
      return false;
    }
    if (!(amount > 0)) {
      if (errEl) {
        errEl.textContent = "Enter an amount above zero.";
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
        errEl.textContent = "Add a source name (e.g. Rent / housing).";
        errEl.classList.remove("hidden");
      }
      return false;
    }
    if (!(amount > 0)) {
      if (errEl) {
        errEl.textContent = "Enter an amount above zero.";
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
    state.monthLog.forEach((m, index) => {
      tbody.appendChild(buildMonthLogRow(m, index));
    });
    paintIcons();
  }

  function renderBusinessLog() {
    const tbody = el("businessMonthBody");
    const empty = el("businessMonthEmpty");
    const latestProfitEl = el("businessProfitMonth");
    const totalEarningsEl = el("businessTotalEarnings");
    const labEl = el("businessLatestMonthLabel");
    const incDisp = el("businessLatestIncomeDisplay");
    const expDisp = el("businessLatestExpenseDisplay");
    const editBtn = el("btnBusinessEditLatest");
    const cancelBtn = el("btnBusinessCancelEdit");

    const totalEarnings = round2(
      state.businessLog.reduce((sum, row) => {
        const t = businessMonthTotals(row);
        return sum + (t.income - t.expenses);
      }, 0)
    );

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
      if (labEl) labEl.textContent = "No month saved yet.";
    }

    if (incDisp) incDisp.textContent = moneyFull(latestInc);
    if (expDisp) expDisp.textContent = moneyFull(latestExp);
    if (latestProfitEl) {
      latestProfitEl.textContent = moneyFull(latestProfit);
      latestProfitEl.classList.toggle("mint", latestProfit >= 0);
      latestProfitEl.classList.toggle("big-stat--warn", latestProfit < 0);
    }
    if (totalEarningsEl) totalEarningsEl.textContent = moneyFull(totalEarnings);

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
    state.businessLog.forEach((m, index) => {
      tbody.appendChild(buildBusinessLogRows(m, index));
    });
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
    li2.append("Planned to debts this month: ", s2);
    list.appendChild(li2);
    const li3 = node("li");
    const s3 = node("strong");
    s3.textContent = moneyFull(spareAfterPlan);
    if (spareAfterPlan < -0.005) s3.style.color = "var(--warning)";
    li3.append("Left after planned debt payments: ", s3);
    list.appendChild(li3);
    foot.textContent =
      "Change planned amounts on Debts: open each card and set Payment this month (£). Change income or bills on Money.";
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
    savePlanner();

    const sumPlanned = state.loans.filter((l) => Number(l.balance) > 0).reduce((s, l) => s + (Number(l.monthlyPayment) || 0), 0);
    const leftForDebt = income - mustPay;
    const snapIn = el("snapIncome");
    if (snapIn) snapIn.textContent = moneyFull(income);
    const cashDebtEl = el("cashDebt");
    if (cashDebtEl) {
      cashDebtEl.textContent = moneyFull(leftForDebt);
      cashDebtEl.classList.remove("ios-summary-value--accent", "ios-summary-value--warn");
      cashDebtEl.classList.add(leftForDebt >= 0 ? "ios-summary-value--accent" : "ios-summary-value--warn");
    }
    const spareAfterPlan = leftForDebt - sumPlanned;
    const debtCtx = el("moneyDebtContext");
    if (debtCtx) {
      if (state.loans.length === 0) {
        debtCtx.classList.add("hidden");
        debtCtx.innerHTML = "";
      } else {
        debtCtx.classList.remove("hidden");
        setMoneyDebtContextVisible(debtCtx, sumPlanned, spareAfterPlan);
      }
    }

    const adv = el("leftoverAdvice");
    if (state.loans.length === 0) {
      adv.textContent = "When you add debts on the Debts tab, we’ll show payoff order and timelines on Payoff.";
    } else {
      adv.textContent = "Open Payoff for a suggested order and how debt could shrink over time.";
    }

    const insolvent = leftForDebt + 0.001 < sumPlanned && state.loans.length > 0;
    const ban = el("insolventBanner");
    if (insolvent) {
      ban.classList.remove("hidden");
      ban.textContent =
        "After bills, you don’t have enough for the debt payments you’ve planned this month. Lower some “payment this month” amounts, trim bills, or bump income if you can.";
    } else ban.classList.add("hidden");

    const dps = el("debtsPaySummary");
    if (dps) {
      if (!state.loans.length) {
        dps.classList.add("hidden");
        dps.replaceChildren();
      } else {
        dps.classList.remove("hidden");
        mountDebtsPaySummary(dps, sumPlanned, leftForDebt, spareAfterPlan);
      }
    }

    updatePayoffAtAGlance(sumPlanned, leftForDebt, spareAfterPlan);

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
      rec.textContent = "Add what you owe on Debts and keep Money honest, then this picture matches real life.";
    } else if (pr.insolvent || av.insolvent) {
      rec.textContent = "Right now, after bills, there isn’t enough for the payments you’ve set on each debt. Fix that first; avalanche vs snowball only helps once the plan fits.";
    } else if (pr.monthsToDebtFree == null) {
      rec.textContent = "With these balances and rates, the maths may not reach zero, double-check interest and monthly payments.";
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
    el("btnAuthSubmit").textContent = tab === "register" ? "Create account" : "Sign in";
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
      targetHtml = `<p class="investor-analysis-line muted">Enter a bankroll above to run the numbers.</p>`;
    } else if (!T || T <= B) {
      targetHtml = `<p class="investor-analysis-line muted">Add a target above your bankroll to see how many winning steps you’d need at different odds (e.g. 2× vs 3× per step).</p>`;
      if (monthly > 0) {
        targetHtml += `<p class="investor-analysis-line">Planned stake this month: <strong>${moneyFull(monthly)}</strong> (not compounded into the ladder below unless you add it to bankroll).</p>`;
      }
    } else {
      const ratio = T / B;
      const n2 = Math.ceil(Math.log(ratio) / Math.LN2);
      const n3 = Math.ceil(Math.log(ratio) / Math.log(3));
      const nL = oL > 1 ? Math.ceil(Math.log(ratio) / Math.log(oL)) : null;
      targetHtml = `<p class="investor-analysis-line">Growth needed: about <strong>×${round2(ratio)}</strong> from ${moneyFull(B)} to ${moneyFull(T)}.</p>`;
      targetHtml += `<p class="investor-analysis-line">At <strong>2.0</strong> odds every winning step: about <strong>${n2}</strong> steps (e.g. ${n2} sessions if you do one step per day).</p>`;
      targetHtml += `<p class="investor-analysis-line">At <strong>3.0</strong> odds every winning step: about <strong>${n3}</strong> steps.</p>`;
      if (nL != null && Math.abs(oL - 2) > 0.05 && Math.abs(oL - 3) > 0.05) {
        targetHtml += `<p class="investor-analysis-line">At your ladder odds <strong>${round2(oL)}</strong>: about <strong>${nL}</strong> winning steps.</p>`;
      }
      if (monthly > 0) {
        targetHtml += `<p class="investor-analysis-line muted small">Monthly stake ${moneyFull(monthly)} is separate from this compound path unless you bank it.</p>`;
      }
    }
    outTarget.innerHTML = targetHtml;

    const ladderHost = el("invLadderTable");
    if (ladderHost && B > 0 && oL > 1) {
      const rows = [];
      let balance = B;
      const checks = i.completedLegs || [];
      for (let day = 1; day <= legs; day++) {
        const start = balance;
        const end = start * oL;
        const done = !!checks[day - 1];
        rows.push(
          `<tr class="${done ? "inv-day-done" : ""}"><td class="inv-check-cell"><label class="inv-check-label"><input type="checkbox" class="inv-day-check" data-inv-day="${day}" ${done ? "checked" : ""} aria-label="Day ${day} completed" /></label></td><td>${day}</td><td>${moneyFull(start)}</td><td>×${round2(oL)}</td><td>${moneyFull(end)}</td></tr>`
        );
        balance = end;
      }
      ladderHost.innerHTML = `<table><thead><tr><th>Done</th><th>Day</th><th>Balance in</th><th>Odds</th><th>Balance out</th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
    } else if (ladderHost) {
      ladderHost.innerHTML = `<p class="tiny muted">Set bankroll and ladder odds to preview each leg.</p>`;
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
  }

  function bindInvestor() {
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

    syncFormFromState();

    bindMoneyLineListsOnce();
    bindLoanListOnce();
    bindMonthLogTableOnce();
    bindBusinessTableOnce();
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
          errEl.textContent = "Add at least one income or expense amount (or a label with an amount).";
          errEl.classList.remove("hidden");
        }
        return;
      }
      const newId = businessEditBackup ? businessEditBackup.id : uid();
      businessEditBackup = null;
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
        lead.textContent =
          "Add your monthly incomes, expenses, and lines as you like, then save. You can use decimals (e.g. 19.99).";
      }
      savePlanner();
      renderBusinessLog();
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
          err.textContent = "Give this debt a name, you’ll thank yourself later.";
          err.classList.remove("hidden");
        }
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
            errEl.textContent = "Enter the amount you actually paid (above zero).";
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
          errEl.textContent = "That payment didn’t apply, check the amount and balance.";
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
      a.download = `improver-ux-backup-${stamp}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
      paintIcons();
    });

    el("importBackupInput")?.addEventListener("change", async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      if (!window.confirm("Replace everything in this app on this device with this backup?")) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.improverUxBackup !== 1 || !data.planner || typeof data.planner !== "object") {
          window.alert("That file doesn’t look like an Improver UX backup.");
          return;
        }
        applyPlannerPayload(data.planner);
        businessEditBackup = null;
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
        window.alert("Could not read that backup file.");
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
      resetBusinessDraft();
      updateAccountPanel();
      refresh();
    });

    el("btnSignOut").addEventListener("click", () => {
      signOut();
      loadPlanner();
      syncFormFromState();
      businessEditBackup = null;
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
