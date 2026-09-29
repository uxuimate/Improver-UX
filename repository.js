/**
 * CalmPlan data layer — categories, minor units, migration, repository interface.
 * Storage is localStorage today; swap the adapter later without touching UI.
 */
(function (global) {
  "use strict";

  const SCHEMA_VERSION = 2;

  /**
   * Starting category sets (editable in code).
   * Business expense labels align with GOV.UK self-employment allowable-expense groups
   * (office, travel, stock, advertising, phone/internet under office/comms, bank charges,
   * professional fees, premises). Staff costs and clothing are omitted here as UI starters;
   * map them under Other or extend this list before relying on an HMRC export.
   * @see https://www.gov.uk/expenses-if-youre-self-employed
   */
  const CATEGORIES = {
    businessExpenses: [
      "Office costs",
      "Travel",
      "Stock & materials",
      "Advertising",
      "Phone & internet",
      "Bank charges",
      "Professional fees",
      "Premises",
      "Other",
    ],
    personal: ["Rent/housing", "Bills", "Food", "Transport", "Debt payment", "Other"],
    income: ["Salary/wages", "Self-employed income", "Benefits", "Other"],
  };

  function toMinor(major) {
    const n = Number(major);
    if (!Number.isFinite(n)) return 0;
    return Math.round(n * 100);
  }

  function fromMinor(minor) {
    const n = Number(minor);
    if (!Number.isFinite(n)) return 0;
    return n / 100;
  }

  function isoNow() {
    return new Date().toISOString();
  }

  function todayYmd() {
    return new Date().toISOString().slice(0, 10);
  }

  function clampYmd(raw, fallback) {
    const s = typeof raw === "string" ? raw.trim().slice(0, 10) : "";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    return fallback !== undefined ? fallback : todayYmd();
  }

  /** Parse labels like "Mar 2026", "2026-03", "March 2026" → yyyy-mm-01 when possible. */
  function dateFromMonthLabel(label, fallbackYmd) {
    const s = String(label || "").trim();
    if (!s) return fallbackYmd !== undefined ? fallbackYmd : todayYmd();
    if (/^\d{4}-\d{2}$/.test(s)) return s + "-01";
    if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
    const isoish = s.match(/(\d{4})-(\d{2})/);
    if (isoish) return `${isoish[1]}-${isoish[2]}-01`;
    const months =
      "january|february|march|april|may|june|july|august|september|october|november|december|" +
      "jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec";
    const named = s.match(new RegExp(`\\b(${months})\\b[\\s,.-]*(\\d{4})`, "i"));
    if (named) {
      const map = {
        january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
        may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
        september: 9, sept: 9, sep: 9, october: 10, oct: 10, november: 11, nov: 11, december: 12, dec: 12,
      };
      const mi = map[named[1].toLowerCase()];
      if (mi) return `${named[2]}-${String(mi).padStart(2, "0")}-01`;
    }
    const parsed = Date.parse(s);
    if (!Number.isNaN(parsed)) {
      const d = new Date(parsed);
      if (!Number.isNaN(d.getTime())) {
        const y = d.getFullYear();
        const m = String(d.getMonth() + 1).padStart(2, "0");
        if (y >= 2000 && y <= 2100) return `${y}-${m}-01`;
      }
    }
    return fallbackYmd !== undefined ? fallbackYmd : todayYmd();
  }

  function dateFromBusinessEntry(entry, fallbackYmd) {
    const id = String((entry && entry.id) || "");
    const fromId = id.match(/(\d{4}-\d{2})/);
    if (fromId) return `${fromId[1]}-01`;
    return dateFromMonthLabel(entry && entry.label, fallbackYmd);
  }

  function tierToKind(tier) {
    if (tier === "people") return "person";
    if (tier === "overdraft") return "bank";
    return "card_loan";
  }

  function kindToTier(kind) {
    if (kind === "person") return "people";
    if (kind === "bank") return "overdraft";
    return "other";
  }

  function guessIncomeCategory(name) {
    const n = String(name || "")
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (/salary|wage/.test(n)) return "Salary/wages";
    if (/self[- ]?employ|freelance|business income|invoice/.test(n)) return "Self-employed income";
    if (/benefit|uc |universal credit|pip|dla/.test(n)) return "Benefits";
    if (CATEGORIES.income.includes(name)) return name;
    return "Other";
  }

  function guessPersonalExpenseCategory(name) {
    const n = String(name || "")
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (/rent|housing|mortgage/.test(n)) return "Rent/housing";
    if (/bill|utilit|council|water|gas|electric|minimum/.test(n)) return "Bills";
    if (/food|grocer|supermarket/.test(n)) return "Food";
    if (/transport|travel|bus|train|fuel|petrol/.test(n)) return "Transport";
    if (/debt/.test(n)) return "Debt payment";
    if (CATEGORIES.personal.includes(name)) return name;
    return "Other";
  }

  function guessBusinessExpenseCategory(name) {
    const n = String(name || "")
      .toLowerCase()
      .replace(/\s+/g, " ");
    if (/office|stationer|software|postage|print/.test(n)) return "Office costs";
    if (/travel|fuel|parking|train|bus|taxi|hotel/.test(n)) return "Travel";
    if (/stock|material|goods|inventory/.test(n)) return "Stock & materials";
    if (/advert|marketing|website|promo/.test(n)) return "Advertising";
    if (/phone|internet|mobile|broadband/.test(n)) return "Phone & internet";
    if (/bank|card charge|finance charge/.test(n)) return "Bank charges";
    if (/accountant|legal|solicitor|professional|insurance/.test(n)) return "Professional fees";
    if (/premis|rent|rates|heating|lighting/.test(n)) return "Premises";
    if (CATEGORIES.businessExpenses.includes(name)) return name;
    return "Other";
  }

  /** Keep the user's line name when the taxonomy guess falls back to Other. */
  function preferNamedCategory(guessed, name, fallback) {
    const g = String(guessed || "").trim();
    const n = String(name || "").trim().slice(0, 80);
    if (g && g !== "Other") return g;
    if (n && n !== "Other" && n !== "Imported monthly total" && n !== "Month archive") return n;
    if (fallback) return fallback;
    return g || "Other";
  }

  const GENERIC_CATEGORIES = new Set(["Other", "Imported monthly total", "Month archive", ""]);

  /**
   * Lift original names out of note when category was collapsed to Other / import stubs.
   * Safe / idempotent for already-good data.
   */
  function repairPreservedNames(transactions) {
    if (!Array.isArray(transactions)) return [];
    return transactions.map((t) => {
      if (!t || typeof t !== "object") return t;
      const cat = String(t.category || "").trim();
      const note = String(t.note || "").trim().slice(0, 80);
      if (!GENERIC_CATEGORIES.has(cat)) return t;
      if (!note || GENERIC_CATEGORIES.has(note)) return t;
      return { ...t, category: note, note };
    });
  }

  function normalizeTransaction(raw, uidFn) {
    const idFn = typeof uidFn === "function" ? uidFn : () => global.crypto.randomUUID();
    const r = raw && typeof raw === "object" ? raw : {};
    const type = r.type === "income" ? "income" : "expense";
    let amountMinor = Number(r.amountMinor);
    if (!Number.isFinite(amountMinor)) amountMinor = toMinor(r.amount);
    amountMinor = Math.max(0, Math.round(amountMinor));
    const currency = r.currency === "EUR" ? "EUR" : "GBP";
    const scope = r.scope === "business" ? "business" : "personal";
    const now = isoNow();
    const tx = {
      id: typeof r.id === "string" && r.id ? r.id : idFn(),
      date: clampYmd(r.date, todayYmd()),
      type,
      amountMinor,
      currency,
      category: typeof r.category === "string" && r.category.trim() ? r.category.trim().slice(0, 80) : "Other",
      scope,
      createdAt: typeof r.createdAt === "string" && r.createdAt ? r.createdAt : now,
      updatedAt: typeof r.updatedAt === "string" && r.updatedAt ? r.updatedAt : now,
    };
    if (typeof r.note === "string" && r.note.trim()) tx.note = r.note.trim().slice(0, 200);
    if (typeof r.receiptId === "string" && r.receiptId) tx.receiptId = r.receiptId;
    if (typeof r.debtId === "string" && r.debtId) tx.debtId = r.debtId;
    if (Number.isFinite(Number(r.sortOrder))) tx.sortOrder = Math.round(Number(r.sortOrder));
    return tx;
  }

  function normalizeDebt(raw, uidFn) {
    const idFn = typeof uidFn === "function" ? uidFn : () => global.crypto.randomUUID();
    const r = raw && typeof raw === "object" ? raw : {};
    let balanceMinor = Number(r.balanceMinor);
    if (!Number.isFinite(balanceMinor)) balanceMinor = toMinor(r.balance);
    balanceMinor = Math.max(0, Math.round(balanceMinor));
    let kind = r.kind;
    if (kind !== "person" && kind !== "bank" && kind !== "card_loan") {
      kind = tierToKind(r.tier);
    }
    const debt = {
      id: typeof r.id === "string" && r.id ? r.id : idFn(),
      name: typeof r.name === "string" ? r.name.slice(0, 120) : "",
      kind,
      balanceMinor,
      currency: r.currency === "EUR" ? "EUR" : "GBP",
    };
    const rate = Number(r.ratePercent != null ? r.ratePercent : r.apr);
    if (Number.isFinite(rate) && rate >= 0) debt.ratePercent = rate;
    let planned = Number(r.plannedMonthlyMinor);
    if (!Number.isFinite(planned) && r.monthlyPayment != null) planned = toMinor(r.monthlyPayment);
    if (Number.isFinite(planned) && planned >= 0) debt.plannedMonthlyMinor = Math.round(planned);
    return debt;
  }

  /** Legacy loan (pounds) → Debt (minor units). Payments stay on the loan for M1 UI. */
  function debtFromLegacyLoan(loan, uidFn) {
    return normalizeDebt(
      {
        id: loan.id,
        name: loan.name,
        kind: tierToKind(loan.tier),
        balance: loan.balance,
        currency: loan.currency,
        ratePercent: loan.apr,
        monthlyPayment: loan.monthlyPayment,
      },
      uidFn
    );
  }

  /** Debt → legacy loan shape (pounds) for existing UI. Keeps payments if provided. */
  function legacyLoanFromDebt(debt, payments) {
    return {
      id: debt.id,
      name: debt.name || "",
      balance: fromMinor(debt.balanceMinor),
      apr: Number(debt.ratePercent) || 0,
      monthlyPayment: fromMinor(debt.plannedMonthlyMinor || 0),
      tier: kindToTier(debt.kind),
      currency: debt.currency === "EUR" ? "EUR" : "GBP",
      payments: Array.isArray(payments) ? payments : [],
    };
  }

  /**
   * Build Transaction[] from legacy planner fields (incomeItems, billItems, businessLog, loan payments).
   * Does not use monthLog snapshots (those are hand-entered monthly totals; reports will derive from txs).
   */
  function buildTransactionsFromLegacy(planner, uidFn) {
    const idFn = typeof uidFn === "function" ? uidFn : () => global.crypto.randomUUID();
    const txs = [];
    const now = isoNow();
    const fallbackDate = todayYmd();

    const incomeItems = Array.isArray(planner.incomeItems) ? planner.incomeItems : [];
    incomeItems.forEach((item) => {
      if (!item) return;
      const amount = Number(item.amount) || 0;
      if (amount <= 0) return;
      txs.push(
        normalizeTransaction(
          {
            id: item.id || idFn(),
            date: clampYmd(item.date, null) || `${fallbackDate.slice(0, 7)}-01`,
            type: "income",
            amountMinor: toMinor(amount),
            currency: "GBP",
            category: preferNamedCategory(guessIncomeCategory(item.name), item.name),
            scope: "personal",
            note: item.name || undefined,
            createdAt: now,
            updatedAt: now,
          },
          idFn
        )
      );
    });

    const billItems = Array.isArray(planner.billItems) ? planner.billItems : [];
    billItems.forEach((item) => {
      if (!item) return;
      const amount = Number(item.amount) || 0;
      if (amount <= 0) return;
      txs.push(
        normalizeTransaction(
          {
            id: item.id || idFn(),
            date: clampYmd(item.date, null) || `${fallbackDate.slice(0, 7)}-01`,
            type: "expense",
            amountMinor: toMinor(amount),
            currency: "GBP",
            category: preferNamedCategory(guessPersonalExpenseCategory(item.name), item.name),
            scope: "personal",
            note: item.name || undefined,
            createdAt: now,
            updatedAt: now,
          },
          idFn
        )
      );
    });

    const businessLog = Array.isArray(planner.businessLog) ? planner.businessLog : [];
    businessLog.forEach((entry) => {
      if (!entry) return;
      const date = dateFromBusinessEntry(entry, fallbackDate);
      const incomeItemsB = Array.isArray(entry.incomeItems) ? entry.incomeItems : [];
      const expenseItemsB = Array.isArray(entry.expenseItems) ? entry.expenseItems : [];
      const hasLines = incomeItemsB.length > 0 || expenseItemsB.length > 0;

      if (hasLines) {
        incomeItemsB.forEach((line) => {
          const amount = Number(line.amount) || 0;
          if (amount <= 0) return;
          txs.push(
            normalizeTransaction(
              {
                id: line.id || idFn(),
                date,
                type: "income",
                amountMinor: toMinor(amount),
                currency: "GBP",
                category: preferNamedCategory(
                  guessIncomeCategory(line.name),
                  line.name,
                  "Self-employed income"
                ),
                scope: "business",
                note: line.name || entry.label || undefined,
                createdAt: now,
                updatedAt: now,
              },
              idFn
            )
          );
        });
        expenseItemsB.forEach((line) => {
          const amount = Number(line.amount) || 0;
          if (amount <= 0) return;
          txs.push(
            normalizeTransaction(
              {
                id: line.id || idFn(),
                date,
                type: "expense",
                amountMinor: toMinor(amount),
                currency: "GBP",
                category: preferNamedCategory(guessBusinessExpenseCategory(line.name), line.name),
                scope: "business",
                note: line.name || entry.label || undefined,
                createdAt: now,
                updatedAt: now,
              },
              idFn
            )
          );
        });
        return;
      }

      const income = Math.max(0, Number(entry.income) || 0);
      const expenses = Math.max(0, Number(entry.expenses) || 0);
      if (income > 0) {
        txs.push(
          normalizeTransaction(
            {
              id: (entry.id || idFn()) + ":income",
              date,
              type: "income",
              amountMinor: toMinor(income),
              currency: "GBP",
              category: preferNamedCategory("Other", entry.label, "Business income"),
              scope: "business",
              note: entry.label || "Business income",
              createdAt: now,
              updatedAt: now,
            },
            idFn
          )
        );
      }
      if (expenses > 0) {
        txs.push(
          normalizeTransaction(
            {
              id: (entry.id || idFn()) + ":expense",
              date,
              type: "expense",
              amountMinor: toMinor(expenses),
              currency: "GBP",
              category: preferNamedCategory("Other", entry.label, "Business expenses"),
              scope: "business",
              note: entry.label || "Business expenses",
              createdAt: now,
              updatedAt: now,
            },
            idFn
          )
        );
      }
    });

    const loans = Array.isArray(planner.loans) ? planner.loans : [];
    loans.forEach((loan) => {
      if (!loan || !Array.isArray(loan.payments)) return;
      const currency = loan.currency === "EUR" ? "EUR" : "GBP";
      loan.payments.forEach((p) => {
        if (!p) return;
        const amount = Number(p.amount) || 0;
        if (amount <= 0) return;
        txs.push(
          normalizeTransaction(
            {
              id: p.id || idFn(),
              date: clampYmd(p.at, fallbackDate),
              type: "expense",
              amountMinor: toMinor(amount),
              currency,
              category: "Debt payment",
              scope: "personal",
              note: p.note || loan.name || undefined,
              debtId: loan.id,
              createdAt: now,
              updatedAt: now,
            },
            idFn
          )
        );
      });
    });

    // Personal monthly archives (monthLog) — keep history across months
    const monthLog = Array.isArray(planner.monthLog) ? planner.monthLog : [];
    monthLog.forEach((entry) => {
      if (!entry) return;
      const date = dateFromMonthLabel(entry.label, null);
      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
      const income = Math.max(0, Number(entry.income) || 0);
      const bills = Math.max(0, Number(entry.mustPayBills) || 0);
      const baseId = entry.id || idFn();
      if (income > 0) {
        txs.push(
          normalizeTransaction(
            {
              id: `monthlog:${baseId}:income`,
              date,
              type: "income",
              amountMinor: toMinor(income),
              currency: "GBP",
              category: preferNamedCategory("Other", entry.label, "Month archive"),
              scope: "personal",
              note: entry.label || "Month archive",
              createdAt: now,
              updatedAt: now,
            },
            idFn
          )
        );
      }
      if (bills > 0) {
        txs.push(
          normalizeTransaction(
            {
              id: `monthlog:${baseId}:expense`,
              date,
              type: "expense",
              amountMinor: toMinor(bills),
              currency: "GBP",
              category: preferNamedCategory("Other", entry.label, "Month archive"),
              scope: "personal",
              note: entry.label || "Month archive",
              createdAt: now,
              updatedAt: now,
            },
            idFn
          )
        );
      }
    });

    return txs;
  }

  function buildDebtsFromLegacyLoans(loans, uidFn) {
    if (!Array.isArray(loans)) return [];
    return loans.map((l) => debtFromLegacyLoan(l, uidFn));
  }

  /**
   * Ensure planner has schemaVersion 2, transactions (minor units), and debts.
   * Returns a new planner-shaped object; does not mutate the input.
   */
  function migratePlanner(planner, uidFn) {
    const p = planner && typeof planner === "object" ? planner : {};
    const version = Number(p.schemaVersion) || 1;
    let transactions;
    let debts;

    if (version >= 2 && Array.isArray(p.transactions) && p.transactions.length > 0) {
      transactions = p.transactions.map((t) => normalizeTransaction(t, uidFn));
    } else if (Array.isArray(p.transactions) && p.transactions.length > 0) {
      transactions = p.transactions.map((t) => normalizeTransaction(t, uidFn));
    } else {
      transactions = buildTransactionsFromLegacy(p, uidFn);
    }

    // Always merge monthLog archives (idempotent by id) so history isn't lost after v2 migrate
    const archiveTxs = buildTransactionsFromLegacy(
      { monthLog: p.monthLog, incomeItems: [], billItems: [], businessLog: [], loans: [] },
      uidFn
    );
    if (archiveTxs.length) {
      const have = new Set(transactions.map((t) => t.id));
      archiveTxs.forEach((t) => {
        if (!have.has(t.id)) transactions.push(t);
      });
    }

    // Re-date imported monthly totals / notes that encode a month label
    transactions = transactions.map((t) => {
      const fromNote = dateFromMonthLabel(t.note, null);
      if (
        fromNote &&
        /^\d{4}-\d{2}-\d{2}$/.test(fromNote) &&
        (t.category === "Imported monthly total" ||
          t.category === "Month archive" ||
          t.category === "Business income" ||
          t.category === "Business expenses" ||
          (t.note && t.note === t.category && dateFromMonthLabel(t.category, null))) &&
        t.date.slice(0, 7) !== fromNote.slice(0, 7)
      ) {
        return { ...t, date: fromNote };
      }
      return t;
    });

    transactions = repairPreservedNames(transactions);

    if (Array.isArray(p.debts) && p.debts.length > 0) {
      debts = p.debts.map((d) => normalizeDebt(d, uidFn));
    } else {
      debts = buildDebtsFromLegacyLoans(p.loans, uidFn);
    }

    return {
      ...p,
      schemaVersion: SCHEMA_VERSION,
      transactions,
      debts,
    };
  }

  /**
   * While the legacy UI still owns incomeItems / billItems / loans / businessLog,
   * rebuild the ledger from those fields so storage stays consistent.
   */
  function syncLedgerFromLegacyUi(stateLike, uidFn) {
    const transactions = buildTransactionsFromLegacy(
      {
        incomeItems: stateLike.incomeItems,
        billItems: stateLike.billItems,
        businessLog: stateLike.businessLog,
        loans: stateLike.loans,
      },
      uidFn
    );
    const debts = buildDebtsFromLegacyLoans(stateLike.loans, uidFn);
    return { transactions, debts };
  }

  function ymKey(ymd) {
    const s = String(ymd || "").slice(0, 7);
    return /^\d{4}-\d{2}$/.test(s) ? s : "";
  }

  /**
   * In-memory repository over a mutable state bag.
   * @param {{ getState: () => object, persist?: () => void }} opts
   */
  function createRepository(opts) {
    const getState = opts.getState;
    const persist = typeof opts.persist === "function" ? opts.persist : function () {};

    function txs() {
      const s = getState();
      if (!Array.isArray(s.transactions)) s.transactions = [];
      return s.transactions;
    }

    function debtsArr() {
      const s = getState();
      if (!Array.isArray(s.debts)) s.debts = [];
      return s.debts;
    }

    function matchesFilter(tx, filter) {
      if (!filter) return true;
      if (filter.month) {
        const m = ymKey(tx.date);
        if (m !== filter.month) return false;
      }
      if (filter.scope && tx.scope !== filter.scope) return false;
      if (filter.type && tx.type !== filter.type) return false;
      if (filter.category && tx.category !== filter.category) return false;
      if (filter.debtId && tx.debtId !== filter.debtId) return false;
      if (filter.missingReceipt) {
        if (tx.type !== "expense" || tx.scope !== "business") return false;
        if (tx.receiptId) return false;
      }
      if (filter.uncategorised) {
        if (tx.category && tx.category !== "Other" && tx.category !== "Imported monthly total") return false;
      }
      if (filter.search) {
        const q = String(filter.search).toLowerCase();
        const hay = `${tx.note || ""} ${tx.category || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    }

    return {
      getTransactions(filter) {
        return txs()
          .filter((t) => matchesFilter(t, filter))
          .slice()
          .sort((a, b) => {
            const ao = Number.isFinite(a.sortOrder) ? a.sortOrder : null;
            const bo = Number.isFinite(b.sortOrder) ? b.sortOrder : null;
            if (ao != null && bo != null && ao !== bo) return ao - bo;
            if (ao != null && bo == null) return -1;
            if (ao == null && bo != null) return 1;
            return String(b.date).localeCompare(String(a.date)) || String(a.id).localeCompare(String(b.id));
          });
      },

      getTransaction(id) {
        return txs().find((t) => t.id === id) || null;
      },

      saveTransaction(input) {
        const list = txs();
        const normalized = normalizeTransaction(input);
        normalized.updatedAt = isoNow();
        const idx = list.findIndex((t) => t.id === normalized.id);
        if (idx >= 0) {
          normalized.createdAt = list[idx].createdAt || normalized.createdAt;
          list[idx] = normalized;
        } else {
          if (!normalized.createdAt) normalized.createdAt = isoNow();
          list.push(normalized);
        }
        persist();
        return normalized;
      },

      deleteTransaction(id) {
        const list = txs();
        const idx = list.findIndex((t) => t.id === id);
        if (idx < 0) return null;
        const [removed] = list.splice(idx, 1);
        persist();
        return removed;
      },

      getDebts() {
        return debtsArr().slice();
      },

      getDebt(id) {
        return debtsArr().find((d) => d.id === id) || null;
      },

      saveDebt(input) {
        const list = debtsArr();
        const normalized = normalizeDebt(input);
        const idx = list.findIndex((d) => d.id === normalized.id);
        if (idx >= 0) list[idx] = normalized;
        else list.push(normalized);
        persist();
        return normalized;
      },

      deleteDebt(id) {
        const list = debtsArr();
        const idx = list.findIndex((d) => d.id === id);
        if (idx < 0) return null;
        const [removed] = list.splice(idx, 1);
        persist();
        return removed;
      },

      /** Sum income/expense/left for a yyyy-mm in minor units (optional scope). */
      sumMonth(monthYm, scope) {
        const list = this.getTransactions({ month: monthYm, scope });
        let incomeMinor = 0;
        let expenseMinor = 0;
        list.forEach((t) => {
          if (t.type === "income") incomeMinor += t.amountMinor;
          else expenseMinor += t.amountMinor;
        });
        return {
          incomeMinor,
          expenseMinor,
          leftMinor: incomeMinor - expenseMinor,
        };
      },

      replaceAllTransactions(next) {
        const s = getState();
        s.transactions = (Array.isArray(next) ? next : []).map((t) => normalizeTransaction(t));
        persist();
      },

      replaceAllDebts(next) {
        const s = getState();
        s.debts = (Array.isArray(next) ? next : []).map((d) => normalizeDebt(d));
        persist();
      },
    };
  }

  global.CalmPlanData = {
    SCHEMA_VERSION,
    CATEGORIES,
    toMinor,
    fromMinor,
    tierToKind,
    kindToTier,
    normalizeTransaction,
    normalizeDebt,
    debtFromLegacyLoan,
    legacyLoanFromDebt,
    buildTransactionsFromLegacy,
    buildDebtsFromLegacyLoans,
    migratePlanner,
    repairPreservedNames,
    syncLedgerFromLegacyUi,
    createRepository,
  };
})(typeof window !== "undefined" ? window : globalThis);
