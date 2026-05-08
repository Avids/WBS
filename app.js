const STORAGE_KEY = "constructionWbsAppData_v1";

const state = {
  project: { name: "", code: "", laborRate: 0, contractValue: 0 },
  items: [],
  weeklyUpdates: [],
  selectedItemId: null,
  fileHandle: null
};

function uid(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function fmtCurrency(value) {
  return `$${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
}

function fmtNumber(value) {
  return Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

function fmtPct(value) {
  return `${Number(value || 0).toFixed(2)}%`;
}

function getProjectLaborRate() {
  return Number(state.project.laborRate || 0);
}

function getProjectContractValue() {
  return Number(state.project.contractValue || 0);
}

function getWbsSegments(code) {
  return String(code || "")
    .split(".")
    .map((part) => Number(part))
    .filter((num) => Number.isFinite(num));
}

function compareWbsCodes(a, b) {
  const segA = getWbsSegments(a);
  const segB = getWbsSegments(b);
  const maxLen = Math.max(segA.length, segB.length);
  for (let i = 0; i < maxLen; i += 1) {
    const valA = segA[i];
    const valB = segB[i];
    if (valA === undefined && valB !== undefined) return -1;
    if (valA !== undefined && valB === undefined) return 1;
    if (valA !== valB) return valA - valB;
  }
  return String(a || "").localeCompare(String(b || ""));
}

function sortItemsInState() {
  state.items.sort((x, y) => compareWbsCodes(x.code, y.code));
}

function getSortedItems() {
  return [...state.items].sort((x, y) => compareWbsCodes(x.code, y.code));
}

function getMaxTopLevelCode() {
  const topCodes = state.items
    .map((item) => getWbsSegments(item.code))
    .filter((segs) => segs.length > 0)
    .map((segs) => segs[0]);
  return topCodes.length ? Math.max(...topCodes) : 0;
}

function getNextSiblingCode(referenceCode) {
  const segments = getWbsSegments(referenceCode);
  if (!segments.length) return String(getMaxTopLevelCode() + 1);
  const parentPrefix = segments.slice(0, -1);
  const nextLast = segments[segments.length - 1] + 1;
  return [...parentPrefix, nextLast].join(".");
}

function buildAutoWbsCode() {
  if (state.selectedItemId) {
    const selected = state.items.find((x) => x.id === state.selectedItemId);
    if (selected?.code) return getNextSiblingCode(selected.code);
  }
  return String(getMaxTopLevelCode() + 1 || 1);
}

function normalizeParsedData(parsed) {
  const inferredLaborRate = Number(
    parsed?.project?.laborRate ||
      (parsed?.items || []).find((x) => Number(x.laborRate || 0) > 0)?.laborRate ||
      0
  );
  return {
    project: {
      name: parsed?.project?.name || "",
      code: parsed?.project?.code || "",
      laborRate: inferredLaborRate,
      contractValue: Number(parsed?.project?.contractValue || 0)
    },
    items: (parsed?.items || []).map((item) => ({
      id: item.id || uid("item"),
      code: item.code || "",
      name: item.name || "",
      materialBudget: Number(item.materialBudget || 0),
      laborHoursBudget: Number(item.laborHoursBudget || 0),
      notes: item.notes || ""
    })),
    weeklyUpdates: (parsed?.weeklyUpdates || []).map((u) => ({
      id: u.id || uid("weekly"),
      weekEnding: u.weekEnding || "",
      itemId: u.itemId || "",
      weeklyProgressPct: Number(u.weeklyProgressPct || 0),
      actualMaterialCost: Number(u.actualMaterialCost || 0),
      actualLaborHours: Number(u.actualLaborHours || 0),
      notes: u.notes || ""
    }))
  };
}

function loadState() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return;
  try {
    const normalized = normalizeParsedData(JSON.parse(raw));
    state.project = normalized.project;
    state.items = normalized.items;
    state.weeklyUpdates = normalized.weeklyUpdates;
    sortItemsInState();
  } catch (err) {
    console.error("Could not load saved data", err);
  }
}

function saveState() {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      project: state.project,
      items: state.items,
      weeklyUpdates: state.weeklyUpdates
    })
  );
}

function getProjectFileJson() {
  return JSON.stringify(
    {
      app: "construction-wbs-app",
      version: 2,
      project: state.project,
      items: state.items,
      weeklyUpdates: state.weeklyUpdates
    },
    null,
    2
  );
}

function getItemBudget(item) {
  const material = Number(item.materialBudget || 0);
  const laborHours = Number(item.laborHoursBudget || 0);
  const laborRate = getProjectLaborRate();
  const laborCost = laborHours * laborRate;
  return { material, laborHours, laborRate, laborCost, total: material + laborCost };
}

function getItemProgressAndActuals(itemId) {
  const item = state.items.find((x) => x.id === itemId);
  if (!item) {
    return {
      progressPct: 0,
      actualMaterial: 0,
      actualLaborHours: 0,
      actualLaborCost: 0,
      actualTotal: 0,
      earnedValue: 0,
      costVariance: 0,
      productivityIndex: 0
    };
  }
  const budget = getItemBudget(item);
  const updates = state.weeklyUpdates.filter((u) => u.itemId === itemId);
  const progressPct = Math.min(100, updates.reduce((sum, u) => sum + Number(u.weeklyProgressPct || 0), 0));
  const actualMaterial = updates.reduce((sum, u) => sum + Number(u.actualMaterialCost || 0), 0);
  const actualLaborHours = updates.reduce((sum, u) => sum + Number(u.actualLaborHours || 0), 0);
  const actualLaborCost = actualLaborHours * budget.laborRate;
  const actualTotal = actualMaterial + actualLaborCost;
  const earnedValue = budget.total * (progressPct / 100);
  const costVariance = earnedValue - actualTotal;
  const plannedProductivity = budget.laborHours > 0 ? budget.total / budget.laborHours : 0;
  const actualProductivity = actualLaborHours > 0 ? earnedValue / actualLaborHours : 0;
  const productivityIndex = plannedProductivity > 0 ? actualProductivity / plannedProductivity : 0;
  return {
    progressPct,
    actualMaterial,
    actualLaborHours,
    actualLaborCost,
    actualTotal,
    earnedValue,
    costVariance,
    productivityIndex
  };
}

function getProjectSummary() {
  let budgetMaterial = 0;
  let budgetLaborHours = 0;
  let budgetLaborCost = 0;
  let budgetTotal = 0;
  let actualMaterial = 0;
  let actualLaborHours = 0;
  let actualLaborCost = 0;
  let actualTotal = 0;
  let earnedValue = 0;
  state.items.forEach((item) => {
    const budget = getItemBudget(item);
    const perf = getItemProgressAndActuals(item.id);
    budgetMaterial += budget.material;
    budgetLaborHours += budget.laborHours;
    budgetLaborCost += budget.laborCost;
    budgetTotal += budget.total;
    actualMaterial += perf.actualMaterial;
    actualLaborHours += perf.actualLaborHours;
    actualLaborCost += perf.actualLaborCost;
    actualTotal += perf.actualTotal;
    earnedValue += perf.earnedValue;
  });
  const totalProgressPct = budgetTotal > 0 ? (earnedValue / budgetTotal) * 100 : 0;
  const costVariance = earnedValue - actualTotal;
  const cpi = actualTotal > 0 ? earnedValue / actualTotal : 0;
  const plannedProductivity = budgetLaborHours > 0 ? budgetTotal / budgetLaborHours : 0;
  const actualProductivity = actualLaborHours > 0 ? earnedValue / actualLaborHours : 0;
  const productivityIndex = plannedProductivity > 0 ? actualProductivity / plannedProductivity : 0;
  return {
    budgetMaterial,
    budgetLaborHours,
    budgetLaborCost,
    budgetTotal,
    actualMaterial,
    actualLaborHours,
    actualLaborCost,
    actualTotal,
    earnedValue,
    totalProgressPct,
    costVariance,
    cpi,
    plannedProductivity,
    actualProductivity,
    productivityIndex
  };
}

function renderProjectInfo() {
  document.getElementById("projectName").value = state.project.name || "";
  document.getElementById("projectCode").value = state.project.code || "";
  document.getElementById("projectLaborRate").value = state.project.laborRate || "";
  document.getElementById("projectContractValue").value = state.project.contractValue || "";
}

function renderScheduleTable() {
  const body = document.getElementById("wbsScheduleBody");
  const items = getSortedItems();
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="2">No WBS items yet.</td></tr>`;
    return;
  }
  body.innerHTML = items
    .map((item) => {
      const selectedClass = state.selectedItemId === item.id ? "selected" : "";
      return `<tr data-item-id="${item.id}" class="${selectedClass}"><td>${item.code}</td><td>${item.name}</td></tr>`;
    })
    .join("");
  body.querySelectorAll("tr[data-item-id]").forEach((row) => {
    row.addEventListener("click", () => {
      state.selectedItemId = row.dataset.itemId;
      const item = state.items.find((x) => x.id === state.selectedItemId);
      if (!item) return;
      const form = document.getElementById("wbsScheduleForm");
      form.elements.code.value = item.code;
      form.elements.name.value = item.name;
      form.elements.materialBudget.value = item.materialBudget || "";
      form.elements.laborHoursBudget.value = item.laborHoursBudget || "";
      form.elements.notes.value = item.notes || "";
      renderScheduleTable();
    });
  });
}

function renderWeeklyItemOptions() {
  const select = document.getElementById("weeklyItemSelect");
  const items = getSortedItems();
  if (!items.length) {
    select.innerHTML = `<option value="">Add WBS items first</option>`;
    return;
  }
  select.innerHTML = `<option value="">Select WBS item</option>${items
    .map((item) => `<option value="${item.id}">${item.code} - ${item.name}</option>`)
    .join("")}`;
}

function renderKpis() {
  const s = getProjectSummary();
  const contractValue = getProjectContractValue();
  const billedToDatePct = contractValue > 0 ? (s.earnedValue / contractValue) * 100 : 0;
  const cards = [
    ["Project Labor Rate", fmtCurrency(getProjectLaborRate()) + "/hr"],
    ["Contract Value", fmtCurrency(contractValue)],
    ["Billed vs Contract", fmtPct(billedToDatePct)],
    ["Total Budget", fmtCurrency(s.budgetTotal)],
    ["Total Progress", fmtPct(s.totalProgressPct)],
    ["Earned Value", fmtCurrency(s.earnedValue)],
    ["Actual Cost", fmtCurrency(s.actualTotal)],
    ["Cost Variance", fmtCurrency(s.costVariance), s.costVariance >= 0 ? "pos" : "neg"],
    ["CPI", s.cpi ? s.cpi.toFixed(2) : "0.00", s.cpi >= 1 ? "pos" : "neg"],
    ["Planned Prod. ($/hr)", fmtCurrency(s.plannedProductivity)],
    ["Actual Prod. ($/hr)", fmtCurrency(s.actualProductivity)],
    ["Productivity Index", s.productivityIndex ? s.productivityIndex.toFixed(2) : "0.00", s.productivityIndex >= 1 ? "pos" : "neg"]
  ];
  document.getElementById("kpiCards").innerHTML = cards
    .map(([title, value, extra]) => `<article class="kpi-card"><div class="kpi-title">${title}</div><div class="kpi-value ${extra || ""}">${value}</div></article>`)
    .join("");
}

function renderWbsTable() {
  const body = document.getElementById("wbsTableBody");
  const items = getSortedItems();
  if (!items.length) {
    body.innerHTML = `<tr><td colspan="12">No WBS items yet.</td></tr>`;
    return;
  }
  body.innerHTML = items
    .map((item) => {
      const budget = getItemBudget(item);
      const perf = getItemProgressAndActuals(item.id);
      return `<tr>
          <td>${item.code}</td>
          <td>${item.name}</td>
          <td>${fmtCurrency(budget.material)}</td>
          <td>${fmtNumber(budget.laborHours)}</td>
          <td>${fmtCurrency(budget.total)}</td>
          <td>${fmtPct(perf.progressPct)}</td>
          <td>${fmtCurrency(perf.actualMaterial)}</td>
          <td>${fmtNumber(perf.actualLaborHours)}</td>
          <td>${fmtCurrency(perf.actualTotal)}</td>
          <td>${fmtCurrency(perf.earnedValue)}</td>
          <td class="${perf.costVariance >= 0 ? "pos" : "neg"}">${fmtCurrency(perf.costVariance)}</td>
          <td class="${perf.productivityIndex >= 1 ? "pos" : "neg"}">${perf.productivityIndex.toFixed(2)}</td>
        </tr>`;
    })
    .join("");
}

function renderWeeklyTable() {
  const body = document.getElementById("weeklyTableBody");
  if (!state.weeklyUpdates.length) {
    body.innerHTML = `<tr><td colspan="8">No weekly updates yet.</td></tr>`;
    return;
  }
  const rows = [...state.weeklyUpdates].sort((a, b) => b.weekEnding.localeCompare(a.weekEnding));
  const laborRate = getProjectLaborRate();
  body.innerHTML = rows
    .map((u) => {
      const item = state.items.find((i) => i.id === u.itemId);
      const actualLaborCost = Number(u.actualLaborHours || 0) * laborRate;
      const earnedThisWeek = item ? getItemBudget(item).total * (Number(u.weeklyProgressPct || 0) / 100) : 0;
      return `<tr>
          <td>${u.weekEnding}</td>
          <td>${item ? `${item.code} - ${item.name}` : "Unknown item"}</td>
          <td>${fmtPct(u.weeklyProgressPct)}</td>
          <td>${fmtCurrency(u.actualMaterialCost)}</td>
          <td>${fmtNumber(u.actualLaborHours)}</td>
          <td>${fmtCurrency(actualLaborCost)}</td>
          <td>${fmtCurrency(earnedThisWeek)}</td>
          <td>${u.notes || ""}</td>
        </tr>`;
    })
    .join("");
}

function renderMonthlyBilling() {
  const month = document.getElementById("billingMonth").value;
  const summary = document.getElementById("billingSummary");
  if (!month) {
    summary.innerHTML = "Pick a month to see billable progress and actual monthly cost.";
    return;
  }
  const updates = state.weeklyUpdates.filter((u) => (u.weekEnding || "").startsWith(month));
  let earnedThisMonth = 0;
  let actualMaterialMonth = 0;
  let actualLaborCostMonth = 0;
  let actualLaborHoursMonth = 0;
  const laborRate = getProjectLaborRate();
  updates.forEach((u) => {
    const item = state.items.find((i) => i.id === u.itemId);
    if (!item) return;
    const budgetTotal = getItemBudget(item).total;
    const progressPct = Number(u.weeklyProgressPct || 0);
    const mat = Number(u.actualMaterialCost || 0);
    const laborHrs = Number(u.actualLaborHours || 0);
    earnedThisMonth += budgetTotal * (progressPct / 100);
    actualMaterialMonth += mat;
    actualLaborHoursMonth += laborHrs;
    actualLaborCostMonth += laborHrs * laborRate;
  });
  const actualTotalMonth = actualMaterialMonth + actualLaborCostMonth;
  const monthVariance = earnedThisMonth - actualTotalMonth;
  const monthCpi = actualTotalMonth > 0 ? earnedThisMonth / actualTotalMonth : 0;
  summary.innerHTML = `
    <div><strong>Month:</strong> ${month}</div>
    <div><strong>Billable Amount (Earned Value):</strong> ${fmtCurrency(earnedThisMonth)}</div>
    <div><strong>Actual Material Cost:</strong> ${fmtCurrency(actualMaterialMonth)}</div>
    <div><strong>Actual Labor Cost:</strong> ${fmtCurrency(actualLaborCostMonth)}</div>
    <div><strong>Actual Labor Hours:</strong> ${fmtNumber(actualLaborHoursMonth)}</div>
    <div><strong>Actual Total Cost:</strong> ${fmtCurrency(actualTotalMonth)}</div>
    <div><strong>Monthly Cost Variance:</strong> <span class="${monthVariance >= 0 ? "pos" : "neg"}">${fmtCurrency(monthVariance)}</span></div>
    <div><strong>Monthly CPI:</strong> <span class="${monthCpi >= 1 ? "pos" : "neg"}">${monthCpi.toFixed(2)}</span></div>
  `;
}

function rerenderAll() {
  renderProjectInfo();
  renderScheduleTable();
  renderWeeklyItemOptions();
  renderKpis();
  renderWbsTable();
  renderWeeklyTable();
  renderMonthlyBilling();
}

function toCsvValue(value) {
  const str = String(value ?? "");
  if (str.includes(",") || str.includes("\"") || str.includes("\n")) {
    return `"${str.replace(/"/g, "\"\"")}"`;
  }
  return str;
}

function downloadCsv(filename, headers, rows) {
  const csv = [headers, ...rows].map((row) => row.map(toCsvValue).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportWbsPerformanceCsv() {
  const rows = getSortedItems().map((item) => {
    const budget = getItemBudget(item);
    const perf = getItemProgressAndActuals(item.id);
    return [
      item.code,
      item.name,
      budget.material.toFixed(2),
      budget.laborHours.toFixed(2),
      budget.total.toFixed(2),
      perf.progressPct.toFixed(2),
      perf.actualMaterial.toFixed(2),
      perf.actualLaborHours.toFixed(2),
      perf.actualTotal.toFixed(2),
      perf.earnedValue.toFixed(2),
      perf.costVariance.toFixed(2),
      perf.productivityIndex.toFixed(2)
    ];
  });
  downloadCsv(
    `${(state.project.code || "project")}-wbs-performance.csv`,
    [
      "WBS",
      "Description",
      "Budget Material",
      "Budget Labor Hrs",
      "Budget Total",
      "Progress %",
      "Actual Material",
      "Actual Labor Hrs",
      "Actual Total",
      "Earned Value",
      "Cost Variance",
      "Productivity Index"
    ],
    rows
  );
}

function exportWeeklyEntriesCsv() {
  const laborRate = getProjectLaborRate();
  const rows = [...state.weeklyUpdates]
    .sort((a, b) => b.weekEnding.localeCompare(a.weekEnding))
    .map((u) => {
      const item = state.items.find((i) => i.id === u.itemId);
      const actualLaborCost = Number(u.actualLaborHours || 0) * laborRate;
      const earnedThisWeek = item ? getItemBudget(item).total * (Number(u.weeklyProgressPct || 0) / 100) : 0;
      return [
        u.weekEnding,
        item ? item.code : "",
        item ? item.name : "",
        Number(u.weeklyProgressPct || 0).toFixed(2),
        Number(u.actualMaterialCost || 0).toFixed(2),
        Number(u.actualLaborHours || 0).toFixed(2),
        actualLaborCost.toFixed(2),
        earnedThisWeek.toFixed(2),
        u.notes || ""
      ];
    });
  downloadCsv(
    `${(state.project.code || "project")}-weekly-entries.csv`,
    [
      "Week Ending",
      "WBS",
      "Description",
      "Progress %",
      "Actual Material",
      "Actual Labor Hrs",
      "Actual Labor Cost",
      "Earned This Week",
      "Notes"
    ],
    rows
  );
}

function createNewProject() {
  const confirmed = window.confirm("Start a new project? This will clear current project data from the screen.");
  if (!confirmed) return;
  state.project = { name: "", code: "", laborRate: 0, contractValue: 0 };
  state.items = [];
  state.weeklyUpdates = [];
  state.selectedItemId = null;
  state.fileHandle = null;
  saveState();
  document.getElementById("wbsScheduleForm").reset();
  document.getElementById("weeklyForm").reset();
  setDefaultBillingMonth();
  rerenderAll();
}

async function saveProjectFile() {
  const content = getProjectFileJson();
  if ("showSaveFilePicker" in window) {
    const handle =
      state.fileHandle ||
      (await window.showSaveFilePicker({
        suggestedName: `${(state.project.code || "construction-project").replace(/\s+/g, "-")}.json`,
        types: [{ description: "JSON Files", accept: { "application/json": [".json"] } }]
      }));
    state.fileHandle = handle;
    const writable = await handle.createWritable();
    await writable.write(content);
    await writable.close();
    return;
  }
  const blob = new Blob([content], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(state.project.code || "construction-project").replace(/\s+/g, "-")}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

function applyLoadedProjectData(parsedData) {
  const normalized = normalizeParsedData(parsedData);
  state.project = normalized.project;
  state.items = normalized.items;
  state.weeklyUpdates = normalized.weeklyUpdates;
  state.selectedItemId = null;
  sortItemsInState();
  saveState();
  rerenderAll();
}

async function openProjectFile() {
  if ("showOpenFilePicker" in window) {
    const [handle] = await window.showOpenFilePicker({
      types: [{ description: "JSON Files", accept: { "application/json": [".json"] } }],
      multiple: false
    });
    if (!handle) return;
    state.fileHandle = handle;
    const file = await handle.getFile();
    applyLoadedProjectData(JSON.parse(await file.text()));
    return;
  }
  document.getElementById("openFileInput").click();
}

function setupEvents() {
  document.getElementById("saveProjectBtn").addEventListener("click", () => {
    state.project.name = document.getElementById("projectName").value.trim();
    state.project.code = document.getElementById("projectCode").value.trim();
    state.project.laborRate = Number(document.getElementById("projectLaborRate").value || 0);
    state.project.contractValue = Number(document.getElementById("projectContractValue").value || 0);
    saveState();
    rerenderAll();
  });

  document.getElementById("wbsScheduleForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const code = data.get("code").toString().trim() || buildAutoWbsCode();
    const name = data.get("name").toString().trim();
    if (!name) return;
    state.items.push({
      id: uid("item"),
      code,
      name,
      materialBudget: Number(data.get("materialBudget") || 0),
      laborHoursBudget: Number(data.get("laborHoursBudget") || 0),
      notes: data.get("notes").toString().trim()
    });
    sortItemsInState();
    event.target.reset();
    saveState();
    rerenderAll();
  });

  document.getElementById("updateScheduleBtn").addEventListener("click", () => {
    if (!state.selectedItemId) return;
    const item = state.items.find((x) => x.id === state.selectedItemId);
    if (!item) return;
    const form = document.getElementById("wbsScheduleForm");
    item.code = form.elements.code.value.trim() || item.code;
    item.name = form.elements.name.value.trim();
    item.materialBudget = Number(form.elements.materialBudget.value || 0);
    item.laborHoursBudget = Number(form.elements.laborHoursBudget.value || 0);
    item.notes = form.elements.notes.value.trim();
    sortItemsInState();
    saveState();
    rerenderAll();
  });

  document.getElementById("deleteScheduleBtn").addEventListener("click", () => {
    if (!state.selectedItemId) return;
    const removeId = state.selectedItemId;
    state.items = state.items.filter((item) => item.id !== removeId);
    state.weeklyUpdates = state.weeklyUpdates.filter((u) => u.itemId !== removeId);
    state.selectedItemId = null;
    document.getElementById("wbsScheduleForm").reset();
    saveState();
    rerenderAll();
  });

  document.getElementById("weeklyForm").addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(event.target);
    const itemId = data.get("itemId").toString();
    const weekEnding = data.get("weekEnding").toString();
    if (!itemId || !weekEnding) return;
    state.weeklyUpdates.push({
      id: uid("weekly"),
      weekEnding,
      itemId,
      weeklyProgressPct: Number(data.get("weeklyProgressPct")),
      actualMaterialCost: Number(data.get("actualMaterialCost")),
      actualLaborHours: Number(data.get("actualLaborHours")),
      notes: data.get("notes").toString().trim()
    });
    event.target.reset();
    saveState();
    rerenderAll();
  });

  document.getElementById("billingMonth").addEventListener("change", renderMonthlyBilling);
  document.getElementById("saveToComputerBtn").addEventListener("click", saveProjectFile);
  document.getElementById("openFromComputerBtn").addEventListener("click", openProjectFile);
  document.getElementById("newProjectBtn").addEventListener("click", createNewProject);
  document.getElementById("exportWbsBtn").addEventListener("click", exportWbsPerformanceCsv);
  document.getElementById("exportWeeklyBtn").addEventListener("click", exportWeeklyEntriesCsv);
  document.getElementById("openFileInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    applyLoadedProjectData(JSON.parse(await file.text()));
    event.target.value = "";
  });
}

function setDefaultBillingMonth() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  document.getElementById("billingMonth").value = `${yyyy}-${mm}`;
}

function init() {
  loadState();
  setupEvents();
  setDefaultBillingMonth();
  rerenderAll();
}

document.addEventListener("DOMContentLoaded", init);
