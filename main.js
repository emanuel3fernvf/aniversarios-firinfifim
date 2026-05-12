/**
 * Calendário de aniversários — dados em lista de aniversáriantes.csv (fetch estático, GitHub Pages).
 * Aniversários são tratados como recorrentes (mês/dia); o ano do CSV é só a data de nascimento.
 */

const CSV_FILENAME = "lista de aniversáriantes.csv";

const MONTH_LABELS = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

/** Abreviações como no calendário de referência (DOM, SEG, …). */
const WEEKDAY_LABELS = ["DOM", "SEG", "TER", "QUA", "QUI", "SEX", "SAB"];

/** @typedef {{ name: string, imageBase: string, birthYear: number }} Person */

/** @type {Map<string, Person[]>} chave "m-d" (mês 1-12, dia 1-31) */
const birthdaysByMd = new Map();

let dataLoaded = false;

/** @type {HTMLButtonElement | null} */
let lastFocusedDayBtn = null;

/**
 * @param {string} line
 * @returns {{ name: string, dateRaw: string, imageBase: string } | null}
 */
function parseCsvRow(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const lastComma = trimmed.lastIndexOf(",");
  if (lastComma === -1) return null;
  const imageBase = trimmed.slice(lastComma + 1).trim();
  const rest = trimmed.slice(0, lastComma);
  const secondComma = rest.lastIndexOf(",");
  if (secondComma === -1) return null;
  const name = rest.slice(0, secondComma).trim();
  const dateRaw = rest.slice(secondComma + 1).trim();
  if (!name || !dateRaw || !imageBase) return null;
  return { name, dateRaw, imageBase };
}

/**
 * @param {string} raw ex.: "09 / 04 / 1923"
 * @returns {{ day: number, month: number, year: number } | null}
 */
function parseBrazilianDate(raw) {
  const m = raw.replace(/\s+/g, " ").match(/^(\d{1,2})\s*\/\s*(\d{1,2})\s*\/\s*(\d{4})$/);
  if (!m) return null;
  const day = Number(m[1]);
  const month = Number(m[2]);
  const year = Number(m[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 1) return null;
  return { day, month, year };
}

/**
 * @param {string} text
 */
function ingestCsv(text) {
  birthdaysByMd.clear();
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV vazio ou sem linhas de dados.");

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvRow(lines[i]);
    if (!row) continue;
    const d = parseBrazilianDate(row.dateRaw);
    if (!d) continue;
    const key = `${d.month}-${d.day}`;
    const person = {
      name: row.name,
      imageBase: row.imageBase,
      birthYear: d.year,
    };
    const list = birthdaysByMd.get(key);
    if (list) list.push(person);
    else birthdaysByMd.set(key, [person]);
  }

  for (const list of birthdaysByMd.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  if (birthdaysByMd.size === 0) {
    throw new Error("Nenhum aniversariante válido encontrado no CSV.");
  }
}

/**
 * Monta URL em `resources/` a partir da coluna "imagens" do CSV.
 * Aceita `image001` ou `image001.jpg` (e outras extensões comuns).
 */
function imageUrl(imageBase) {
  const safe = String(imageBase).trim().replace(/[^a-zA-Z0-9_.-]/g, "");
  if (!safe) return "";
  if (/\.(jpe?g|png|webp|gif)$/i.test(safe)) {
    return `./resources/${safe}`;
  }
  return `./resources/${safe}.jpg`;
}

function currentYearMonth() {
  const now = new Date();
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

/**
 * @param {number} day
 * @param {number} month 1–12
 * @param {number} year
 */
function formatDateLong(day, month, year) {
  return `${day} de ${MONTH_LABELS[month - 1]} de ${year}`;
}

function fillWeekdayHeader() {
  const host = document.getElementById("cal-weekdays");
  if (!host || host.childElementCount > 0) return;
  for (const label of WEEKDAY_LABELS) {
    const el = document.createElement("div");
    el.className = "cal-weekday";
    el.textContent = label;
    el.setAttribute("role", "columnheader");
    host.appendChild(el);
  }
}

/**
 * Apenas a grade de dias (a barra DOM–SAB fica fora, em #cal-weekdays).
 * @param {number} year
 * @param {number} month 1-12
 */
function buildCalendarGrid(year, month) {
  const first = new Date(year, month - 1, 1);
  const startWeekday = first.getDay();
  const daysInMonth = new Date(year, month, 0).getDate();
  const today = new Date();
  const isThisMonth =
    today.getFullYear() === year && today.getMonth() + 1 === month;

  const frag = document.createDocumentFragment();

  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startWeekday + 1;
    const cell = document.createElement("div");
    cell.className = "cal-cell";
    cell.setAttribute("role", "gridcell");

    if (dayNum < 1 || dayNum > daysInMonth) {
      cell.classList.add("cal-cell--empty");
      cell.setAttribute("aria-hidden", "true");
    } else {
      cell.classList.add("cal-cell--day");

      const key = `${month}-${dayNum}`;
      const people = birthdaysByMd.get(key) ?? [];

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day-btn";
      btn.dataset.year = String(year);
      btn.dataset.month = String(month);
      btn.dataset.day = String(dayNum);
      btn.setAttribute(
        "aria-label",
        `${dayNum} de ${MONTH_LABELS[month - 1]} de ${year}${
          people.length ? `: ${people.map((x) => x.name).join(", ")}` : ": sem aniversariantes"
        }. Abrir detalhes`,
      );

      const card = document.createElement("div");
      card.className = "cal-card";
      if (isThisMonth && today.getDate() === dayNum) {
        card.classList.add("cal-card--today");
      }

      const dayBar = document.createElement("div");
      dayBar.className = "cal-daynum-bar";
      const numEl = document.createElement("span");
      numEl.className = "cal-daynum";
      numEl.textContent = String(dayNum);
      dayBar.appendChild(numEl);
      card.appendChild(dayBar);

      const body = document.createElement("div");
      body.className = "cal-cell-body";

      const namesEl = document.createElement("div");
      namesEl.className = "cal-names";

      for (const p of people) {
        const row = document.createElement("div");
        row.className = "cal-person";

        const img = document.createElement("img");
        img.className = "cal-avatar";
        img.src = imageUrl(p.imageBase);
        img.alt = "";
        img.width = 26;
        img.height = 26;
        img.loading = "lazy";
        img.decoding = "async";
        img.addEventListener("error", () => {
          img.removeAttribute("src");
          img.style.display = "none";
        });

        const span = document.createElement("span");
        span.className = "cal-name";
        span.textContent = p.name;

        row.appendChild(img);
        row.appendChild(span);
        namesEl.appendChild(row);
      }

      body.appendChild(namesEl);
      card.appendChild(body);
      btn.appendChild(card);
      cell.appendChild(btn);
    }
    frag.appendChild(cell);
  }

  return frag;
}

function getYearBoundsFromData() {
  let minY = Infinity;
  let maxY = -Infinity;
  for (const list of birthdaysByMd.values()) {
    for (const p of list) {
      minY = Math.min(minY, p.birthYear);
      maxY = Math.max(maxY, p.birthYear);
    }
  }
  const current = new Date().getFullYear();
  if (!Number.isFinite(minY)) minY = current - 100;
  if (!Number.isFinite(maxY)) maxY = current;
  return { minY, maxY, current };
}

function populateYearSelect(selectEl) {
  const { minY, maxY, current } = getYearBoundsFromData();
  const start = Math.min(minY, current - 5);
  const end = Math.max(maxY, current + 1);
  selectEl.innerHTML = "";
  for (let y = start; y <= end; y++) {
    const opt = document.createElement("option");
    opt.value = String(y);
    opt.textContent = String(y);
    selectEl.appendChild(opt);
  }
}

function populateMonthSelect(selectEl) {
  selectEl.innerHTML = "";
  MONTH_LABELS.forEach((label, idx) => {
    const opt = document.createElement("option");
    opt.value = String(idx + 1);
    opt.textContent = label;
    selectEl.appendChild(opt);
  });
}

/**
 * @param {number} year
 * @param {number} month
 * @param {number} day
 */
function openDayModal(year, month, day) {
  const modal = document.getElementById("day-modal");
  const dateEl = document.getElementById("day-modal-date");
  const gridEl = document.getElementById("day-modal-grid");
  const panel = modal?.querySelector(".day-modal__panel");
  if (!modal || !dateEl || !gridEl || !panel) return;

  const people = birthdaysByMd.get(`${month}-${day}`) ?? [];
  dateEl.textContent = formatDateLong(day, month, year);

  gridEl.innerHTML = "";

  if (people.length === 0) {
    const empty = document.createElement("p");
    empty.className = "day-modal__empty";
    empty.textContent = "Nenhum aniversariante neste dia.";
    gridEl.appendChild(empty);
  } else {
    for (const p of people) {
      const article = document.createElement("article");
      article.className = "day-modal-person";

      const nameBar = document.createElement("div");
      nameBar.className = "day-modal-person__namebar";
      nameBar.textContent = p.name;

      const photoWrap = document.createElement("div");
      photoWrap.className = "day-modal-person__photo";

      const img = document.createElement("img");
      img.className = "day-modal-person__img";
      img.src = imageUrl(p.imageBase);
      img.alt = `Foto de ${p.name}`;
      img.loading = "lazy";
      img.decoding = "async";
      img.addEventListener("error", () => {
        img.remove();
        photoWrap.classList.add("day-modal-person__photo--missing");
      });

      photoWrap.appendChild(img);
      article.appendChild(nameBar);
      article.appendChild(photoWrap);
      gridEl.appendChild(article);
    }
  }

  modal.hidden = false;
  document.body.classList.add("modal-open");
  const closeEl = modal.querySelector(".day-modal__close");
  /** @type {HTMLElement} */ (closeEl instanceof HTMLElement ? closeEl : panel).focus();

  /** @param {KeyboardEvent} ev */
  const onKey = (ev) => {
    if (ev.key === "Escape") closeDayModal();
  };
  document.addEventListener("keydown", onKey);
  /** @type {Window & { __dayModalKey?: (ev: KeyboardEvent) => void }} */ (window).__dayModalKey = onKey;
}

function closeDayModal() {
  const modal = document.getElementById("day-modal");
  if (!modal || modal.hidden) return;

  modal.hidden = true;
  document.body.classList.remove("modal-open");

  const onKey = /** @type {Window & { __dayModalKey?: (ev: KeyboardEvent) => void }} */ (window).__dayModalKey;
  if (onKey) {
    document.removeEventListener("keydown", onKey);
    delete window.__dayModalKey;
  }

  if (lastFocusedDayBtn && document.body.contains(lastFocusedDayBtn)) {
    lastFocusedDayBtn.focus();
  }
  lastFocusedDayBtn = null;
}

function wireDayModal() {
  const modal = document.getElementById("day-modal");
  const backdrop = modal?.querySelector(".day-modal__backdrop");
  const closeBtn = modal?.querySelector(".day-modal__close");
  const gridHost = document.getElementById("calendar-grid");

  backdrop?.addEventListener("click", closeDayModal);
  closeBtn?.addEventListener("click", closeDayModal);

  gridHost?.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".cal-day-btn");
    if (!(btn instanceof HTMLButtonElement)) return;
    const y = Number(btn.dataset.year);
    const m = Number(btn.dataset.month);
    const d = Number(btn.dataset.day);
    if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return;
    lastFocusedDayBtn = btn;
    openDayModal(y, m, d);
  });
}

function render() {
  const yearSel = document.getElementById("year");
  const monthSel = document.getElementById("month");
  const calendarGrid = document.getElementById("calendar-grid");
  const statusEl = document.getElementById("status");

  const year = Number(yearSel?.value);
  const month = Number(monthSel?.value);

  if (calendarGrid) {
    calendarGrid.innerHTML = "";
    calendarGrid.appendChild(buildCalendarGrid(year, month));
  }

  if (statusEl && dataLoaded) {
    const count = [...birthdaysByMd.values()].reduce((n, arr) => n + arr.length, 0);
    statusEl.textContent = `${count} pessoas no cadastro · ${MONTH_LABELS[month - 1]} de ${year}`;
  }
}

async function init() {
  fillWeekdayHeader();

  const yearSel = /** @type {HTMLSelectElement} */ (document.getElementById("year"));
  const monthSel = /** @type {HTMLSelectElement} */ (document.getElementById("month"));
  const errorEl = document.getElementById("error");
  const statusEl = document.getElementById("status");

  const showError = (msg) => {
    if (errorEl) {
      errorEl.hidden = false;
      errorEl.textContent = msg;
    }
    if (statusEl) statusEl.textContent = "";
  };

  wireDayModal();

  const csvUrl = new URL(CSV_FILENAME, window.location.href).href;

  try {
    const res = await fetch(csvUrl, { cache: "no-cache" });
    if (!res.ok) {
      throw new Error(`Não foi possível carregar o CSV (${res.status}). Verifique se o arquivo está no repositório e o caminho está correto.`);
    }
    const text = await res.text();
    ingestCsv(text);
    dataLoaded = true;

    populateYearSelect(yearSel);
    populateMonthSelect(monthSel);

    const { year: yNow, month: mNow } = currentYearMonth();
    if ([...yearSel.options].some((o) => o.value === String(yNow))) {
      yearSel.value = String(yNow);
    } else {
      yearSel.value = yearSel.options[yearSel.options.length - 1]?.value ?? String(yNow);
    }
    monthSel.value = String(mNow);

    if (errorEl) {
      errorEl.hidden = true;
      errorEl.textContent = "";
    }

    yearSel.addEventListener("change", render);
    monthSel.addEventListener("change", render);
    render();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao carregar dados.";
    showError(message);
  }
}

init();
