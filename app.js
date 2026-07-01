const STORAGE_KEY = "orcamento-floral-v2";
const LOGO_SRC = "assets/logo_bouquet_flores.png";

const defaultState = {
  cover: {
    title: "",
    intro: ""
  },
  coverFields: [],
  palette: [],
  inspirations: [],
  budgetItems: [],
  payment: {
    terms: ""
  },
  includedTopics: []
};

let state = loadState();

const els = {
  preview: document.getElementById("pdfPreview"),
  saveStatus: document.getElementById("saveStatus"),
  coverFieldsEditor: document.getElementById("coverFieldsEditor"),
  paletteEditor: document.getElementById("paletteEditor"),
  inspirationsEditor: document.getElementById("inspirationsEditor"),
  budgetEditor: document.getElementById("budgetEditor"),
  includedEditor: document.getElementById("includedEditor"),
  inspirationInput: document.getElementById("inspirationInput"),
  btnPrint: document.getElementById("btnPrint"),
  btnFakeData: document.getElementById("btnFakeData"),
  btnReset: document.getElementById("btnReset"),
  btnAddCoverField: document.getElementById("btnAddCoverField"),
  btnAddColor: document.getElementById("btnAddColor"),
  btnAddBudgetItem: document.getElementById("btnAddBudgetItem"),
  btnAddIncluded: document.getElementById("btnAddIncluded")
};

init();

function init() {
  ensureMainColor();
  renderEditor();
  renderPreview();
  bindEvents();
}

function bindEvents() {
  document.body.addEventListener("input", handleInput);
  document.body.addEventListener("change", handleChange);
  document.body.addEventListener("click", handleClick);

  els.inspirationInput.addEventListener("change", handleImageUpload);

  els.btnPrint.addEventListener("click", async () => {
    renderPreview();
    await waitForFonts();
    window.print();
  });

  els.btnFakeData.addEventListener("click", () => {
    const ok = confirm("Preencher o programa com dados fictícios para teste? Isso substituirá os dados atuais neste navegador.");
    if (!ok) return;
    state = createFakeState();
    saveState();
    renderEditor();
    renderPreview();
  });

  els.btnReset.addEventListener("click", () => {
    const ok = confirm("Limpar todos os dados salvos neste navegador?");
    if (!ok) return;
    state = structuredCloneSafe(defaultState);
    saveState();
    renderEditor();
    renderPreview();
  });

  els.btnAddCoverField.addEventListener("click", () => {
    state.coverFields.push({ id: cryptoId(), label: "", value: "" });
    saveRenderAll();
  });

  els.btnAddColor.addEventListener("click", () => {
    if (state.palette.length >= 10) {
      setStatus("Limite de 10 cores atingido.");
      return;
    }
    state.palette.push({ id: cryptoId(), name: "", hex: "#7D1225", main: state.palette.length === 0 });
    ensureMainColor();
    saveRenderAll();
  });

  els.btnAddBudgetItem.addEventListener("click", () => {
    state.budgetItems.push({ id: cryptoId(), name: "", description: "", price: "" });
    saveRenderAll();
  });

  els.btnAddIncluded.addEventListener("click", () => {
    state.includedTopics.push({ id: cryptoId(), text: "" });
    saveRenderAll();
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

  saveState();
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

  saveRenderAll();
}

function handleImageUpload(event) {
  const files = Array.from(event.target.files || []);
  if (!files.length) return;

  let pending = files.length;

  files.forEach(file => {
    if (!file.type.startsWith("image/")) {
      pending -= 1;
      return;
    }

    const reader = new FileReader();
    reader.onload = () => {
      state.inspirations.push({
        id: cryptoId(),
        name: file.name,
        dataUrl: reader.result
      });

      pending -= 1;
      if (pending === 0) {
        event.target.value = "";
        saveRenderAll();
      }
    };

    reader.onerror = () => {
      pending -= 1;
      if (pending === 0) {
        event.target.value = "";
        saveRenderAll();
      }
    };

    reader.readAsDataURL(file);
  });
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

function renderEditor() {
  document.querySelector('[data-section="cover"][data-field="title"]').value = state.cover.title || "";
  document.querySelector('[data-section="cover"][data-field="intro"]').value = state.cover.intro || "";
  document.querySelector('[data-section="payment"][data-field="terms"]').value = state.payment.terms || "";

  els.coverFieldsEditor.innerHTML = state.coverFields.map(item => `
    <div class="editor-card">
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
        <button class="mini danger" type="button" data-action="remove-cover-field" data-id="${item.id}">Remover</button>
      </div>
    </div>
  `).join("");

  els.paletteEditor.innerHTML = state.palette.map((item, index) => `
    <div class="editor-card">
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
        <button class="mini danger" type="button" data-action="remove-color" data-id="${item.id}" ${state.palette.length <= 1 ? "disabled" : ""}>Remover</button>
      </div>
    </div>
  `).join("");

  els.btnAddColor.disabled = state.palette.length >= 10;

  els.inspirationsEditor.innerHTML = state.inspirations.length
    ? state.inspirations.map(item => `
      <div class="image-chip">
        <img src="${attr(item.dataUrl)}" alt="${attr(item.name || "Inspiração")}">
        <button type="button" data-action="remove-inspiration" data-id="${item.id}">Remover</button>
      </div>
    `).join("")
    : `<p class="hint">Nenhuma imagem adicionada ainda.</p>`;

  els.budgetEditor.innerHTML = state.budgetItems.map(item => `
    <div class="editor-card">
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
        <button class="mini danger" type="button" data-action="remove-budget-item" data-id="${item.id}">Remover</button>
      </div>
    </div>
  `).join("");

  els.includedEditor.innerHTML = state.includedTopics.map(item => `
    <div class="editor-card">
      <div class="card-grid one">
        <label>
          Tópico
          <textarea rows="2" data-section="includedTopics" data-id="${item.id}" data-field="text">${escapeHtml(item.text)}</textarea>
        </label>
      </div>
      <div class="actions">
        <button class="mini danger" type="button" data-action="remove-included" data-id="${item.id}">Remover</button>
      </div>
    </div>
  `).join("");
}

function renderPreview() {
  applyTheme();

  const pages = [
    renderCoverPage(),
    renderPalettePage(),
    ...renderInspirationPages(),
    ...renderBudgetPages(),
    ...renderIncludedPages(),
    renderSignaturePage()
  ];

  els.preview.innerHTML = pages.join("");
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

  return chunk(state.inspirations, 6).map((items, pageIndex) => `
    <article class="sheet inspiration-page">
      ${renderSmallPageLogo()}
      <div class="sheet-content">
        <h2 class="page-title">Inspirações</h2>
        <div class="inspiration-grid">
          ${items.map(item => `<div class="inspiration-slot"><img src="${attr(item.dataUrl)}" alt="${attr(item.name || "Inspiração")}"></div>`).join("")}
        </div>
      </div>
    </article>
  `);
}

function renderBudgetPages() {
  const items = state.budgetItems.filter(item => item.name || item.description || item.price);
  const pages = chunk(items, 5);
  const total = items.reduce((sum, item) => sum + parseMoney(item.price), 0);

  if (!items.length) {
    pages.push([]);
  }

  return pages.map((pageItems, index) => {
    const isLast = index === pages.length - 1;
    return `
      <article class="sheet budget-page">
        ${renderSmallPageLogo()}
        <div class="sheet-content">
          <h2 class="page-title">Orçamento</h2>

          ${pageItems.length
            ? `<div class="budget-list">${pageItems.map(renderBudgetItem).join("")}</div>`
            : `<div class="empty-state empty-state-blank"></div>`
          }

          ${isLast ? `
            <div class="total-box">
              <span>Investimento Floral</span>
              <span class="total-value">${formatMoney(total)}</span>
            </div>

            <div class="payment-box">
              <h3>Condições de pagamento</h3>
              ${state.payment.terms ? `<p>${escapeHtml(state.payment.terms)}</p>` : ""}
            </div>
          ` : ""}
        </div>
      </article>
    `;
  });
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
  const topics = state.includedTopics.filter(item => (item.text || "").trim());

  if (!topics.length) {
    return [`
      <article class="sheet included-page">
        ${renderSmallPageLogo()}
        <div class="sheet-content">
          <h2 class="page-title">O que está incluso no orçamento</h2>
          <div class="empty-state empty-state-blank"></div>
        </div>
      </article>
    `];
  }

  return chunk(topics, 10).map((items, pageIndex) => `
    <article class="sheet included-page">
      ${renderSmallPageLogo()}
      <div class="sheet-content">
        <h2 class="page-title">O que está incluso no orçamento</h2>
        <div class="included-list">
          ${items.map((item, index) => `
            <div class="included-item">
              <span class="included-bullet">${pageIndex * 10 + index + 1}</span>
              <span>${escapeHtml(item.text)}</span>
            </div>
          `).join("")}
        </div>
      </div>
    </article>
  `);
}

function renderSignaturePage() {
  return `
    <article class="sheet signature-page">
      ${renderSmallPageLogo()}
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

  const primary = mainColors[0] || validPalette[0] || "#7D1225";
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

function saveRenderAll() {
  renderEditor();
  saveState();
  renderPreview();
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

function saveState() {
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
    includedTopics: Array.isArray(incoming.includedTopics) ? incoming.includedTopics : base.includedTopics
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
      ["Marsala", "#7D1225", true],
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

function createFakeState() {
  const palette = [
    { id: cryptoId(), name: "Marsala", hex: "#7D1225", main: true },
    { id: cryptoId(), name: "Creme", hex: "#F5EBE3", main: false },
    { id: cryptoId(), name: "Bronze", hex: "#805630", main: false },
    { id: cryptoId(), name: "Verde oliva", hex: "#6F7A45", main: false }
  ];

  return {
    cover: {
      title: "Proposta de Orçamento Floral",
      intro: "Projeto floral personalizado para compor uma celebração elegante, acolhedora e alinhada à identidade visual do evento."
    },
    coverFields: [
      { id: cryptoId(), label: "Cliente", value: "Mariana e Rafael" },
      { id: cryptoId(), label: "Evento", value: "Casamento intimista" },
      { id: cryptoId(), label: "Data do evento", value: "18/10/2026" },
      { id: cryptoId(), label: "Local", value: "Ribeirão Preto/SP" }
    ],
    palette,
    inspirations: [
      createFakeInspiration(1, "Mesa floral", "#7D1225", "#F5EBE3"),
      createFakeInspiration(2, "Arranjo aéreo", "#805630", "#F5EBE3"),
      createFakeInspiration(3, "Cerimônia", "#6F7A45", "#F5EBE3"),
      createFakeInspiration(4, "Buquê", "#7D1225", "#805630"),
      createFakeInspiration(5, "Recepção", "#F5EBE3", "#7D1225"),
      createFakeInspiration(6, "Detalhes", "#805630", "#7D1225")
    ],
    budgetItems: [
      {
        id: cryptoId(),
        name: "Mesa do bolo",
        description: "Composição floral com arranjos baixos, folhagens e flores naturais na paleta escolhida.",
        price: "1850,00"
      },
      {
        id: cryptoId(),
        name: "Cerimônia",
        description: "Arranjos laterais para corredor, flores no altar e acabamento com folhagens.",
        price: "2400,00"
      },
      {
        id: cryptoId(),
        name: "Mesas dos convidados",
        description: "Centros de mesa florais com vasos baixos e composição delicada para recepção.",
        price: "3200,00"
      }
    ],
    payment: {
      terms: "50% na aprovação da proposta e 50% até 7 dias antes do evento."
    },
    includedTopics: [
      { id: cryptoId(), text: "Criação do conceito floral conforme paleta aprovada." },
      { id: cryptoId(), text: "Compra, preparo e curadoria das flores e folhagens." },
      { id: cryptoId(), text: "Montagem no local do evento conforme cronograma combinado." },
      { id: cryptoId(), text: "Desmontagem dos arranjos ao final do evento." }
    ]
  };
}

function createFakeInspiration(index, name, primary, accent) {
  const safeName = escapeHtml(name);
  const svg = `
    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 900 620">
      <defs>
        <linearGradient id="bg${index}" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stop-color="${accent}"/>
          <stop offset="1" stop-color="#fffaf6"/>
        </linearGradient>
      </defs>
      <rect width="900" height="620" fill="url(#bg${index})"/>
      <circle cx="${250 + index * 18}" cy="250" r="120" fill="${primary}" opacity="0.92"/>
      <circle cx="${350 + index * 10}" cy="230" r="92" fill="${primary}" opacity="0.74"/>
      <circle cx="${420 + index * 6}" cy="330" r="110" fill="${primary}" opacity="0.58"/>
      <path d="M160 480 C320 340, 520 560, 740 360" fill="none" stroke="#805630" stroke-width="24" stroke-linecap="round" opacity="0.75"/>
      <text x="70" y="560" font-family="Arial, sans-serif" font-size="42" fill="#2c2020" opacity="0.75">${safeName}</text>
    </svg>
  `.trim();

  return {
    id: cryptoId(),
    name,
    dataUrl: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`
  };
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
  return "#7D1225";
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
