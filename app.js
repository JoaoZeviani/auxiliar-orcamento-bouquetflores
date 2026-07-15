const STORAGE_KEY = "orcamento-floral-v2";
const REMOTE_META_KEY = "orcamento-floral-remote-meta-v1";
const LOGO_SRC = "assets/logo_bouquet_flores.png";
const SUPABASE_TABLE = "orcamentos";

const defaultState = {
  cover: {
    title: "",
    subtitle: "",
    intro: ""
  },
  coverFields: [],
  palette: [],
  inspirations: [],
  budgetItems: [],
  payment: {
    terms: ""
  },
  includedTopics: [],
  excludedTopics: []
};

let state = loadState();
let remoteMeta = loadRemoteMeta();
let appInitialized = false;
let suppressRemoteDirty = false;
let savedBudgetsCache = [];
let supabaseClient = null;
let inputPreviewTimer = null;
let inputSaveTimer = null;

const INPUT_PREVIEW_DELAY = 360;
const INPUT_SAVE_DELAY = 700;

const els = {
  preview: document.getElementById("pdfPreview"),
  saveStatus: document.getElementById("saveStatus"),
  coverFieldsEditor: document.getElementById("coverFieldsEditor"),
  paletteEditor: document.getElementById("paletteEditor"),
  inspirationsEditor: document.getElementById("inspirationsEditor"),
  budgetEditor: document.getElementById("budgetEditor"),
  includedEditor: document.getElementById("includedEditor"),
  excludedEditor: document.getElementById("excludedEditor"),
  inspirationInput: document.getElementById("inspirationInput"),
  remoteStatus: document.getElementById("remoteStatus"),
  btnLogout: document.getElementById("btnLogout"),
  btnSaveRemote: document.getElementById("btnSaveRemote"),
  btnOpenRemote: document.getElementById("btnOpenRemote"),
  authModal: document.getElementById("authModal"),
  authForm: document.getElementById("authForm"),
  authPassword: document.getElementById("authPassword"),
  authMessage: document.getElementById("authMessage"),
  savedBudgetsModal: document.getElementById("savedBudgetsModal"),
  savedBudgetSearch: document.getElementById("savedBudgetSearch"),
  savedBudgetsList: document.getElementById("savedBudgetsList"),
  saveChoiceModal: document.getElementById("saveChoiceModal"),
  btnDownloadPdf: document.getElementById("btnDownloadPdf"),
  btnReset: document.getElementById("btnReset"),
  btnAddCoverField: document.getElementById("btnAddCoverField"),
  btnAddColor: document.getElementById("btnAddColor"),
  btnAddBudgetItem: document.getElementById("btnAddBudgetItem"),
  btnAddIncluded: document.getElementById("btnAddIncluded"),
  btnAddExcluded: document.getElementById("btnAddExcluded")
};

init();

function init() {
  ensureMainColor();
  renderEditor();
  renderPreview();
  bindEvents();
  refreshAuthUi({ promptIfLoggedOut: true });
  updateRemoteStatus();
  appInitialized = true;
  window.addEventListener("resize", updatePreviewScale);
  window.addEventListener("beforeunload", handleBeforeUnload);
}

function bindEvents() {
  document.body.addEventListener("input", handleInput);
  document.body.addEventListener("change", handleChange);
  document.body.addEventListener("click", handleClick);

  els.inspirationInput.addEventListener("change", handleImageUpload);

  els.btnDownloadPdf.addEventListener("click", downloadPdf);

  els.btnLogout.addEventListener("click", logoutSupabase);
  els.btnSaveRemote.addEventListener("click", handleSaveRemoteClick);
  els.btnOpenRemote.addEventListener("click", openSavedBudgetsModal);
  els.authForm.addEventListener("submit", handleAuthSubmit);
  els.authModal.addEventListener("cancel", event => event.preventDefault());
  els.savedBudgetSearch.addEventListener("input", renderSavedBudgetsList);

  els.btnReset.addEventListener("click", () => {
    if (!confirmDiscardUnsaved()) return;
    const ok = confirm("Limpar todos os dados salvos neste navegador?");
    if (!ok) return;
    state = structuredCloneSafe(defaultState);
    remoteMeta = createEmptyRemoteMeta();
    saveRemoteMeta();
    saveState();
    renderEditor();
    renderPreview();
    updateRemoteStatus();
  });

  els.btnAddCoverField.addEventListener("click", () => {
    const item = { id: cryptoId(), label: "", value: "" };
    state.coverFields.push(item);
    saveRenderAll(item.id);
  });

  els.btnAddColor.addEventListener("click", () => {
    if (state.palette.length >= 10) {
      setStatus("Limite de 10 cores atingido.");
      return;
    }
    const item = { id: cryptoId(), name: "", hex: "#4d1225", main: state.palette.length === 0 };
    state.palette.push(item);
    ensureMainColor();
    saveRenderAll(item.id);
  });

  els.btnAddBudgetItem.addEventListener("click", () => {
    const item = { id: cryptoId(), name: "", description: "", price: "" };
    state.budgetItems.push(item);
    saveRenderAll(item.id);
  });

  els.btnAddIncluded.addEventListener("click", () => {
    const item = { id: cryptoId(), text: "" };
    state.includedTopics.push(item);
    saveRenderAll(item.id);
  });

  els.btnAddExcluded.addEventListener("click", () => {
    const item = { id: cryptoId(), text: "" };
    state.excludedTopics.push(item);
    saveRenderAll(item.id);
  });
}

function handleInput(event) {
  const el = event.target;
  const section = el.dataset.section;
  const id = el.dataset.id;
  const field = el.dataset.field;

  if (!section || !field) return;

  if (section === "cover") {
    state.cover[field] = el.value;
  }

  if (section === "coverFields") {
    const item = state.coverFields.find(x => x.id === id);
    if (item) item[field] = el.value;
  }

  if (section === "palette") {
    const item = state.palette.find(x => x.id === id);
    if (item) item[field] = field === "hex" ? normalizeHex(el.value) : el.value;
  }

  if (section === "budgetItems") {
    const item = state.budgetItems.find(x => x.id === id);
    if (item) item[field] = el.value;
  }

  if (section === "payment") {
    state.payment[field] = el.value;
  }

  if (section === "includedTopics") {
    const item = state.includedTopics.find(x => x.id === id);
    if (item) item[field] = el.value;
  }

  if (section === "excludedTopics") {
    const item = state.excludedTopics.find(x => x.id === id);
    if (item) item[field] = el.value;
  }

  scheduleInputSaveAndPreview();
}

function scheduleInputSaveAndPreview() {
  if (appInitialized && !suppressRemoteDirty) {
    markRemoteDirty();
  }

  window.clearTimeout(inputSaveTimer);
  window.clearTimeout(inputPreviewTimer);

  inputSaveTimer = window.setTimeout(() => {
    saveState({ markDirty: false });
  }, INPUT_SAVE_DELAY);

  inputPreviewTimer = window.setTimeout(() => {
    renderPreview();
  }, INPUT_PREVIEW_DELAY);
}

function flushPendingInputWork() {
  window.clearTimeout(inputSaveTimer);
  window.clearTimeout(inputPreviewTimer);
  inputSaveTimer = null;
  inputPreviewTimer = null;
  saveState({ markDirty: false });
  renderPreview();
}

function handleChange(event) {
  const el = event.target;
  if (el.dataset.section !== "palette" || el.dataset.field !== "main") return;

  const item = state.palette.find(x => x.id === el.dataset.id);
  if (!item) return;

  state.palette.forEach(color => {
    color.main = color.id === item.id;
  });
  ensureMainColor();
  saveRenderAll();
}

function handleClick(event) {
  const button = event.target.closest("[data-action]");
  if (!button) return;

  const action = button.dataset.action;
  const id = button.dataset.id;

  if (handleModalAction(action, id)) return;

  let scrollTargetId = null;

  if (action === "remove-cover-field") {
    state.coverFields = state.coverFields.filter(x => x.id !== id);
  }

  if (action === "remove-color") {
    state.palette = state.palette.filter(x => x.id !== id);
    ensureMainColor();
  }

  if (action === "remove-inspiration") {
    state.inspirations = state.inspirations.filter(x => x.id !== id);
  }

  if (action === "remove-budget-item") {
    state.budgetItems = state.budgetItems.filter(x => x.id !== id);
  }

  if (action === "remove-included") {
    state.includedTopics = state.includedTopics.filter(x => x.id !== id);
  }

  if (action === "remove-excluded") {
    state.excludedTopics = state.excludedTopics.filter(x => x.id !== id);
  }

  if (action === "move-cover-field-up") scrollTargetId = moveItem(state.coverFields, id, -1);
  if (action === "move-cover-field-down") scrollTargetId = moveItem(state.coverFields, id, 1);
  if (action === "move-color-up") scrollTargetId = moveItem(state.palette, id, -1);
  if (action === "move-color-down") scrollTargetId = moveItem(state.palette, id, 1);
  if (action === "move-inspiration-up") scrollTargetId = moveItem(state.inspirations, id, -1);
  if (action === "move-inspiration-down") scrollTargetId = moveItem(state.inspirations, id, 1);
  if (action === "move-budget-item-up") scrollTargetId = moveItem(state.budgetItems, id, -1);
  if (action === "move-budget-item-down") scrollTargetId = moveItem(state.budgetItems, id, 1);
  if (action === "move-included-up") scrollTargetId = moveItem(state.includedTopics, id, -1);
  if (action === "move-included-down") scrollTargetId = moveItem(state.includedTopics, id, 1);
  if (action === "move-excluded-up") scrollTargetId = moveItem(state.excludedTopics, id, -1);
  if (action === "move-excluded-down") scrollTargetId = moveItem(state.excludedTopics, id, 1);

  if (action.startsWith("move-color")) ensureMainColor();

  saveRenderAll(scrollTargetId);
}

async function handleImageUpload(event) {
  const files = Array.from(event.target.files || []).filter(file => file.type.startsWith("image/"));
  if (!files.length) return;

  setStatus("Otimizando imagens...");

  try {
    const items = await Promise.all(files.map(async file => ({
      id: cryptoId(),
      name: file.name,
      dataUrl: await fileToOptimizedDataUrl(file)
    })));

    state.inspirations.push(...items);
    event.target.value = "";
    saveRenderAll(items.length ? items[items.length - 1].id : null);
  } catch (error) {
    console.error(error);
    event.target.value = "";
    alert("Não foi possível carregar uma das imagens. Tente usar JPG, PNG ou WEBP.");
  }
}

function readFileAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler imagem"));
    reader.readAsDataURL(file);
  });
}

function loadImageElement(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Imagem inválida"));
    image.src = src;
  });
}

async function optimizeImageDataUrl(dataUrl, { maxSide = 1800, quality = 0.86 } = {}) {
  if (!String(dataUrl || "").startsWith("data:image/")) return dataUrl;

  const image = await loadImageElement(dataUrl);
  const width = image.naturalWidth || image.width || 1;
  const height = image.naturalHeight || image.height || 1;
  const longest = Math.max(width, height);

  if (longest <= maxSide && String(dataUrl).length < 900000) {
    return dataUrl;
  }

  const ratio = Math.min(1, maxSide / longest);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.max(1, Math.round(height * ratio));
  const ctx = canvas.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", quality);
}

async function fileToOptimizedDataUrl(file) {
  const dataUrl = await readFileAsDataUrl(file);
  return optimizeImageDataUrl(dataUrl);
}

async function waitForFonts() {
  if (!document.fonts || !document.fonts.ready) return;

  try {
    await document.fonts.load('400 16px "Clear Sans"', 'Orçamento Floral');
    await document.fonts.load('400 42pt "Magnolia Script"', 'Paleta de cores');
    await document.fonts.load('400 58pt "Gistesy"', 'Patricia Zeviani');
    await document.fonts.load('400 28pt "Gistesy"', 'Bouquet Flores');
    await document.fonts.ready;
  } catch (error) {
    // Se alguma webfont não carregar, o PDF usa Clear Sans/Arial como fallback, não fonte cursiva genérica.
  }
}

async function downloadPdf() {
  flushPendingInputWork();
  await waitForFonts();

  try {
    await loadPdfLibrary();
  } catch (error) {
    console.error(error);
    alert("Não foi possível carregar o gerador de PDF local. Confira se o arquivo assets/pdf-local.js foi enviado para o GitHub junto com os demais arquivos.");
    return;
  }

  if (!window.html2canvas || !window.jspdf || !window.jspdf.jsPDF) {
    alert("Não foi possível carregar o gerador de PDF local. Confira se o arquivo assets/pdf-local.js foi enviado para o GitHub junto com os demais arquivos.");
    return;
  }

  const originalText = els.btnDownloadPdf.textContent;
  els.btnDownloadPdf.disabled = true;
  els.btnDownloadPdf.textContent = "Gerando PDF...";
  document.body.classList.add("is-downloading-pdf");

  try {
    await waitForPreviewImages();

    const { jsPDF } = window.jspdf;
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const sheets = Array.from(els.preview.querySelectorAll(".sheet"));

    if (!sheets.length) throw new Error("Nenhuma página encontrada na pré-visualização.");

    for (let index = 0; index < sheets.length; index += 1) {
      const sheet = sheets[index];
      setStatus(`Gerando PDF (${index + 1}/${sheets.length})...`);

      const canvas = await capturePreviewSheet(sheet);
      const imageData = canvasToJpegDataUrl(canvas);

      if (index > 0) pdf.addPage("a4", "portrait");
      pdf.addImage(imageData, "JPEG", 0, 0, 210, 297);
    }

    pdf.save(`${buildPdfFileName()}.pdf`);
    setStatus("PDF baixado.");
  } catch (error) {
    console.error(error);
    const opened = openPrintableFallback();
    if (opened) {
      alert("Não foi possível baixar automaticamente neste navegador, então abri uma versão fiel da pré-visualização. Use Salvar como PDF nessa janela.");
    } else {
      alert(`Não foi possível baixar o PDF automaticamente. A pré-visualização continua fiel ao PDF; tente reduzir a quantidade/tamanho das imagens ou atualizar os arquivos do projeto.\n\nDetalhe: ${error.message || error}`);
    }
  } finally {
    document.body.classList.remove("is-downloading-pdf");
    els.btnDownloadPdf.disabled = false;
    els.btnDownloadPdf.textContent = originalText;
  }
}

async function capturePreviewSheet(sheet) {
  const width = Math.max(1, Math.ceil(sheet.scrollWidth || sheet.getBoundingClientRect().width || 794));
  const height = Math.max(1, Math.ceil(sheet.scrollHeight || sheet.getBoundingClientRect().height || 1123));
  const scales = [1.75, 1.35, 1, 0.82];
  let lastError = null;

  for (const scale of scales) {
    try {
      const canvas = await window.html2canvas(sheet, {
        scale,
        useCORS: true,
        allowTaint: false,
        backgroundColor: "#ffffff",
        logging: false,
        windowWidth: width,
        windowHeight: height
      });

      if (!canvas || !canvas.width || !canvas.height) {
        throw new Error("Canvas vazio ao gerar página.");
      }

      return canvas;
    } catch (error) {
      lastError = error;
      await delay(120);
    }
  }

  throw lastError || new Error("Falha ao capturar a página da pré-visualização.");
}

function canvasToJpegDataUrl(canvas) {
  const dataUrl = canvas.toDataURL("image/jpeg", 0.94);
  if (/^data:image\/jpe?g/i.test(dataUrl)) return dataUrl;

  const flattened = document.createElement("canvas");
  flattened.width = canvas.width;
  flattened.height = canvas.height;
  const ctx = flattened.getContext("2d", { alpha: false });
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, flattened.width, flattened.height);
  ctx.drawImage(canvas, 0, 0);
  return flattened.toDataURL("image/jpeg", 0.94);
}

function waitForPreviewImages() {
  const images = Array.from(els.preview.querySelectorAll("img"));
  const promises = images.map(image => new Promise(resolve => {
    if (image.complete) {
      resolve();
      return;
    }

    const done = () => resolve();
    image.addEventListener("load", done, { once: true });
    image.addEventListener("error", done, { once: true });
    window.setTimeout(done, 2400);
  }));

  return Promise.all(promises);
}

function delay(ms) {
  return new Promise(resolve => window.setTimeout(resolve, ms));
}

function openPrintableFallback() {
  try {
    const printable = window.open("", "_blank");
    if (!printable) return false;

    const styles = Array.from(document.querySelectorAll('style, link[rel="stylesheet"]'))
      .map(node => node.outerHTML)
      .join("\n");

    printable.document.open();
    printable.document.write(`<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<title>${escapeHtml(buildPdfFileName())}</title>
${styles}
<style>
  body { margin: 0; background: #ffffff !important; }
  .pdf-document { display: block !important; width: auto !important; max-width: none !important; overflow: visible !important; }
  .sheet-frame { width: 210mm !important; height: 297mm !important; min-height: 297mm !important; overflow: hidden !important; page-break-after: always; break-after: page; }
  .sheet-frame:last-child { page-break-after: auto; break-after: auto; }
  .sheet { transform: none !important; box-shadow: none !important; }
</style>
</head>
<body class="is-downloading-pdf">
${els.preview.outerHTML}
</body>
</html>`);
    printable.document.close();
    printable.focus();
    window.setTimeout(() => printable.print(), 500);
    return true;
  } catch (error) {
    console.error(error);
    return false;
  }
}

function loadPdfLibrary() {
  if (window.html2canvas && window.jspdf && window.jspdf.jsPDF) {
    return Promise.resolve();
  }

  return Promise.reject(new Error("Gerador de PDF local não encontrado"));
}
function renderEditor() {
  document.querySelector('[data-section="cover"][data-field="title"]').value = state.cover.title || "";
  document.querySelector('[data-section="cover"][data-field="subtitle"]').value = state.cover.subtitle || "";
  document.querySelector('[data-section="cover"][data-field="intro"]').value = state.cover.intro || "";
  document.querySelector('[data-section="payment"][data-field="terms"]').value = state.payment.terms || "";

  els.coverFieldsEditor.innerHTML = state.coverFields.map((item, index) => `
    <div class="editor-card" data-editor-item-id="${item.id}">
      <div class="card-grid">
        <label>
          Nome do campo
          <input type="text" data-section="coverFields" data-id="${item.id}" data-field="label" value="${attr(item.label)}">
        </label>
        <label>
          Informação
          <input type="text" data-section="coverFields" data-id="${item.id}" data-field="value" value="${attr(item.value)}">
        </label>
      </div>
      <div class="actions">
        ${renderMoveButtons("cover-field", item.id, index, state.coverFields.length)}
        <button class="mini danger" type="button" data-action="remove-cover-field" data-id="${item.id}">Remover</button>
      </div>
    </div>
  `).join("");

  els.paletteEditor.innerHTML = state.palette.map((item, index) => `
    <div class="editor-card" data-editor-item-id="${item.id}">
      <div class="card-grid">
        <label>
          Nome
          <input type="text" data-section="palette" data-id="${item.id}" data-field="name" value="${attr(item.name)}">
        </label>
        <label>
          Cor
          <input type="color" data-section="palette" data-id="${item.id}" data-field="hex" value="${attr(normalizeHex(item.hex))}">
        </label>
      </div>
      <label class="inline-check">
        <input type="radio" name="mainColor" data-section="palette" data-id="${item.id}" data-field="main" ${item.main ? "checked" : ""}>
        Cor principal
      </label>
      <div class="actions">
        ${renderMoveButtons("color", item.id, index, state.palette.length)}
        <button class="mini danger" type="button" data-action="remove-color" data-id="${item.id}" ${state.palette.length <= 1 ? "disabled" : ""}>Remover</button>
      </div>
    </div>
  `).join("");

  els.btnAddColor.disabled = state.palette.length >= 10;

  els.inspirationsEditor.innerHTML = state.inspirations.length
    ? state.inspirations.map((item, index) => `
      <div class="image-chip" data-editor-item-id="${item.id}">
        <img src="${attr(resolveImageSource(item))}" alt="${attr(item.name || "Inspiração")}">
        <div class="image-chip-actions">
          ${renderMoveButtons("inspiration", item.id, index, state.inspirations.length)}
          <button class="mini danger" type="button" data-action="remove-inspiration" data-id="${item.id}">Remover</button>
        </div>
      </div>
    `).join("")
    : `<p class="hint">Nenhuma imagem adicionada ainda.</p>`;

  els.budgetEditor.innerHTML = state.budgetItems.map((item, index) => `
    <div class="editor-card" data-editor-item-id="${item.id}">
      <div class="card-grid">
        <label>
          Nome
          <input type="text" data-section="budgetItems" data-id="${item.id}" data-field="name" value="${attr(item.name)}">
        </label>
        <label>
          Preço
          <input type="text" inputmode="decimal" data-section="budgetItems" data-id="${item.id}" data-field="price" value="${attr(item.price)}" placeholder="Ex.: 1500,00">
        </label>
      </div>
      <label>
        Descrição
        <textarea rows="3" data-section="budgetItems" data-id="${item.id}" data-field="description">${escapeHtml(item.description)}</textarea>
      </label>
      <div class="actions">
        ${renderMoveButtons("budget-item", item.id, index, state.budgetItems.length)}
        <button class="mini danger" type="button" data-action="remove-budget-item" data-id="${item.id}">Remover</button>
      </div>
    </div>
  `).join("");

  els.includedEditor.innerHTML = state.includedTopics.map((item, index) => `
    <div class="editor-card" data-editor-item-id="${item.id}">
      <div class="card-grid one">
        <label>
          Tópico
          <textarea rows="2" data-section="includedTopics" data-id="${item.id}" data-field="text">${escapeHtml(item.text)}</textarea>
        </label>
      </div>
      <div class="actions">
        ${renderMoveButtons("included", item.id, index, state.includedTopics.length)}
        <button class="mini danger" type="button" data-action="remove-included" data-id="${item.id}">Remover</button>
      </div>
    </div>
  `).join("");

  els.excludedEditor.innerHTML = state.excludedTopics.map((item, index) => `
    <div class="editor-card" data-editor-item-id="${item.id}">
      <div class="card-grid one">
        <label>
          Tópico
          <textarea rows="2" data-section="excludedTopics" data-id="${item.id}" data-field="text">${escapeHtml(item.text)}</textarea>
        </label>
      </div>
      <div class="actions">
        ${renderMoveButtons("excluded", item.id, index, state.excludedTopics.length)}
        <button class="mini danger" type="button" data-action="remove-excluded" data-id="${item.id}">Remover</button>
      </div>
    </div>
  `).join("");
}


function renderMoveButtons(kind, id, index, total) {
  return `
    <button class="mini icon" type="button" title="Subir item" aria-label="Subir item" data-action="move-${kind}-up" data-id="${id}" ${index === 0 ? "disabled" : ""}>↑</button>
    <button class="mini icon" type="button" title="Descer item" aria-label="Descer item" data-action="move-${kind}-down" data-id="${id}" ${index === total - 1 ? "disabled" : ""}>↓</button>
  `;
}

function moveItem(list, id, direction) {
  const currentIndex = list.findIndex(item => item.id === id);
  if (currentIndex === -1) return null;

  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= list.length) return id;

  const [item] = list.splice(currentIndex, 1);
  list.splice(nextIndex, 0, item);
  return id;
}

function scrollToEditorItem(id) {
  if (!id) return;

  requestAnimationFrame(() => {
    const target = document.querySelector(`[data-editor-item-id="${cssEscape(id)}"]`);
    if (!target) return;

    target.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });

    const focusable = target.querySelector("input, textarea, button:not([disabled])");
    if (focusable && !window.matchMedia("(max-width: 640px)").matches) {
      focusable.focus({ preventScroll: true });
    }
  });
}

function renderPreview() {
  applyTheme();

  const pages = [
    renderCoverPage(),
    renderPalettePage(),
    ...renderInspirationPages(),
    ...renderBudgetPages(),
    ...renderIncludedPages(),
    ...renderExcludedPages(),
    renderSignaturePage()
  ];

  els.preview.innerHTML = pages.map(page => `<div class="sheet-frame">${page}</div>`).join("");
  updatePreviewScale();
}

function updatePreviewScale() {
  if (!els.preview) return;

  const sheetWidthPx = 794;
  const sheetHeightPx = 1123;
  const viewportWidth = document.documentElement.clientWidth || window.innerWidth || sheetWidthPx;
  const previewParent = els.preview.parentElement;
  const parentWidth = previewParent ? previewParent.getBoundingClientRect().width : viewportWidth;

  const reservedPadding = viewportWidth <= 640 ? 28 : 48;
  const availableWidth = Math.min(parentWidth, viewportWidth) - reservedPadding;
  const frameWidth = Math.max(220, Math.floor(Math.min(sheetWidthPx, availableWidth)));
  const scale = Math.min(1, frameWidth / sheetWidthPx);
  const frameHeight = Math.ceil(sheetHeightPx * scale);

  els.preview.style.setProperty("--preview-scale", scale.toFixed(4));
  els.preview.style.setProperty("--sheet-frame-width", `${frameWidth}px`);
  els.preview.style.setProperty("--sheet-frame-height", `${frameHeight}px`);
}

function renderCoverPage() {
  const fields = state.coverFields.filter(item => (item.label || item.value || "").trim());
  const fieldsHtml = fields.map(item => `
    <div class="cover-field full">
      ${item.label ? `<b>${escapeHtml(item.label)}</b>` : ""}
      ${item.value ? `<span>${escapeHtml(item.value)}</span>` : ""}
    </div>
  `).join("");

  return `
    <article class="sheet cover-page">
      <div class="sheet-content">
        <div class="cover-top">
          <img class="pdf-logo" src="${LOGO_SRC}" alt="Logotipo">
        </div>

        <div class="cover-main">
          ${state.cover.title ? `<h1>${escapeHtml(state.cover.title)}</h1>` : ""}
          ${state.cover.subtitle ? `<p class="cover-subtitle">${escapeHtml(state.cover.subtitle)}</p>` : ""}
          ${state.cover.intro ? `<p class="cover-intro">${escapeHtml(state.cover.intro)}</p>` : ""}
          ${fieldsHtml ? `<div class="cover-fields">${fieldsHtml}</div>` : ""}
        </div>
      </div>
    </article>
  `;
}

function renderSmallPageLogo() {
  return `<img class="pdf-page-logo" src="${LOGO_SRC}" alt="Logotipo Bouquet Flores">`;
}

function renderPalettePage() {
  const paletteHtml = state.palette.map(item => {
    const hex = normalizeHex(item.hex);
    const text = bestTextColor(hex);
    return `
      <div class="swatch-card">
        <div class="swatch-color" style="background:${hex}; color:${text};"></div>
        <div class="swatch-info">
          ${item.name ? `<span class="swatch-name">${escapeHtml(item.name)}</span>` : ""}
          <span>${escapeHtml(hex.toUpperCase())}</span>
          ${item.main ? `<div class="main-badge">principal</div>` : ""}
        </div>
      </div>
    `;
  }).join("");

  return `
    <article class="sheet palette-page">
      ${renderSmallPageLogo()}
      <div class="sheet-content">
        <h2 class="page-title">Paleta de cores</h2>

        <div class="palette-grid">
          ${paletteHtml}
        </div>

      </div>
    </article>
  `;
}

function renderInspirationPages() {
  if (!state.inspirations.length) {
    return [`
      <article class="sheet inspiration-page">
        ${renderSmallPageLogo()}
        <div class="sheet-content">
          <h2 class="page-title">Inspirações</h2>
          <div class="empty-state empty-state-blank"></div>
        </div>
      </article>
    `];
  }

  return chunk(state.inspirations, 4).map((items, pageIndex) => `
    <article class="sheet inspiration-page">
      ${renderSmallPageLogo()}
      <div class="sheet-content">
        <h2 class="page-title">Inspirações</h2>
        <div class="inspiration-grid">
          ${items.map(item => `<div class="inspiration-slot"><img src="${attr(resolveImageSource(item))}" alt="${attr(item.name || "Inspiração")}"></div>`).join("")}
        </div>
      </div>
    </article>
  `);
}

function renderBudgetPages() {
  const items = state.budgetItems.filter(item => item.name || item.description || item.price);
  const pages = paginateBudgetItems(items);
  const total = items.reduce((sum, item) => sum + parseMoney(item.price), 0);

  if (!items.length) {
    pages.push([]);
  }

  const lastPage = pages[pages.length - 1] || [];
  const summaryOnSeparatePage = items.length > 0 && getBudgetPageHeightMm(lastPage) + getBudgetSummaryHeightMm() > getBudgetPageMaxHeightMm();

  const budgetPages = pages.map((pageItems, index) => {
    const isLast = index === pages.length - 1;
    const showSummary = isLast && !summaryOnSeparatePage;

    return `
      <article class="sheet budget-page">
        ${renderSmallPageLogo()}
        <div class="sheet-content">
          <h2 class="page-title">Orçamento</h2>

          ${pageItems.length
            ? `<div class="budget-list">${pageItems.map(renderBudgetItem).join("")}</div>`
            : `<div class="empty-state empty-state-blank"></div>`
          }

          ${showSummary ? renderBudgetSummary(total) : ""}
        </div>
      </article>
    `;
  });

  if (summaryOnSeparatePage) {
    budgetPages.push(`
      <article class="sheet budget-page">
        ${renderSmallPageLogo()}
        <div class="sheet-content">
          <h2 class="page-title">Orçamento</h2>
          ${renderBudgetSummary(total)}
        </div>
      </article>
    `);
  }

  return budgetPages;
}

function renderBudgetSummary(total) {
  return `
    <div class="budget-investment-divider" aria-hidden="true"></div>

    <div class="total-box">
      <span>Investimento Floral</span>
      <span class="total-value">${formatMoney(total)}</span>
    </div>

    <div class="payment-box">
      <h3>Condições de pagamento</h3>
      ${state.payment.terms ? `<p>${escapeHtml(state.payment.terms)}</p>` : ""}
    </div>

    <p class="budget-note">Este orçamento é uma estimativa e os valores podem sofrer alterações.</p>
  `;
}

function paginateBudgetItems(items) {
  if (!items.length) return [];

  const pages = [];
  let currentPage = [];
  let currentHeight = 0;
  const maxPageHeight = getBudgetPageMaxHeightMm();

  items.forEach(item => {
    const itemHeight = estimateBudgetItemHeightMm(item);
    const shouldStartNewPage = currentPage.length > 0 && currentHeight + itemHeight > maxPageHeight;

    if (shouldStartNewPage) {
      pages.push(currentPage);
      currentPage = [];
      currentHeight = 0;
    }

    currentPage.push(item);
    currentHeight += itemHeight;
  });

  if (currentPage.length) pages.push(currentPage);
  return pages;
}

function getBudgetPageMaxHeightMm() {
  return 202;
}

function getBudgetSummaryHeightMm() {
  return 77;
}

function getBudgetPageUnits(items) {
  return getBudgetPageHeightMm(items);
}

function getBudgetPageHeightMm(items) {
  return items.reduce((sum, item) => sum + estimateBudgetItemHeightMm(item), 0);
}

function estimateBudgetItemHeightMm(item) {
  const nameLength = String(item.name || "").trim().length;
  const descriptionLength = String(item.description || "").trim().length;
  const nameLines = Math.max(1, Math.ceil(nameLength / 27));
  const descriptionLines = descriptionLength ? Math.max(1, Math.ceil(descriptionLength / 68)) : 1;

  return 14 + nameLines * 6.8 + descriptionLines * 7.2 + 4.5;
}

function renderBudgetItem(item) {
  return `
    <div class="budget-row">
      <div>
        ${item.name ? `<h3>${escapeHtml(item.name)}</h3>` : ""}
        <p>${escapeHtml(item.description || "")}</p>
      </div>
      <div class="budget-price">${formatMoney(parseMoney(item.price))}</div>
    </div>
  `;
}

function renderIncludedPages() {
  return renderTopicPages({
    title: "O que está incluso",
    className: "included-page",
    topics: state.includedTopics
  });
}

function renderExcludedPages() {
  return renderTopicPages({
    title: "O que não está incluso",
    className: "excluded-page",
    topics: state.excludedTopics
  });
}

function renderTopicPages({ title, className, topics }) {
  const cleanTopics = topics.filter(item => (item.text || "").trim());

  if (!cleanTopics.length) {
    return [`
      <article class="sheet ${className}">
        ${renderSmallPageLogo()}
        <div class="sheet-content">
          <h2 class="page-title">${title}</h2>
          <div class="empty-state empty-state-blank"></div>
        </div>
      </article>
    `];
  }

  return paginateTextTopics(cleanTopics).map(items => `
    <article class="sheet ${className}">
      ${renderSmallPageLogo()}
      <div class="sheet-content">
        <h2 class="page-title">${title}</h2>
        <div class="included-list">
          ${items.map(item => `
            <div class="included-item">
              <span>${escapeHtml(item.text)}</span>
            </div>
          `).join("")}
        </div>
      </div>
    </article>
  `);
}

function paginateTextTopics(topics) {
  const pages = [];
  let currentPage = [];
  let currentHeight = 0;
  const maxPageHeight = 204;

  topics.forEach(item => {
    const itemHeight = estimateTopicHeightMm(item.text);
    const shouldStartNewPage = currentPage.length > 0 && currentHeight + itemHeight > maxPageHeight;

    if (shouldStartNewPage) {
      pages.push(currentPage);
      currentPage = [];
      currentHeight = 0;
    }

    currentPage.push(item);
    currentHeight += itemHeight;
  });

  if (currentPage.length) pages.push(currentPage);
  return pages;
}

function estimateTopicHeightMm(text) {
  const length = String(text || "").trim().length;
  const lines = Math.max(1, Math.ceil(length / 82));
  return 12 + lines * 7.7 + 4;
}

function renderSignaturePage() {
  return `
    <article class="sheet signature-page">
      <div class="sheet-content">
        <div>
          <div class="signature-mark">Patricia Zeviani</div>
          <div class="signature-line"></div>
          <div class="signature-caption">Bouquet Flores</div>
        </div>
      </div>
    </article>
  `;
}

function applyTheme() {
  const mainColors = state.palette
    .filter(item => item.main && isValidHex(item.hex))
    .map(item => normalizeHex(item.hex));

  const validPalette = state.palette
    .filter(item => isValidHex(item.hex))
    .map(item => normalizeHex(item.hex));

  const primary = mainColors[0] || validPalette[0] || "#4d1225";
  const accent = shiftLightness(primary, -12);
  const primaryDark = shiftLightness(primary, -28);
  const primarySoft = mix(primary, "#ffffff", 0.72);
  const primaryPale = mix(primary, "#ffffff", 0.91);
  const paper = mix(primary, "#ffffff", 0.96);
  const border = mix(primary, "#ffffff", 0.78);
  const onPrimary = "#000000";
  const ink = "#000000";
  const muted = "#000000";

  const vars = {
    "--pdf-primary": primary,
    "--pdf-primary-dark": primaryDark,
    "--pdf-primary-soft": primarySoft,
    "--pdf-primary-pale": primaryPale,
    "--pdf-accent": accent,
    "--pdf-paper": paper,
    "--pdf-surface": "#ffffff",
    "--pdf-ink": ink,
    "--pdf-muted": muted,
    "--pdf-border": border,
    "--pdf-on-primary": onPrimary
  };

  Object.entries(vars).forEach(([key, value]) => {
    els.preview.style.setProperty(key, value);
  });
}

function ensureMainColor() {
  if (!state.palette.length) return;

  const firstMainIndex = state.palette.findIndex(item => item.main);

  if (firstMainIndex === -1) {
    state.palette[0].main = true;
    setStatus("Mantive uma cor principal marcada.");
    return;
  }

  state.palette.forEach((item, index) => {
    item.main = index === firstMainIndex;
  });
}

function saveRenderAll(scrollTargetId = null) {
  renderEditor();
  saveState();
  renderPreview();
  scrollToEditorItem(scrollTargetId);
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return structuredCloneSafe(defaultState);
    const parsed = JSON.parse(raw);
    return mergeState(structuredCloneSafe(defaultState), parsed);
  } catch (error) {
    return structuredCloneSafe(defaultState);
  }
}

function saveState({ markDirty = true } = {}) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    setStatus("Alterações salvas neste navegador");
  } catch (error) {
    try {
      const lightState = { ...state, inspirations: [] };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(lightState));
      setStatus("Dados salvos, mas imagens grandes não couberam no armazenamento do navegador.");
    } catch (innerError) {
      setStatus("Não foi possível salvar automaticamente neste navegador.");
    }
  }

  if (markDirty && appInitialized && !suppressRemoteDirty) {
    markRemoteDirty();
  }
}

function mergeState(base, incoming) {
  const merged = {
    ...base,
    ...incoming,
    cover: { ...base.cover, ...(incoming.cover || {}) },
    payment: { ...base.payment, ...(incoming.payment || {}) },
    coverFields: Array.isArray(incoming.coverFields) ? incoming.coverFields : base.coverFields,
    palette: Array.isArray(incoming.palette) ? incoming.palette.slice(0, 10) : base.palette,
    inspirations: Array.isArray(incoming.inspirations) ? incoming.inspirations : base.inspirations,
    budgetItems: Array.isArray(incoming.budgetItems) ? incoming.budgetItems : base.budgetItems,
    includedTopics: Array.isArray(incoming.includedTopics) ? incoming.includedTopics : base.includedTopics,
    excludedTopics: Array.isArray(incoming.excludedTopics) ? incoming.excludedTopics : base.excludedTopics
  };

  return removeLegacyExampleData(merged);
}

function removeLegacyExampleData(data) {
  const legacyCoverTitle = "Proposta de Orçamento Floral";
  const legacyCoverIntro = "Um projeto floral pensado para transformar o evento em uma experiência elegante, acolhedora e personalizada.";
  const legacyPayment = "Condições de pagamento a combinar.";
  const legacyBudgetDescription = "Descreva aqui os itens, ambientes ou arranjos previstos.";
  const legacyIncluded = [
    "Criação e montagem dos arranjos florais conforme proposta aprovada.",
    "Curadoria de flores e folhagens alinhadas à paleta escolhida."
  ];

  if (data.cover?.title === legacyCoverTitle) data.cover.title = "";
  if (data.cover?.intro === legacyCoverIntro) data.cover.intro = "";
  if (data.payment?.terms === legacyPayment) data.payment.terms = "";

  if (Array.isArray(data.coverFields) && data.coverFields.length === 4) {
    const legacyLabels = ["Cliente", "Evento", "Data do evento", "Local"];
    const isLegacyCover = data.coverFields.every((item, index) =>
      item.label === legacyLabels[index] && !String(item.value || "").trim()
    );
    if (isLegacyCover) data.coverFields = [];
  }

  if (Array.isArray(data.palette) && data.palette.length === 3) {
    const legacyPalette = [
      ["Marsala", "#4d1225", true],
      ["Creme", "#F5EBE3", false],
      ["Bronze", "#805630", false]
    ];
    const isLegacyPalette = data.palette.every((item, index) =>
      item.name === legacyPalette[index][0]
      && normalizeHex(item.hex).toUpperCase() === legacyPalette[index][1]
      && Boolean(item.main) === legacyPalette[index][2]
    );
    if (isLegacyPalette) data.palette = [];
  }

  if (Array.isArray(data.budgetItems) && data.budgetItems.length === 1) {
    const item = data.budgetItems[0];
    if (item.name === "Decoração floral" && item.description === legacyBudgetDescription && !String(item.price || "").trim()) {
      data.budgetItems = [];
    }
  }

  if (Array.isArray(data.includedTopics) && data.includedTopics.length === 2) {
    const isLegacyIncluded = data.includedTopics.every((item, index) => item.text === legacyIncluded[index]);
    if (isLegacyIncluded) data.includedTopics = [];
  }

  return data;
}

function handleBeforeUnload(event) {
  if (!remoteMeta.dirty) return;
  event.preventDefault();
  event.returnValue = "";
}

function createEmptyRemoteMeta() {
  return {
    id: null,
    title: "",
    savedAt: null,
    dirty: true
  };
}

function loadRemoteMeta() {
  try {
    const raw = localStorage.getItem(REMOTE_META_KEY);
    if (!raw) return createEmptyRemoteMeta();
    return { ...createEmptyRemoteMeta(), ...JSON.parse(raw) };
  } catch (error) {
    return createEmptyRemoteMeta();
  }
}

function saveRemoteMeta() {
  try {
    localStorage.setItem(REMOTE_META_KEY, JSON.stringify(remoteMeta));
  } catch (error) {
    // O app continua funcionando mesmo se o navegador negar o localStorage.
  }
}

function markRemoteDirty() {
  if (remoteMeta.dirty) {
    updateRemoteStatus();
    return;
  }

  remoteMeta.dirty = true;
  saveRemoteMeta();
  updateRemoteStatus();
}

function markRemoteSaved({ id, title, savedAt }) {
  remoteMeta = {
    id,
    title,
    savedAt,
    dirty: false
  };
  saveRemoteMeta();
  updateRemoteStatus();
}

function updateRemoteStatus(message = null, tone = null) {
  if (!els.remoteStatus) return;

  els.remoteStatus.classList.remove("is-dirty", "is-saved", "is-error");

  if (tone === "error") {
    els.remoteStatus.classList.add("is-error");
    els.remoteStatus.textContent = message || "Erro de conexão";
    return;
  }

  if (message) {
    if (message === "Alterações não salvas") {
      els.remoteStatus.classList.add("is-dirty");
    }
    els.remoteStatus.textContent = message;
    return;
  }

  if (remoteMeta.dirty) {
    els.remoteStatus.classList.add("is-dirty");
    els.remoteStatus.textContent = "Alterações não salvas";
    return;
  }

  els.remoteStatus.classList.add("is-saved");
  els.remoteStatus.textContent = remoteMeta.savedAt
    ? `Salvo às ${formatTime(remoteMeta.savedAt)}`
    : "Salvo";
}

function confirmDiscardUnsaved() {
  if (!remoteMeta.dirty) return true;
  return confirm("Existem alterações não salvas. Deseja continuar mesmo assim?");
}

function isSupabaseConfigured() {
  const config = window.ORCAMENTO_SUPABASE || {};
  return Boolean(
    config.url
    && config.anonKey
    && !String(config.url).includes("COLE_AQUI")
    && !String(config.anonKey).includes("COLE_AQUI")
  );
}

function getSupabaseClient() {
  if (supabaseClient) return supabaseClient;

  if (!window.supabase || !window.supabase.createClient) {
    throw new Error("Biblioteca do Supabase não carregada.");
  }

  if (!isSupabaseConfigured()) {
    throw new Error("Supabase ainda não foi configurado em supabase-config.js.");
  }

  const config = window.ORCAMENTO_SUPABASE;
  supabaseClient = window.supabase.createClient(config.url, config.anonKey);
  return supabaseClient;
}

function getSupabaseBucket() {
  return (window.ORCAMENTO_SUPABASE && window.ORCAMENTO_SUPABASE.bucket) || "orcamento-imagens";
}

function getDefaultSupabaseEmail() {
  return (window.ORCAMENTO_SUPABASE && window.ORCAMENTO_SUPABASE.defaultEmail) || "";
}

async function refreshAuthUi({ promptIfLoggedOut = false } = {}) {
  if (!els.btnLogout) return false;

  if (!isSupabaseConfigured()) {
    document.body.classList.add("auth-locked");
    els.btnLogout.classList.add("hidden");
    updateRemoteStatus("Configure o Supabase", "error");
    if (promptIfLoggedOut) {
      openAuthModal({ message: "Configure o arquivo supabase-config.js com a URL e a anon key do projeto antes de entrar." });
    }
    return false;
  }

  try {
    const client = getSupabaseClient();
    const { data } = await client.auth.getSession();
    const logged = Boolean(data.session);

    document.body.classList.toggle("auth-locked", !logged);
    els.btnLogout.classList.toggle("hidden", !logged);

    if (!logged && promptIfLoggedOut) {
      openAuthModal();
    }

    return logged;
  } catch (error) {
    document.body.classList.add("auth-locked");
    els.btnLogout.classList.add("hidden");
    updateRemoteStatus("Erro de conexão", "error");
    if (promptIfLoggedOut) {
      openAuthModal({ message: "Não foi possível verificar o login. Confira a conexão e tente novamente." });
    }
    return false;
  }
}

function openAuthModal({ message = "" } = {}) {
  els.authMessage.textContent = message;
  els.authPassword.value = "";

  if (!els.authModal.open) {
    els.authModal.showModal();
  }

  window.setTimeout(() => els.authPassword.focus(), 60);
}

async function handleAuthSubmit(event) {
  event.preventDefault();
  els.authMessage.textContent = "Entrando...";

  try {
    const client = getSupabaseClient();
    const email = getDefaultSupabaseEmail();
    const password = els.authPassword.value;

    if (!email) {
      throw new Error("E-mail padrão não configurado em supabase-config.js.");
    }

    const { error } = await client.auth.signInWithPassword({ email, password });
    if (error) throw error;

    els.authModal.close();
    els.authPassword.value = "";
    await refreshAuthUi();
    updateRemoteStatus(remoteMeta.dirty ? "Alterações não salvas" : null);
  } catch (error) {
    els.authMessage.textContent = `Não foi possível entrar: ${error.message || "verifique a senha e a conexão."}`;
    updateRemoteStatus("Erro de conexão", "error");
  }
}

async function logoutSupabase() {
  try {
    const client = getSupabaseClient();
    await client.auth.signOut();
  } catch (error) {
    // Ignora falha de logout local.
  }
  await refreshAuthUi({ promptIfLoggedOut: true });
}

async function ensureAuthenticated() {
  if (!isSupabaseConfigured()) {
    alert("Configure o arquivo supabase-config.js com a URL e a anon key do Supabase antes de salvar ou abrir orçamentos.");
    throw new Error("Supabase não configurado.");
  }

  const client = getSupabaseClient();
  const { data, error } = await client.auth.getUser();
  if (error || !data.user) {
    openAuthModal();
    throw new Error("Faça login no Supabase e tente novamente.");
  }

  return { client, user: data.user };
}

async function handleSaveRemoteClick() {
  const title = getCurrentBudgetTitle();
  if (!title) {
    alert("Preencha o título do documento antes de salvar o orçamento.");
    return;
  }

  if (remoteMeta.id && remoteMeta.dirty) {
    openSaveChoiceModal();
    return;
  }

  await saveRemoteBudget({ asNew: false });
}

function openSaveChoiceModal() {
  els.saveChoiceModal.showModal();
}

function handleModalAction(action, id) {
  if (action === "close-saved-budgets") {
    els.savedBudgetsModal.close();
    return true;
  }

  if (action === "cancel-save-choice") {
    els.saveChoiceModal.close();
    return true;
  }

  if (action === "save-existing-budget") {
    els.saveChoiceModal.close();
    saveRemoteBudget({ asNew: false });
    return true;
  }

  if (action === "save-as-new-budget") {
    els.saveChoiceModal.close();
    saveRemoteBudget({ asNew: true });
    return true;
  }

  if (action === "open-saved-budget") {
    openSavedBudget(id);
    return true;
  }

  if (action === "delete-saved-budget") {
    deleteSavedBudget(id);
    return true;
  }

  return false;
}

async function saveRemoteBudget({ asNew }) {
  const title = getCurrentBudgetTitle();
  if (!title) {
    alert("Preencha o título do documento antes de salvar o orçamento.");
    return;
  }

  const previousText = els.btnSaveRemote.textContent;
  els.btnSaveRemote.disabled = true;
  els.btnSaveRemote.textContent = "Salvando...";
  updateRemoteStatus("Salvando...");

  try {
    const { client, user } = await ensureAuthenticated();
    const budgetId = asNew || !remoteMeta.id ? cryptoUuid() : remoteMeta.id;
    const preparedState = await prepareStateForRemoteSave(client, user, budgetId);

    const payload = {
      id: budgetId,
      user_id: user.id,
      titulo: title,
      dados: preparedState,
      updated_at: new Date().toISOString()
    };

    const { data, error } = await client
      .from(SUPABASE_TABLE)
      .upsert(payload, { onConflict: "id" })
      .select("id,titulo,updated_at")
      .single();

    if (error) throw error;

    suppressRemoteDirty = true;
    state = preparedState;
    saveState();
    suppressRemoteDirty = false;
    renderEditor();
    renderPreview();
    markRemoteSaved({ id: data.id, title: data.titulo, savedAt: data.updated_at });
    await refreshSavedBudgetsList(false);
  } catch (error) {
    console.error(error);
    alert(`Não foi possível salvar. Verifique a conexão e a configuração do Supabase.\n\nDetalhe: ${error.message || error}`);
    updateRemoteStatus("Erro ao salvar", "error");
  } finally {
    suppressRemoteDirty = false;
    els.btnSaveRemote.disabled = false;
    els.btnSaveRemote.textContent = previousText;
  }
}

async function openSavedBudgetsModal() {
  try {
    await ensureAuthenticated();
  } catch (error) {
    return;
  }

  els.savedBudgetSearch.value = "";
  els.savedBudgetsList.innerHTML = `<p class="hint">Carregando orçamentos...</p>`;
  els.savedBudgetsModal.showModal();
  await refreshSavedBudgetsList(true);
}

async function refreshSavedBudgetsList(showErrors) {
  try {
    const { client } = await ensureAuthenticated();
    const { data, error } = await client
      .from(SUPABASE_TABLE)
      .select("id,titulo,created_at,updated_at")
      .order("updated_at", { ascending: false });

    if (error) throw error;

    savedBudgetsCache = Array.isArray(data) ? data : [];
    renderSavedBudgetsList();
  } catch (error) {
    console.error(error);
    if (showErrors) {
      els.savedBudgetsList.innerHTML = `<p class="hint">Não foi possível carregar. Verifique a conexão.</p>`;
      updateRemoteStatus("Erro ao carregar", "error");
    }
  }
}

function renderSavedBudgetsList() {
  if (!els.savedBudgetsList) return;

  const search = normalizeSearch(els.savedBudgetSearch.value);
  const filtered = savedBudgetsCache.filter(item => normalizeSearch(item.titulo).includes(search));

  if (!filtered.length) {
    els.savedBudgetsList.innerHTML = `<p class="hint">Nenhum orçamento salvo encontrado.</p>`;
    return;
  }

  els.savedBudgetsList.innerHTML = filtered.map(item => `
    <div class="saved-budget-card">
      <div>
        <strong>${escapeHtml(item.titulo || "Sem título")}</strong>
        <span>Atualizado em ${formatDateTime(item.updated_at)}</span>
      </div>
      <div class="saved-budget-actions">
        <button class="mini" type="button" data-action="open-saved-budget" data-id="${attr(item.id)}">Abrir</button>
        <button class="mini danger" type="button" data-action="delete-saved-budget" data-id="${attr(item.id)}">Excluir</button>
      </div>
    </div>
  `).join("");
}

async function openSavedBudget(id) {
  if (!confirmDiscardUnsaved()) return;

  try {
    const { client } = await ensureAuthenticated();
    updateRemoteStatus("Abrindo...");

    const { data, error } = await client
      .from(SUPABASE_TABLE)
      .select("id,titulo,dados,updated_at")
      .eq("id", id)
      .single();

    if (error) throw error;

    suppressRemoteDirty = true;
    state = mergeState(structuredCloneSafe(defaultState), data.dados || {});
    await hydrateStoredInspirationImages(client, state);
    saveState();
    suppressRemoteDirty = false;
    renderEditor();
    renderPreview();
    markRemoteSaved({ id: data.id, title: data.titulo, savedAt: data.updated_at });
    els.savedBudgetsModal.close();
  } catch (error) {
    console.error(error);
    alert(`Não foi possível abrir o orçamento. Verifique a conexão.\n\nDetalhe: ${error.message || error}`);
    updateRemoteStatus("Erro ao abrir", "error");
  } finally {
    suppressRemoteDirty = false;
  }
}

async function deleteSavedBudget(id) {
  const budget = savedBudgetsCache.find(item => item.id === id);
  const label = budget && budget.titulo ? `"${budget.titulo}"` : "este orçamento";
  const ok = confirm(`Excluir ${label}? Esta ação não pode ser desfeita.`);
  if (!ok) return;

  try {
    const { client, user } = await ensureAuthenticated();
    updateRemoteStatus("Excluindo...");

    await removeBudgetStorageFiles(client, user, id);

    const { error } = await client
      .from(SUPABASE_TABLE)
      .delete()
      .eq("id", id);

    if (error) throw error;

    savedBudgetsCache = savedBudgetsCache.filter(item => item.id !== id);
    renderSavedBudgetsList();

    if (remoteMeta.id === id) {
      remoteMeta = createEmptyRemoteMeta();
      saveRemoteMeta();
      updateRemoteStatus();
    } else {
      updateRemoteStatus(remoteMeta.dirty ? "Alterações não salvas" : null);
    }
  } catch (error) {
    console.error(error);
    alert(`Não foi possível excluir. Verifique a conexão.\n\nDetalhe: ${error.message || error}`);
    updateRemoteStatus("Erro ao excluir", "error");
  }
}


async function hydrateStoredInspirationImages(client, targetState) {
  if (!targetState || !Array.isArray(targetState.inspirations) || !targetState.inspirations.length) return;

  const bucket = getSupabaseBucket();

  await Promise.all(targetState.inspirations.map(async item => {
    if (!item || typeof item !== "object") return;

    const currentSource = resolveImageSource(item);
    const hasStoragePath = Boolean(item.storagePath);

    if (currentSource && !hasStoragePath) {
      item.dataUrl = currentSource;
      return;
    }

    if (!hasStoragePath) {
      if (item.publicUrl) item.dataUrl = item.publicUrl;
      return;
    }

    try {
      const { data, error } = await client.storage
        .from(bucket)
        .createSignedUrl(item.storagePath, 60 * 60 * 24 * 7);

      if (!error && data && data.signedUrl) {
        item.dataUrl = data.signedUrl;
        item.signedUrl = data.signedUrl;
        return;
      }
    } catch (error) {
      // Se a URL assinada falhar, tentamos a URL pública abaixo.
    }

    const publicUrl = getStoragePublicUrl(item.storagePath, client);
    if (publicUrl) {
      item.dataUrl = publicUrl;
      item.publicUrl = publicUrl;
      return;
    }

    if (item.publicUrl) item.dataUrl = item.publicUrl;
  }));
}

function resolveImageSource(item) {
  if (!item || typeof item !== "object") return "";

  const candidates = [
    item.dataUrl,
    item.publicUrl,
    item.signedUrl,
    item.url,
    item.src
  ];

  for (const candidate of candidates) {
    const value = String(candidate || "").trim();
    if (isUsableImageSource(value)) return value;
  }

  if (item.storagePath) {
    const publicUrl = getStoragePublicUrl(item.storagePath);
    if (publicUrl) return publicUrl;
  }

  return "";
}

function isUsableImageSource(value) {
  return /^(data:image\/|blob:|https?:\/\/)/i.test(String(value || "").trim());
}

function getStoragePublicUrl(path, client = supabaseClient) {
  if (!path || !client || !client.storage) return "";

  try {
    const { data } = client.storage
      .from(getSupabaseBucket())
      .getPublicUrl(path);

    return data && data.publicUrl ? data.publicUrl : "";
  } catch (error) {
    return "";
  }
}

async function prepareStateForRemoteSave(client, user, budgetId) {
  const prepared = structuredCloneSafe(state);
  prepared.inspirations = [];

  for (const item of state.inspirations) {
    const nextItem = { ...item };

    if (isDataUrl(nextItem.dataUrl)) {
      const blob = dataUrlToBlob(nextItem.dataUrl);
      const extension = mimeToExtension(blob.type);
      const path = `${user.id}/${budgetId}/${nextItem.id || cryptoId()}.${extension}`;

      const { error: uploadError } = await client.storage
        .from(getSupabaseBucket())
        .upload(path, blob, {
          contentType: blob.type || "image/jpeg",
          upsert: true
        });

      if (uploadError) throw uploadError;

      const { data: publicData } = client.storage
        .from(getSupabaseBucket())
        .getPublicUrl(path);

      nextItem.storagePath = path;
      nextItem.dataUrl = publicData.publicUrl;
      nextItem.publicUrl = publicData.publicUrl;
    }

    prepared.inspirations.push(nextItem);
  }

  return prepared;
}

async function removeBudgetStorageFiles(client, user, budgetId) {
  try {
    const folder = `${user.id}/${budgetId}`;
    const { data, error } = await client.storage
      .from(getSupabaseBucket())
      .list(folder, { limit: 1000 });

    if (error || !Array.isArray(data) || !data.length) return;

    const paths = data.map(item => `${folder}/${item.name}`);
    await client.storage.from(getSupabaseBucket()).remove(paths);
  } catch (error) {
    // A exclusão do registro principal não deve falhar se a limpeza do Storage não conseguir listar os arquivos.
  }
}

function getCurrentBudgetTitle() {
  const title = String(state.cover && state.cover.title ? state.cover.title : "").trim();
  const subtitle = String(state.cover && state.cover.subtitle ? state.cover.subtitle : "").trim();
  return [title, subtitle].filter(Boolean).join(" - ").trim();
}

function isDataUrl(value) {
  return /^data:image\//i.test(String(value || ""));
}

function dataUrlToBlob(dataUrl) {
  const [meta, base64] = String(dataUrl).split(",");
  const mimeMatch = meta.match(/data:(.*?);base64/i);
  const mime = mimeMatch ? mimeMatch[1] : "image/jpeg";
  const binary = atob(base64 || "");
  const bytes = new Uint8Array(binary.length);

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }

  return new Blob([bytes], { type: mime });
}

function mimeToExtension(mime) {
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/gif") return "gif";
  return "jpg";
}

function formatTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
}

function formatDateTime(value) {
  if (!value) return "data indisponível";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "data indisponível";
  return date.toLocaleString("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  });
}

function normalizeSearch(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

function cryptoUuid() {
  if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();

  return "10000000-1000-4000-8000-100000000000".replace(/[018]/g, c =>
    (Number(c) ^ crypto.getRandomValues(new Uint8Array(1))[0] & 15 >> Number(c) / 4).toString(16)
  );
}


function setStatus(message) {
  els.saveStatus.textContent = message;
}

function parseMoney(value) {
  if (typeof value === "number") return value;
  const text = String(value || "").trim();
  if (!text) return 0;

  const cleaned = text
    .replace(/[^\d,.-]/g, "")
    .replace(/\.(?=\d{3}(\D|$))/g, "")
    .replace(",", ".");

  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatMoney(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL"
  }).format(Number.isFinite(value) ? value : 0);
}

function buildPdfFileName() {
  const title = String(state.cover.title || "").trim();
  const subtitle = String(state.cover.subtitle || "").trim();
  const parts = [title, subtitle].filter(Boolean);

  return sanitizeFileName(parts.join(" - ") || "orcamento-floral");
}

function sanitizeFileName(value) {
  const clean = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9-_ ]/g, "")
    .trim()
    .replace(/\s+/g, "-")
    .toLowerCase();

  return clean || "orcamento-floral";
}

function cryptoId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return `id-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function structuredCloneSafe(obj) {
  if (window.structuredClone) return structuredClone(obj);
  return JSON.parse(JSON.stringify(obj));
}

function chunk(array, size) {
  const pages = [];
  for (let i = 0; i < array.length; i += size) {
    pages.push(array.slice(i, i + size));
  }
  return pages;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function cssEscape(value) {
  if (window.CSS && typeof CSS.escape === "function") return CSS.escape(value);
  return String(value).replace(/[^a-zA-Z0-9_-]/g, "\$&");
}

function attr(value) {
  return escapeHtml(value);
}

function normalizeHex(hex) {
  const text = String(hex || "").trim();
  if (/^#[0-9a-fA-F]{6}$/.test(text)) return text;
  if (/^[0-9a-fA-F]{6}$/.test(text)) return `#${text}`;
  if (/^#[0-9a-fA-F]{3}$/.test(text)) {
    return `#${text[1]}${text[1]}${text[2]}${text[2]}${text[3]}${text[3]}`;
  }
  return "#4d1225";
}

function isValidHex(hex) {
  return /^#[0-9a-fA-F]{6}$/.test(normalizeHex(hex));
}

function hexToRgb(hex) {
  const value = normalizeHex(hex).slice(1);
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }) {
  const toHex = value => Math.round(clamp(value, 0, 255)).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function mix(hexA, hexB, amountToB) {
  const a = hexToRgb(hexA);
  const b = hexToRgb(hexB);
  const t = clamp(amountToB, 0, 1);
  return rgbToHex({
    r: a.r + (b.r - a.r) * t,
    g: a.g + (b.g - a.g) * t,
    b: a.b + (b.b - a.b) * t
  });
}

function luminance(hex) {
  const { r, g, b } = hexToRgb(hex);
  const transform = value => {
    const s = value / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * transform(r) + 0.7152 * transform(g) + 0.0722 * transform(b);
}

function bestTextColor(backgroundHex) {
  return luminance(backgroundHex) > 0.54 ? "#211719" : "#ffffff";
}

function rgbToHsl({ r, g, b }) {
  r /= 255;
  g /= 255;
  b /= 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const d = max - min;
    s = l > .5 ? d / (2 - max - min) : d / (max + min);

    switch (max) {
      case r:
        h = (g - b) / d + (g < b ? 6 : 0);
        break;
      case g:
        h = (b - r) / d + 2;
        break;
      default:
        h = (r - g) / d + 4;
    }

    h /= 6;
  }

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function hslToRgb({ h, s, l }) {
  h = ((h % 360) + 360) % 360;
  s = clamp(s, 0, 100) / 100;
  l = clamp(l, 0, 100) / 100;

  if (s === 0) {
    const grey = l * 255;
    return { r: grey, g: grey, b: grey };
  }

  const hueToRgb = (p, q, t) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < .5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;
  const hue = h / 360;

  return {
    r: hueToRgb(p, q, hue + 1 / 3) * 255,
    g: hueToRgb(p, q, hue) * 255,
    b: hueToRgb(p, q, hue - 1 / 3) * 255
  };
}

function shiftLightness(hex, amount) {
  const hsl = rgbToHsl(hexToRgb(hex));
  hsl.l = clamp(hsl.l + amount, 6, 94);
  if (hsl.s < 10) hsl.s = 12;
  return rgbToHex(hslToRgb(hsl));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isLongField(value) {
  return String(value || "").length > 48 || String(value || "").includes("\n");
}
