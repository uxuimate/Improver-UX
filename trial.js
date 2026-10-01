(function () {
  "use strict";

  /** Sample data matching the Fudget September screenshot */
  let entries = [
    { id: "1", type: "income", name: "Salary", amount: 2356.26, date: "2023-09-01", starred: true, note: "" },
    { id: "2", type: "income", name: "Rental", amount: 566.79, date: "2022-09-06", starred: true, note: "" },
    { id: "3", type: "expense", name: "Rent", amount: 995.0, date: "2023-09-11", starred: true, note: "" },
    { id: "4", type: "expense", name: "Groceries", amount: 500.0, date: "2023-09-18", starred: true, note: "Walmart" },
    { id: "5", type: "expense", name: "Gas", amount: 200.0, date: "2022-09-21", starred: true, note: "" },
    { id: "6", type: "expense", name: "Phone", amount: 99.99, date: "2023-09-25", starred: true, note: "" },
    { id: "7", type: "expense", name: "Spending money", amount: 600.0, date: "2023-09-29", starred: true, note: "" },
  ];

  const listEl = document.getElementById("fudgetList");
  const balanceEl = document.getElementById("fudgetBalance");

  function uid() {
    return String(Date.now()) + Math.random().toString(16).slice(2);
  }

  function formatMoney(n) {
    return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function dateParts(ymd) {
    const d = new Date(ymd + "T12:00:00");
    const day = d.getDate();
    const mon = d.toLocaleDateString("en-GB", { month: "short" });
    return { dayMon: `${day} ${mon}`, year: String(d.getFullYear()) };
  }

  function balance() {
    return entries.reduce((s, e) => s + (e.type === "income" ? e.amount : -e.amount), 0);
  }

  function updateBalance() {
    const b = balance();
    const abs = Math.abs(b);
    balanceEl.textContent = `${b >= 0 ? "+" : "−"} $ ${formatMoney(abs)}`;
    balanceEl.classList.toggle("is-neg", b < 0);
  }

  function starSvg() {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5l2.9 5.88 6.49.94-4.7 4.58 1.11 6.47L12 17.77l-5.8 3.05 1.11-6.47-4.7-4.58 6.49-.94L12 2.5z"/></svg>`;
  }

  function pencilSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>`;
  }

  function menuSvg() {
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="5" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.4" fill="currentColor" stroke="none"/></svg>`;
  }

  function buildRow(entry) {
    const li = document.createElement("li");
    li.className = "fudget__row fudget__row--" + entry.type;
    li.dataset.id = entry.id;

    const nameCell = document.createElement("div");
    nameCell.className = "fudget__cell fudget__cell--name";
    const nameIn = document.createElement("input");
    nameIn.className = "fudget__name";
    nameIn.type = "text";
    nameIn.value = entry.name;
    nameIn.addEventListener("change", () => {
      entry.name = nameIn.value.trim() || entry.name;
      nameIn.value = entry.name;
    });
    nameCell.appendChild(nameIn);
    if (entry.note) {
      const note = document.createElement("p");
      note.className = "fudget__note";
      note.innerHTML = `${pencilSvg()}<span></span>`;
      note.querySelector("span").textContent = entry.note;
      nameCell.appendChild(note);
    }

    const amtCell = document.createElement("div");
    amtCell.className = "fudget__cell fudget__cell--amount";
    const amtIn = document.createElement("input");
    amtIn.className = "fudget__amount";
    amtIn.type = "text";
    amtIn.inputMode = "decimal";
    const sign = entry.type === "income" ? "+" : "−";
    amtIn.value = `${sign} $ ${formatMoney(entry.amount)}`;
    amtIn.addEventListener("focus", () => {
      amtIn.value = entry.amount.toFixed(2);
      amtIn.select();
    });
    amtIn.addEventListener("change", () => {
      const raw = String(amtIn.value).replace(/[^0-9.]/g, "");
      const n = Number(raw);
      if (!Number.isFinite(n) || n < 0) {
        amtIn.value = `${sign} $ ${formatMoney(entry.amount)}`;
        return;
      }
      entry.amount = Math.round(n * 100) / 100;
      amtIn.value = `${entry.type === "income" ? "+" : "−"} $ ${formatMoney(entry.amount)}`;
      updateBalance();
    });
    amtIn.addEventListener("blur", () => {
      amtIn.value = `${entry.type === "income" ? "+" : "−"} $ ${formatMoney(entry.amount)}`;
    });
    const star = document.createElement("button");
    star.type = "button";
    star.className = "fudget__star" + (entry.starred ? " is-on" : "");
    star.setAttribute("aria-label", entry.starred ? "Unstar" : "Star");
    star.innerHTML = starSvg();
    star.addEventListener("click", () => {
      entry.starred = !entry.starred;
      star.classList.toggle("is-on", entry.starred);
      star.setAttribute("aria-label", entry.starred ? "Unstar" : "Star");
    });
    amtCell.append(amtIn, star);

    const dateCell = document.createElement("div");
    dateCell.className = "fudget__cell fudget__cell--date";
    const parts = dateParts(entry.date);
    const dateBtn = document.createElement("button");
    dateBtn.type = "button";
    dateBtn.className = "fudget__date";
    dateBtn.innerHTML = `<span class="fudget__daymon"></span><span class="fudget__year"></span>`;
    dateBtn.querySelector(".fudget__daymon").textContent = parts.dayMon;
    dateBtn.querySelector(".fudget__year").textContent = parts.year;
    dateBtn.addEventListener("click", () => {
      const next = prompt("Date (YYYY-MM-DD)", entry.date);
      if (!next || !/^\d{4}-\d{2}-\d{2}$/.test(next)) return;
      entry.date = next;
      const p = dateParts(next);
      dateBtn.querySelector(".fudget__daymon").textContent = p.dayMon;
      dateBtn.querySelector(".fudget__year").textContent = p.year;
    });
    dateCell.appendChild(dateBtn);

    const menuCell = document.createElement("div");
    menuCell.className = "fudget__cell fudget__cell--menu";
    const menu = document.createElement("button");
    menu.type = "button";
    menu.className = "fudget__menu";
    menu.setAttribute("aria-label", "Row menu");
    menu.innerHTML = menuSvg();
    menu.addEventListener("click", () => {
      const action = prompt("Type delete to remove this row, or leave blank to cancel", "");
      if (String(action || "").trim().toLowerCase() !== "delete") return;
      entries = entries.filter((e) => e.id !== entry.id);
      render();
    });
    menuCell.appendChild(menu);

    li.append(nameCell, amtCell, dateCell, menuCell);
    return li;
  }

  function render() {
    listEl.replaceChildren();
    entries.forEach((e) => listEl.appendChild(buildRow(e)));
    updateBalance();
    bindReorder();
  }

  function bindReorder() {
    let dragRow = null;
    let pointerId = null;

    listEl.onpointerdown = (e) => {
      const row = e.target.closest(".fudget__row");
      if (!row || e.target.closest("input, button")) return;
      if (e.button !== 0 && e.pointerType === "mouse") return;
      dragRow = row;
      pointerId = e.pointerId;
      dragRow.classList.add("is-dragging");
      dragRow.setPointerCapture?.(e.pointerId);
      e.preventDefault();
    };

    listEl.onpointermove = (e) => {
      if (!dragRow || e.pointerId !== pointerId) return;
      const y = e.clientY;
      const rows = [...listEl.querySelectorAll(".fudget__row")].filter((r) => r !== dragRow);
      const target = rows.find((r) => {
        const rect = r.getBoundingClientRect();
        return y >= rect.top && y <= rect.bottom;
      });
      if (!target) return;
      const after = y > target.getBoundingClientRect().top + target.offsetHeight / 2;
      const ref = after ? target.nextElementSibling : target;
      if (ref !== dragRow) listEl.insertBefore(dragRow, ref);
    };

    const end = (e) => {
      if (!dragRow || e.pointerId !== pointerId) return;
      dragRow.classList.remove("is-dragging");
      const ids = [...listEl.querySelectorAll(".fudget__row")].map((r) => r.dataset.id);
      entries.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
      dragRow = null;
      pointerId = null;
    };

    listEl.onpointerup = end;
    listEl.onpointercancel = end;
  }

  document.getElementById("fudgetAddIncome").addEventListener("click", () => {
    entries.push({
      id: uid(),
      type: "income",
      name: "New income",
      amount: 0,
      date: "2023-09-01",
      starred: true,
      note: "",
    });
    render();
  });

  document.getElementById("fudgetAddExpense").addEventListener("click", () => {
    entries.push({
      id: uid(),
      type: "expense",
      name: "New expense",
      amount: 0,
      date: "2023-09-01",
      starred: true,
      note: "",
    });
    render();
  });

  document.getElementById("fudgetBack").addEventListener("click", () => {
    window.location.href = "index.html";
  });

  document.getElementById("fudgetMenu").addEventListener("click", () => {
    alert("Fudget menu (trial clone)");
  });

  render();
})();
