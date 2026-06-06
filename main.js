/**
 * Calendário de aniversários — dados em CSV (fetch estático, GitHub Pages).
 * Aniversários são tratados como recorrentes (mês/dia); o ano do CSV é só a data de nascimento/casamento.
 */

/** Versão do app — manter igual a version.json e index.html (?v=). */
const APP_VERSION = "1.3.0";

const VERSION_STORAGE_KEY = "firinfifim-app-version";
const VERSION_RELOAD_KEY = "firinfifim-version-reloading";

const CSV_FILENAME = "lista de aniversáriantes.csv";
const WEDDINGS_CSV_FILENAME = "lista de casamentos.csv";

const VIEW_MODES = /** @type {const} */ (["pessoa", "casamento", "todos"]);
const URL_PARAM = "parametro";

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

/** Fração da largura do carrossel para confirmar mudança de mês ao soltar. */
const CAROUSEL_THRESHOLD = 0.25;

/** Duração da transição visual ao virar o mês no carrossel (ms). */
const CAROUSEL_TURN_MS = 380;

/** @typedef {{ name: string, imageBase: string, birthYear: number, birthMonth: number, birthDay: number, marriageId?: number, deathYear?: number, deathMonth?: number, deathDay?: number }} Person */

/** @typedef {{ id: number, conjuges: string, weddingYear: number, weddingMonth: number, weddingDay: number, spouses: Person[], deathYear?: number, deathMonth?: number, deathDay?: number }} Wedding */

/** @typedef {{ type: "person", data: Person } | { type: "wedding", data: Wedding }} DayEvent */

/** @type {Map<string, Person[]>} chave "m-d" (mês 1-12, dia 1-31) */
const birthdaysByMd = new Map();

/** @type {Map<string, Wedding[]>} */
const weddingsByMd = new Map();

/** @type {Map<number, Person[]>} */
const spousesByMarriageId = new Map();

let dataLoaded = false;

/** @type {typeof VIEW_MODES[number]} */
let currentViewMode = "todos";

/** @type {HTMLButtonElement | null} */
let lastFocusedDayBtn = null;

/**
 * @returns {typeof VIEW_MODES[number]}
 */
function getViewMode() {
  const raw = new URLSearchParams(window.location.search).get(URL_PARAM);
  if (raw && VIEW_MODES.includes(/** @type {typeof VIEW_MODES[number]} */ (raw))) {
    return /** @type {typeof VIEW_MODES[number]} */ (raw);
  }
  return "todos";
}

/**
 * @param {typeof VIEW_MODES[number]} mode
 */
function setViewMode(mode) {
  const url = new URL(window.location.href);
  if (mode === "todos") {
    url.searchParams.delete(URL_PARAM);
  } else {
    url.searchParams.set(URL_PARAM, mode);
  }
  history.replaceState(null, "", url);
  currentViewMode = mode;
  syncViewFilterButtons();
  closeDayModal();
  render();
}

function syncViewFilterButtons() {
  const host = document.getElementById("view-filter");
  if (!host) return;
  for (const btn of host.querySelectorAll("[data-view]")) {
    if (!(btn instanceof HTMLButtonElement)) continue;
    const active = btn.dataset.view === currentViewMode;
    btn.classList.toggle("view-filter__btn--active", active);
    btn.setAttribute("aria-pressed", active ? "true" : "false");
  }
}

function wireViewFilter() {
  const host = document.getElementById("view-filter");
  host?.addEventListener("click", (ev) => {
    const btn = ev.target.closest("[data-view]");
    if (!(btn instanceof HTMLButtonElement)) return;
    const mode = btn.dataset.view;
    if (!mode || !VIEW_MODES.includes(/** @type {typeof VIEW_MODES[number]} */ (mode))) return;
    if (mode === currentViewMode) return;
    setViewMode(/** @type {typeof VIEW_MODES[number]} */ (mode));
  });

  window.addEventListener("popstate", () => {
    currentViewMode = getViewMode();
    syncViewFilterButtons();
    closeDayModal();
    render();
  });
}

/**
 * @param {string} line
 * @returns {{ name: string, dateRaw: string, marriageId?: number, imageBase: string, deathDateRaw: string } | null}
 */
function parseCsvRow(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(",").map((part) => part.trim());
  if (parts.length < 3) return null;

  let name;
  let dateRaw;
  let marriageIdRaw;
  let imageBase;
  let deathDateRaw = "";

  if (parts.length >= 5) {
    [name, dateRaw, marriageIdRaw, imageBase, deathDateRaw] = parts;
  } else if (parts.length >= 4) {
    [name, dateRaw, marriageIdRaw, imageBase] = parts;
  } else {
    [name, dateRaw, imageBase] = parts;
    marriageIdRaw = "";
  }

  if (!name || !dateRaw || !imageBase) return null;

  /** @type {number | undefined} */
  let marriageId;
  if (marriageIdRaw && /^\d+$/.test(marriageIdRaw)) {
    marriageId = Number(marriageIdRaw);
  }

  return { name, dateRaw, marriageId, imageBase, deathDateRaw };
}

/**
 * @param {string} line
 * @returns {{ id: number, conjuges: string, dateRaw: string, deathDateRaw: string } | null}
 */
function parseWeddingCsvRow(line) {
  const trimmed = line.trim();
  if (!trimmed) return null;
  const parts = trimmed.split(",").map((part) => part.trim());
  if (parts.length < 3) return null;

  const idRaw = parts[0];
  const conjuges = parts[1];
  const dateRaw = parts[2] ?? "";
  const deathDateRaw = parts[3] ?? "";
  if (!idRaw || !conjuges || !/^\d+$/.test(idRaw)) return null;
  return { id: Number(idRaw), conjuges, dateRaw, deathDateRaw };
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
  spousesByMarriageId.clear();
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV vazio ou sem linhas de dados.");

  for (let i = 1; i < lines.length; i++) {
    const row = parseCsvRow(lines[i]);
    if (!row) continue;
    const d = parseBrazilianDate(row.dateRaw);
    if (!d) continue;
    const key = `${d.month}-${d.day}`;

    /** @type {Partial<Pick<Person, "deathYear" | "deathMonth" | "deathDay">>} */
    const deathFields = {};
    if (row.deathDateRaw) {
      const death = parseBrazilianDate(row.deathDateRaw);
      if (death) {
        deathFields.deathYear = death.year;
        deathFields.deathMonth = death.month;
        deathFields.deathDay = death.day;
      }
    }

    const person = {
      name: row.name,
      imageBase: row.imageBase,
      birthYear: d.year,
      birthMonth: d.month,
      birthDay: d.day,
      marriageId: row.marriageId,
      ...deathFields,
    };
    const list = birthdaysByMd.get(key);
    if (list) list.push(person);
    else birthdaysByMd.set(key, [person]);

    if (row.marriageId) {
      const spouses = spousesByMarriageId.get(row.marriageId);
      if (spouses) spouses.push(person);
      else spousesByMarriageId.set(row.marriageId, [person]);
    }
  }

  for (const list of birthdaysByMd.values()) {
    list.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }

  if (birthdaysByMd.size === 0) {
    throw new Error("Nenhum aniversariante válido encontrado no CSV.");
  }
}

/**
 * @param {string} text
 */
function ingestWeddingsCsv(text) {
  weddingsByMd.clear();
  const lines = text.split(/\r?\n/);
  if (lines.length < 2) throw new Error("CSV de casamentos vazio ou sem linhas de dados.");

  for (let i = 1; i < lines.length; i++) {
    const row = parseWeddingCsvRow(lines[i]);
    if (!row) continue;
    if (!row.dateRaw) continue;
    const d = parseBrazilianDate(row.dateRaw);
    if (!d) continue;

    /** @type {Partial<Pick<Wedding, "deathYear" | "deathMonth" | "deathDay">>} */
    const deathFields = {};
    if (row.deathDateRaw) {
      const death = parseBrazilianDate(row.deathDateRaw);
      if (death) {
        deathFields.deathYear = death.year;
        deathFields.deathMonth = death.month;
        deathFields.deathDay = death.day;
      }
    }

    const spouses = [...(spousesByMarriageId.get(row.id) ?? [])];
    const wedding = {
      id: row.id,
      conjuges: row.conjuges,
      weddingYear: d.year,
      weddingMonth: d.month,
      weddingDay: d.day,
      spouses,
      ...deathFields,
    };

    const key = `${d.month}-${d.day}`;
    const list = weddingsByMd.get(key);
    if (list) list.push(wedding);
    else weddingsByMd.set(key, [wedding]);
  }

  for (const list of weddingsByMd.values()) {
    list.sort((a, b) => a.conjuges.localeCompare(b.conjuges, "pt-BR"));
  }
}

/**
 * @param {number} month
 * @param {number} day
 * @param {typeof VIEW_MODES[number]} mode
 * @returns {DayEvent[]}
 */
function getEventsForDay(month, day, mode) {
  const key = `${month}-${day}`;
  /** @type {DayEvent[]} */
  const events = [];

  if (mode === "pessoa" || mode === "todos") {
    for (const p of birthdaysByMd.get(key) ?? []) {
      events.push({ type: "person", data: p });
    }
  }

  if (mode === "casamento" || mode === "todos") {
    for (const w of weddingsByMd.get(key) ?? []) {
      events.push({ type: "wedding", data: w });
    }
  }

  return events;
}

/**
 * @param {DayEvent[]} events
 * @returns {string}
 */
function formatEventsAriaLabel(events) {
  if (events.length === 0) return "sem eventos";
  return events
    .map((ev) => (ev.type === "person" ? ev.data.name : coupleAriaLabel(ev.data)))
    .join(", ");
}

/**
 * @param {number} day
 * @param {number} month
 * @param {number} year
 * @param {Date} refDate
 * @returns {{ years: number, months: number, days: number }}
 */
function computeAgeDetail(day, month, year, refDate) {
  let years = refDate.getFullYear() - year;
  let months = refDate.getMonth() + 1 - month;
  let days = refDate.getDate() - day;

  if (days < 0) {
    months -= 1;
    const prevMonth = new Date(refDate.getFullYear(), refDate.getMonth(), 0);
    days += prevMonth.getDate();
  }

  if (months < 0) {
    years -= 1;
    months += 12;
  }

  if (years < 0) {
    return { years: 0, months: 0, days: 0 };
  }

  return { years, months, days };
}

/**
 * @param {number} day
 * @param {number} month 1–12
 * @param {number} year
 */
function formatDateNumeric(day, month, year) {
  const dd = String(day).padStart(2, "0");
  const mm = String(month).padStart(2, "0");
  return `${dd}/${mm}/${year}`;
}

/**
 * @param {Date} a
 * @param {Date} b
 */
function isSameCalendarDay(a, b) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/**
 * @param {Person} p
 * @returns {Date}
 */
function referenceDateForPerson(p) {
  if (p.deathYear != null && p.deathMonth != null && p.deathDay != null) {
    return new Date(p.deathYear, p.deathMonth - 1, p.deathDay);
  }
  return new Date();
}

/**
 * @param {Wedding} w
 * @returns {Date}
 */
function referenceDateForWedding(w) {
  if (w.deathYear != null && w.deathMonth != null && w.deathDay != null) {
    return new Date(w.deathYear, w.deathMonth - 1, w.deathDay);
  }

  const spouseDeaths = w.spouses
    .filter((s) => s.deathYear != null && s.deathMonth != null && s.deathDay != null)
    .map((s) => new Date(s.deathYear, s.deathMonth - 1, s.deathDay));

  if (spouseDeaths.length > 0) {
    return new Date(Math.max(...spouseDeaths.map((d) => d.getTime())));
  }

  return new Date();
}

/**
 * @param {number} day
 * @param {number} month 1–12
 * @param {number} year
 * @param {Date} refDate
 */
function formatCelebrationDateRange(day, month, year, refDate) {
  const from = formatDateNumeric(day, month, year);
  const to = formatDateNumeric(refDate.getDate(), refDate.getMonth() + 1, refDate.getFullYear());
  return `${from} à ${to}`;
}

/**
 * @param {number} years
 * @param {number} months
 * @param {number} days
 * @param {Date} refDate
 */
function formatAgeDetailText(years, months, days, refDate) {
  const yearWord = years === 1 ? "ano" : "anos";
  const monthWord = months === 1 ? "mês" : "meses";
  const dayWord = days === 1 ? "dia" : "dias";
  const detail = `${years} ${yearWord}, ${months} ${monthWord} e ${days} ${dayWord}`;

  if (isSameCalendarDay(refDate, new Date())) {
    return `Hoje faz ${detail}.`;
  }
  return `Fez ${detail}.`;
}

/**
 * @param {number} day
 * @param {number} month 1–12
 * @param {number} year
 * @param {number} years
 * @param {number} months
 * @param {number} days
 * @param {Date} refDate
 * @returns {HTMLElement}
 */
function createAgeToggle(day, month, year, years, months, days, refDate) {
  const wrap = document.createElement("div");
  wrap.className = "age-toggle";

  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "age-toggle__btn";
  btn.setAttribute("aria-label", "Ver datas da comemoração");

  const detail = document.createElement("span");
  detail.className = "age-toggle__detail";
  detail.textContent = formatAgeDetailText(years, months, days, refDate);

  const dateSpan = document.createElement("span");
  dateSpan.className = "age-toggle__date";
  dateSpan.textContent = formatCelebrationDateRange(day, month, year, refDate);

  const hint = document.createElement("span");
  hint.className = "age-toggle__hint";
  hint.textContent = "Toque para ver as datas";

  btn.appendChild(detail);
  btn.appendChild(dateSpan);
  wrap.appendChild(btn);
  wrap.appendChild(hint);

  btn.addEventListener("click", () => {
    const showingDate = wrap.classList.toggle("age-toggle--show-date");
    btn.setAttribute("aria-label", showingDate ? "Ver idade detalhada" : "Ver datas da comemoração");
  });

  return wrap;
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

/**
 * @param {string} imageBase
 * @param {string} alt
 * @param {string} className
 * @returns {HTMLImageElement}
 */
function createImage(imageBase, alt, className) {
  const img = document.createElement("img");
  img.className = className;
  img.src = imageUrl(imageBase);
  img.alt = alt;
  img.loading = "lazy";
  img.decoding = "async";
  img.addEventListener("error", () => {
    img.removeAttribute("src");
    img.style.display = "none";
  });
  return img;
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

function isNarrowCalendar() {
  return window.matchMedia("(max-width: 639px)").matches;
}

/**
 * Nome curto para a grade em telas estreitas; o nome completo fica no title e no modal.
 * @param {string} name
 */
function calendarDisplayName(name) {
  if (!isNarrowCalendar()) return name;
  return name.trim().split(/\s+/)[0] || name;
}

/**
 * @param {Wedding} w
 * @returns {[string, string]}
 */
function coupleNames(w) {
  if (w.spouses.length >= 2) {
    return [w.spouses[0].name, w.spouses[1].name];
  }
  const parts = w.conjuges.split(/\s+e\s+/i);
  if (parts.length === 2) {
    return [parts[0].trim(), parts[1].trim()];
  }
  return [w.conjuges, ""];
}

/**
 * @param {Wedding} w
 */
function coupleAriaLabel(w) {
  const [a, b] = coupleNames(w);
  return b ? `${a} e ${b}` : a;
}

/**
 * @param {"cal" | "modal"} size
 */
function createCoupleHeart(size) {
  const heart = document.createElement("span");
  heart.className = `couple-heart couple-heart--overlay couple-heart--${size}`;
  heart.setAttribute("aria-hidden", "true");
  heart.innerHTML =
    '<svg class="couple-heart__icon" viewBox="0 0 16 16" width="1em" height="1em" focusable="false"><path fill="currentColor" d="M8 14s-5.5-3.6-5.5-7.4C2.5 4.1 4.6 2.5 6.6 2.5c1.1 0 2.1.5 2.8 1.3.7-.8 1.7-1.3 2.8-1.3 2 0 4.1 1.6 4.1 4.1C16.5 10.4 8 14 8 14z"/></svg>';
  return heart;
}

/**
 * @param {HTMLElement} host
 * @param {Wedding} w
 * @param {{ short?: boolean }} [opts]
 */
function appendCoupleNames(host, w, opts = {}) {
  if (w.conjuges) {
    if (opts.short) {
      const parts = w.conjuges.split(/\s+e\s+/i);
      host.textContent =
        parts.length === 2
          ? `${calendarDisplayName(parts[0].trim())} e ${calendarDisplayName(parts[1].trim())}`
          : w.conjuges;
    } else {
      host.textContent = w.conjuges;
    }
    host.title = w.conjuges;
    return;
  }

  const [nameA, nameB] = coupleNames(w);
  const displayA = opts.short ? calendarDisplayName(nameA) : nameA;
  const displayB = nameB ? (opts.short ? calendarDisplayName(nameB) : nameB) : "";
  host.textContent = displayB ? `${displayA} e ${displayB}` : displayA;
  host.title = coupleAriaLabel(w);
}

/**
 * @param {Person} p
 * @returns {HTMLElement}
 */
function buildCalPersonRow(p) {
  const row = document.createElement("div");
  row.className = "cal-person";

  const img = createImage(p.imageBase, "", "cal-avatar");
  img.width = 26;
  img.height = 26;

  const span = document.createElement("span");
  span.className = "cal-name";
  span.textContent = calendarDisplayName(p.name);
  span.title = p.name;

  row.appendChild(img);
  row.appendChild(span);
  return row;
}

/**
 * @param {Wedding} w
 * @returns {HTMLElement}
 */
function buildCalWeddingRow(w) {
  const row = document.createElement("div");
  row.className = "cal-wedding";

  const avatars = document.createElement("div");
  avatars.className = "cal-wedding__avatars";

  for (const spouse of w.spouses) {
    const img = createImage(spouse.imageBase, "", "cal-avatar");
    img.width = 26;
    img.height = 26;
    avatars.appendChild(img);
  }

  if (w.spouses.length >= 2) {
    avatars.appendChild(createCoupleHeart("cal"));
  }

  const span = document.createElement("span");
  span.className = "cal-name cal-name--couple";
  appendCoupleNames(span, w, { short: isNarrowCalendar() });

  row.appendChild(avatars);
  row.appendChild(span);
  return row;
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

      const events = getEventsForDay(month, dayNum, currentViewMode);

      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "cal-day-btn";
      btn.dataset.year = String(year);
      btn.dataset.month = String(month);
      btn.dataset.day = String(dayNum);
      btn.setAttribute(
        "aria-label",
        `${dayNum} de ${MONTH_LABELS[month - 1]} de ${year}: ${formatEventsAriaLabel(events)}. Abrir detalhes`,
      );

      const card = document.createElement("div");
      card.className = "cal-card";
      if (events.length > 0) {
        card.classList.add("cal-card--busy");
        if (events.length > 1) card.classList.add("cal-card--busy-many");
      }
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

      for (const ev of events) {
        if (ev.type === "person") {
          namesEl.appendChild(buildCalPersonRow(ev.data));
        } else {
          namesEl.appendChild(buildCalWeddingRow(ev.data));
        }
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
  for (const list of weddingsByMd.values()) {
    for (const w of list) {
      minY = Math.min(minY, w.weddingYear);
      maxY = Math.max(maxY, w.weddingYear);
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
 * @param {Person} p
 * @returns {HTMLElement}
 */
function buildModalPersonCard(p) {
  const refDate = referenceDateForPerson(p);
  const article = document.createElement("article");
  article.className = "day-modal-person";

  const nameBar = document.createElement("div");
  nameBar.className = "day-modal-person__namebar";
  nameBar.textContent = p.name;

  const photoWrap = document.createElement("div");
  photoWrap.className = "day-modal-person__photo";

  const img = createImage(p.imageBase, `Foto de ${p.name}`, "day-modal-person__img");
  img.addEventListener("error", () => {
    img.remove();
    photoWrap.classList.add("day-modal-person__photo--missing");
  });

  photoWrap.appendChild(img);

  const age = computeAgeDetail(p.birthDay, p.birthMonth, p.birthYear, refDate);
  const ageToggle = createAgeToggle(
    p.birthDay,
    p.birthMonth,
    p.birthYear,
    age.years,
    age.months,
    age.days,
    refDate,
  );

  article.appendChild(nameBar);
  article.appendChild(photoWrap);
  article.appendChild(ageToggle);
  return article;
}

/**
 * @param {Wedding} w
 * @returns {HTMLElement}
 */
function buildModalWeddingCard(w) {
  const refDate = referenceDateForWedding(w);
  const article = document.createElement("article");
  article.className = "day-modal-wedding";

  const nameBar = document.createElement("div");
  nameBar.className = "day-modal-wedding__namebar day-modal-wedding__namebar--couple";
  appendCoupleNames(nameBar, w);

  const photoWrap = document.createElement("div");
  photoWrap.className = "day-modal-wedding__photos";

  if (w.spouses.length === 0) {
    photoWrap.classList.add("day-modal-wedding__photos--missing");
  } else {
    if (w.spouses.length >= 2) {
      photoWrap.classList.add("day-modal-wedding__photos--couple");
    }

    for (const spouse of w.spouses) {
      const spouseWrap = document.createElement("div");
      spouseWrap.className = "day-modal-wedding__photo";

      const img = createImage(spouse.imageBase, `Foto de ${spouse.name}`, "day-modal-wedding__img");
      img.addEventListener("error", () => {
        img.remove();
        spouseWrap.classList.add("day-modal-wedding__photo--missing");
      });

      spouseWrap.appendChild(img);
      photoWrap.appendChild(spouseWrap);
    }

    if (w.spouses.length >= 2) {
      photoWrap.appendChild(createCoupleHeart("modal"));
    }
  }

  const age = computeAgeDetail(w.weddingDay, w.weddingMonth, w.weddingYear, refDate);
  const ageToggle = createAgeToggle(
    w.weddingDay,
    w.weddingMonth,
    w.weddingYear,
    age.years,
    age.months,
    age.days,
    refDate,
  );

  article.appendChild(nameBar);
  article.appendChild(photoWrap);
  article.appendChild(ageToggle);
  return article;
}

/**
 * @param {typeof VIEW_MODES[number]} mode
 * @returns {string}
 */
function modalHeadingForMode(mode) {
  if (mode === "casamento") return "Bodas de casamento";
  if (mode === "todos") return "Aniversários";
  return "Aniversariantes";
}

/**
 * @param {typeof VIEW_MODES[number]} mode
 * @returns {string}
 */
function emptyMessageForMode(mode) {
  if (mode === "casamento") return "Nenhuma bodas neste dia.";
  if (mode === "todos") return "Nenhum evento neste dia.";
  return "Nenhum aniversariante neste dia.";
}

/**
 * @param {number} year
 * @param {number} month
 * @param {number} day
 */
function openDayModal(year, month, day) {
  const modal = document.getElementById("day-modal");
  const headingEl = document.getElementById("day-modal-heading");
  const dateEl = document.getElementById("day-modal-date");
  const gridEl = document.getElementById("day-modal-grid");
  const panel = modal?.querySelector(".day-modal__panel");
  if (!modal || !headingEl || !dateEl || !gridEl || !panel) return;

  const events = getEventsForDay(month, day, currentViewMode);

  headingEl.textContent = modalHeadingForMode(currentViewMode);
  dateEl.textContent = formatDateLong(day, month, year);

  gridEl.innerHTML = "";

  if (events.length === 0) {
    const empty = document.createElement("p");
    empty.className = "day-modal__empty";
    empty.textContent = emptyMessageForMode(currentViewMode);
    gridEl.appendChild(empty);
  } else {
    for (const ev of events) {
      if (ev.type === "person") {
        gridEl.appendChild(buildModalPersonCard(ev.data));
      } else {
        gridEl.appendChild(buildModalWeddingCard(ev.data));
      }
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
    if (carouselDidDrag) return;
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

/**
 * @param {number} year
 * @param {number} month 1–12
 * @returns {boolean}
 */
function setYearMonth(year, month) {
  const yearSel = document.getElementById("year");
  const monthSel = document.getElementById("month");
  if (!yearSel || !monthSel) return false;

  const yStr = String(year);
  if (![...yearSel.options].some((o) => o.value === yStr)) return false;

  yearSel.value = yStr;
  monthSel.value = String(month);
  return true;
}

/** @type {number | null} */
let carouselTurnTimer = null;

/**
 * @param {number} delta +1 próximo mês, −1 mês anterior
 * @param {{ animate?: boolean }} [opts]
 * @returns {boolean}
 */
function changeMonthByDelta(delta, opts = {}) {
  const yearSel = document.getElementById("year");
  const monthSel = document.getElementById("month");
  if (!yearSel || !monthSel) return false;

  let year = Number(yearSel.value);
  let month = Number(monthSel.value);

  month += delta;
  while (month > 12) {
    month -= 12;
    year += 1;
  }
  while (month < 1) {
    month += 12;
    year -= 1;
  }

  if (!setYearMonth(year, month)) return false;

  if (opts.animate) {
    renderWithMonthTurn();
  } else {
    render();
  }
  return true;
}

function renderWithMonthTurn() {
  const carousel = document.getElementById("calendar-carousel");
  const loading = document.getElementById("calendar-carousel-loading");
  const track = document.getElementById("calendar-carousel-track");
  const viewport = document.getElementById("calendar-carousel-viewport");
  if (!carousel || !loading || !track || !viewport) {
    render();
    return;
  }

  if (carouselTurnTimer !== null) {
    window.clearTimeout(carouselTurnTimer);
    carouselTurnTimer = null;
  }

  carousel.classList.add("calendar-carousel--turning");
  viewport.setAttribute("aria-busy", "true");
  loading.hidden = false;
  track.hidden = true;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const delay = prefersReducedMotion ? 120 : CAROUSEL_TURN_MS;

  carouselTurnTimer = window.setTimeout(() => {
    render();
    carousel.classList.remove("calendar-carousel--turning");
    viewport.removeAttribute("aria-busy");
    loading.hidden = true;
    track.hidden = false;
    carouselTurnTimer = null;
  }, delay);
}

function dismissCarouselHint() {
  document.getElementById("calendar-carousel")?.classList.add("calendar-carousel--hint-dismissed");
}

/** @type {boolean} */
let carouselDidDrag = false;

function wireCalendarCarousel() {
  const viewport = document.getElementById("calendar-carousel-viewport");
  const track = document.getElementById("calendar-carousel-track");
  if (!viewport || !track) return;

  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let currentX = 0;
  let dragging = false;
  let axisLocked = false;
  let isHorizontal = false;
  let didMoveHorizontally = false;

  const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  const setTranslate = (x, animate) => {
    track.classList.toggle("calendar-carousel__track--no-transition", !animate);
    track.style.transform = x === 0 ? "" : `translateX(${x}px)`;
  };

  const resetTrack = () => {
    dragging = false;
    axisLocked = false;
    isHorizontal = false;
    viewport.classList.remove("calendar-carousel__viewport--dragging");
    setTranslate(0, !prefersReducedMotion);
    if (didMoveHorizontally) {
      carouselDidDrag = true;
      window.setTimeout(() => {
        carouselDidDrag = false;
      }, 0);
    }
    didMoveHorizontally = false;
  };

  const applyDragDelta = (deltaX) => {
    const width = viewport.clientWidth || 1;
    const maxDrag = width * 0.45;
    const resisted = Math.sign(deltaX) * Math.min(Math.abs(deltaX), maxDrag);
    setTranslate(resisted, false);
    return resisted;
  };

  /** @param {number} deltaX deslocamento horizontal acumulado */
  const commitIfPastThreshold = (deltaX) => {
    const width = viewport.clientWidth || 1;
    const threshold = width * CAROUSEL_THRESHOLD;

    if (deltaX <= -threshold) {
      if (changeMonthByDelta(1, { animate: true })) dismissCarouselHint();
      return true;
    }
    if (deltaX >= threshold) {
      if (changeMonthByDelta(-1, { animate: true })) dismissCarouselHint();
      return true;
    }
    return false;
  };

  viewport.addEventListener("pointerdown", (ev) => {
    if (ev.button !== 0) return;
    pointerId = ev.pointerId;
    startX = ev.clientX;
    startY = ev.clientY;
    currentX = 0;
    dragging = true;
    axisLocked = false;
    isHorizontal = false;
    didMoveHorizontally = false;
    track.classList.add("calendar-carousel__track--no-transition");
  });

  viewport.addEventListener("pointermove", (ev) => {
    if (!dragging || ev.pointerId !== pointerId) return;

    const deltaX = ev.clientX - startX;
    const deltaY = ev.clientY - startY;

    if (!axisLocked) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return;
      axisLocked = true;
      isHorizontal = Math.abs(deltaX) >= Math.abs(deltaY);
      if (!isHorizontal) {
        dragging = false;
        resetTrack();
        return;
      }
      if (!viewport.hasPointerCapture(ev.pointerId)) {
        viewport.setPointerCapture(ev.pointerId);
      }
      viewport.classList.add("calendar-carousel__viewport--dragging");
    }

    if (!isHorizontal) return;

    ev.preventDefault();
    if (Math.abs(deltaX) > 8) didMoveHorizontally = true;
    currentX = applyDragDelta(deltaX);
  });

  const finishPointer = (ev) => {
    if (!dragging || ev.pointerId !== pointerId) return;
    if (viewport.hasPointerCapture(ev.pointerId)) {
      viewport.releasePointerCapture(ev.pointerId);
    }
    pointerId = null;

    if (isHorizontal) {
      commitIfPastThreshold(currentX);
    }
    resetTrack();
  };

  viewport.addEventListener("pointerup", finishPointer);
  viewport.addEventListener("pointercancel", finishPointer);

  let wheelAccum = 0;
  let wheelTimer = 0;

  viewport.addEventListener(
    "wheel",
    (ev) => {
      if (Math.abs(ev.deltaX) <= Math.abs(ev.deltaY)) return;
      ev.preventDefault();

      wheelAccum += ev.deltaX;
      applyDragDelta(-wheelAccum);

      window.clearTimeout(wheelTimer);
      wheelTimer = window.setTimeout(() => {
        commitIfPastThreshold(-wheelAccum);
        wheelAccum = 0;
        resetTrack();
      }, 120);
    },
    { passive: false },
  );
}

function renderStatus(month, year) {
  const statusEl = document.getElementById("status");
  if (!statusEl || !dataLoaded) return;

  const peopleCount = [...birthdaysByMd.values()].reduce((n, arr) => n + arr.length, 0);
  const weddingCount = [...weddingsByMd.values()].reduce((n, arr) => n + arr.length, 0);
  const monthLabel = `${MONTH_LABELS[month - 1]} de ${year}`;

  if (currentViewMode === "pessoa") {
    statusEl.textContent = `${peopleCount} pessoas no cadastro · ${monthLabel}`;
  } else if (currentViewMode === "casamento") {
    statusEl.textContent = `${weddingCount} casamentos no cadastro · ${monthLabel}`;
  } else {
    statusEl.textContent = `${peopleCount} pessoas e ${weddingCount} casamentos no cadastro · ${monthLabel}`;
  }
}

function render() {
  const yearSel = document.getElementById("year");
  const monthSel = document.getElementById("month");
  const calendarGrid = document.getElementById("calendar-grid");

  const year = Number(yearSel?.value);
  const month = Number(monthSel?.value);

  if (calendarGrid) {
    calendarGrid.innerHTML = "";
    calendarGrid.appendChild(buildCalendarGrid(year, month));
  }

  renderStatus(month, year);
}

async function enforceAppVersion() {
  /** @type {string} */
  let remoteVersion = APP_VERSION;

  try {
    const res = await fetch(`./version.json?_=${Date.now()}`, { cache: "no-store" });
    if (res.ok) {
      const data = await res.json();
      if (data && typeof data.version === "string" && data.version.trim()) {
        remoteVersion = data.version.trim();
      }
    }
  } catch {
    /* offline ou version.json ausente */
  }

  if (remoteVersion === APP_VERSION) {
    localStorage.setItem(VERSION_STORAGE_KEY, remoteVersion);
    sessionStorage.removeItem(VERSION_RELOAD_KEY);
    return;
  }

  if (sessionStorage.getItem(VERSION_RELOAD_KEY) === remoteVersion) {
    return;
  }

  localStorage.setItem(VERSION_STORAGE_KEY, remoteVersion);
  sessionStorage.setItem(VERSION_RELOAD_KEY, remoteVersion);

  if ("caches" in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch {
      /* ignore */
    }
  }

  const url = new URL(window.location.href);
  url.searchParams.set("_v", remoteVersion);
  window.location.replace(url.toString());
}

async function init() {
  fillWeekdayHeader();
  currentViewMode = getViewMode();
  wireViewFilter();
  syncViewFilterButtons();

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
  wireCalendarCarousel();

  const peopleUrl = new URL(CSV_FILENAME, window.location.href).href;
  const weddingsUrl = new URL(WEDDINGS_CSV_FILENAME, window.location.href).href;

  try {
    const [peopleRes, weddingsRes] = await Promise.all([
      fetch(peopleUrl, { cache: "no-cache" }),
      fetch(weddingsUrl, { cache: "no-cache" }),
    ]);

    if (!peopleRes.ok) {
      throw new Error(
        `Não foi possível carregar o CSV de aniversariantes (${peopleRes.status}). Verifique se o arquivo está no repositório.`,
      );
    }
    if (!weddingsRes.ok) {
      throw new Error(
        `Não foi possível carregar o CSV de casamentos (${weddingsRes.status}). Verifique se o arquivo está no repositório.`,
      );
    }

    const [peopleText, weddingsText] = await Promise.all([peopleRes.text(), weddingsRes.text()]);
    ingestCsv(peopleText);
    ingestWeddingsCsv(weddingsText);
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
    window.matchMedia("(max-width: 639px)").addEventListener("change", render);
    render();
  } catch (e) {
    const message = e instanceof Error ? e.message : "Erro ao carregar dados.";
    showError(message);
  }
}

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") {
    enforceAppVersion();
  }
});

enforceAppVersion().then(init);
