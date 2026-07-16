/* Gerador local de PDF para o Auxiliar de Orçamento Floral.
   A geração usa a pré-visualização como fonte da verdade, mas NÃO usa
   SVG/foreignObject. Isso evita o erro de canvas contaminado no Android. */
(function () {
  "use strict";

  const MM_TO_PT = 72 / 25.4;
  const PAGE_WIDTH_MM = 210;
  const PAGE_HEIGHT_MM = 297;
  const PAGE_WIDTH_PT = PAGE_WIDTH_MM * MM_TO_PT;
  const PAGE_HEIGHT_PT = PAGE_HEIGHT_MM * MM_TO_PT;
  const DEFAULT_PAGE_WIDTH_PX = 794;
  const DEFAULT_PAGE_HEIGHT_PX = 1123;
  const BLANK_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=";
  const imageCache = new Map();

  function textEncoderBytes(text) {
    const value = String(text || "");
    const bytes = new Uint8Array(value.length);
    for (let i = 0; i < value.length; i += 1) bytes[i] = value.charCodeAt(i) & 0xff;
    return bytes;
  }

  function concatBytes(parts) {
    const length = parts.reduce((sum, part) => sum + part.length, 0);
    const out = new Uint8Array(length);
    let offset = 0;
    for (const part of parts) {
      out.set(part, offset);
      offset += part.length;
    }
    return out;
  }

  function base64ToBytes(base64) {
    const clean = String(base64 || "").replace(/\s/g, "");
    const binary = atob(clean);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }

  function dataUrlToBytes(dataUrl) {
    const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/);
    if (!match) throw new Error("Imagem do PDF inválida");
    return { mime: match[1].toLowerCase(), bytes: base64ToBytes(match[2]) };
  }

  function getJpegSize(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { width: 1, height: 1 };
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      const length = (bytes[i + 2] << 8) + bytes[i + 3];
      if (!length || length < 2) break;
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        return {
          height: (bytes[i + 5] << 8) + bytes[i + 6],
          width: (bytes[i + 7] << 8) + bytes[i + 8]
        };
      }
      i += 2 + length;
    }
    return { width: 1, height: 1 };
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Falha ao ler imagem"));
      reader.readAsDataURL(blob);
    });
  }

  function loadImage(src, timeout = 20000) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Tempo esgotado ao carregar imagem"));
      }, timeout);
      img.decoding = "async";
      img.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(img);
      };
      img.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("Falha ao carregar imagem"));
      };
      img.src = src;
    });
  }

  function isActuallyVisible(element) {
    if (!element || element.nodeType !== 1) return false;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden" || Number(style.opacity) === 0) return false;
    const rect = element.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function parseCssColor(value) {
    const color = String(value || "").trim();
    if (!color || color === "transparent") return null;
    if (/rgba?\(/i.test(color)) {
      const nums = color.match(/[\d.]+/g) || [];
      if (nums.length >= 4 && Number(nums[3]) === 0) return null;
    }
    return color;
  }

  function parsePx(value) {
    const n = Number.parseFloat(String(value || "0"));
    return Number.isFinite(n) ? n : 0;
  }

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function getPageMapper(page, targetWidth, targetHeight) {
    const pageRect = page.getBoundingClientRect();
    const scaleX = targetWidth / Math.max(1, pageRect.width);
    const scaleY = targetHeight / Math.max(1, pageRect.height);
    return {
      pageRect,
      x(value) { return (value - pageRect.left) * scaleX; },
      y(value) { return (value - pageRect.top) * scaleY; },
      w(value) { return value * scaleX; },
      h(value) { return value * scaleY; },
      scaleX,
      scaleY
    };
  }

  function rectToPage(rect, map) {
    const x = map.x(rect.left);
    const y = map.y(rect.top);
    const width = map.w(rect.width);
    const height = map.h(rect.height);
    return { x, y, width, height, right: x + width, bottom: y + height };
  }

  function intersectsPage(rect, targetWidth, targetHeight) {
    return rect.right > 0 && rect.bottom > 0 && rect.x < targetWidth && rect.y < targetHeight;
  }

  function parseRadiusPx(value, map) {
    const first = String(value || "0").split("/")[0].trim().split(/\s+/)[0];
    return parsePx(first) * ((map.scaleX + map.scaleY) / 2);
  }

  function cornerRadiiPx(style, map) {
    return {
      tl: parseRadiusPx(style.borderTopLeftRadius, map),
      tr: parseRadiusPx(style.borderTopRightRadius, map),
      br: parseRadiusPx(style.borderBottomRightRadius, map),
      bl: parseRadiusPx(style.borderBottomLeftRadius, map)
    };
  }

  function hasRadius(radii) {
    return radii && (radii.tl || radii.tr || radii.br || radii.bl);
  }

  function normalizeRadii(width, height, radii) {
    const max = Math.max(0, Math.min(width, height) / 2);
    return {
      tl: clamp(radii.tl || 0, 0, max),
      tr: clamp(radii.tr || 0, 0, max),
      br: clamp(radii.br || 0, 0, max),
      bl: clamp(radii.bl || 0, 0, max)
    };
  }

  function roundedRectPath(ctx, x, y, width, height, radius) {
    const r = typeof radius === "object" ? normalizeRadii(width, height, radius) : normalizeRadii(width, height, { tl: radius, tr: radius, br: radius, bl: radius });
    ctx.beginPath();
    ctx.moveTo(x + r.tl, y);
    ctx.lineTo(x + width - r.tr, y);
    ctx.quadraticCurveTo(x + width, y, x + width, y + r.tr);
    ctx.lineTo(x + width, y + height - r.br);
    ctx.quadraticCurveTo(x + width, y + height, x + width - r.br, y + height);
    ctx.lineTo(x + r.bl, y + height);
    ctx.quadraticCurveTo(x, y + height, x, y + height - r.bl);
    ctx.lineTo(x, y + r.tl);
    ctx.quadraticCurveTo(x, y, x + r.tl, y);
    ctx.closePath();
  }

  function inheritedClipRadii(element, ownRadii, map) {
    if (hasRadius(ownRadii)) return ownRadii;

    const parent = element && element.parentElement;
    if (!parent) return ownRadii;

    const parentStyle = getComputedStyle(parent);
    const overflowClips = /(hidden|clip|auto|scroll)/.test(`${parentStyle.overflow} ${parentStyle.overflowX} ${parentStyle.overflowY}`);
    if (!overflowClips) return ownRadii;

    const parentRadii = cornerRadiiPx(parentStyle, map);
    if (!hasRadius(parentRadii)) return ownRadii;

    const rect = element.getBoundingClientRect();
    const parentRect = parent.getBoundingClientRect();
    const fillsParent = Math.abs(rect.left - parentRect.left) < 2
      && Math.abs(rect.top - parentRect.top) < 2
      && Math.abs(rect.width - parentRect.width) < 3
      && Math.abs(rect.height - parentRect.height) < 3;

    return fillsParent ? parentRadii : ownRadii;
  }

  function drawElementBox(ctx, element, map, targetWidth, targetHeight) {
    if (!isActuallyVisible(element)) return;
    const rect = rectToPage(element.getBoundingClientRect(), map);
    if (!intersectsPage(rect, targetWidth, targetHeight)) return;

    const style = getComputedStyle(element);
    const bg = parseCssColor(style.backgroundColor);
    const radius = cornerRadiiPx(style, map);

    if (bg) {
      ctx.save();
      roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
      ctx.fillStyle = bg;
      ctx.fill();
      ctx.restore();
    }

    drawBorders(ctx, rect, style, map, radius);
  }

  function drawBorders(ctx, rect, style, map, radius) {
    const sides = [
      ["Top", rect.x, rect.y, rect.width, 0],
      ["Right", rect.x + rect.width, rect.y, 0, rect.height],
      ["Bottom", rect.x, rect.y + rect.height, rect.width, 0],
      ["Left", rect.x, rect.y, 0, rect.height]
    ];

    // Se todos os lados forem iguais, o contorno arredondado fica melhor.
    const widths = sides.map(([side]) => parsePx(style[`border${side}Width`]));
    const styles = sides.map(([side]) => style[`border${side}Style`]);
    const colors = sides.map(([side]) => parseCssColor(style[`border${side}Color`]));
    const same = widths.every(w => Math.abs(w - widths[0]) < 0.01) && colors.every(c => c === colors[0]) && styles.every(s => s === styles[0]);

    if (same && widths[0] > 0 && styles[0] !== "none" && colors[0]) {
      ctx.save();
      roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
      ctx.lineWidth = widths[0] * ((map.scaleX + map.scaleY) / 2);
      ctx.strokeStyle = colors[0];
      ctx.stroke();
      ctx.restore();
      return;
    }

    sides.forEach(([side, x, y, width, height], index) => {
      const borderWidth = widths[index] * (side === "Top" || side === "Bottom" ? map.scaleY : map.scaleX);
      const borderStyle = styles[index];
      const color = colors[index];
      if (!borderWidth || borderStyle === "none" || !color) return;
      ctx.save();
      ctx.strokeStyle = color;
      ctx.lineWidth = borderWidth;
      ctx.beginPath();
      if (width) {
        ctx.moveTo(x, y);
        ctx.lineTo(x + width, y);
      } else {
        ctx.moveTo(x, y);
        ctx.lineTo(x, y + height);
      }
      ctx.stroke();
      ctx.restore();
    });
  }

  function drawSheetPseudoBorder(ctx, page, map) {
    // Reproduz .sheet::before sem depender de pseudo-elemento no canvas.
    const style = getComputedStyle(page);
    const borderColor = parseCssColor(style.getPropertyValue("--pdf-primary-soft")) || "#ead1d6";
    const insetMm = 10;
    const borderMm = 1.2;
    const radiusMm = 4;
    const pageW = DEFAULT_PAGE_WIDTH_PX;
    const pageH = DEFAULT_PAGE_HEIGHT_PX;
    const pxPerMmX = pageW / PAGE_WIDTH_MM;
    const pxPerMmY = pageH / PAGE_HEIGHT_MM;
    const x = insetMm * pxPerMmX;
    const y = insetMm * pxPerMmY;
    const w = pageW - x * 2;
    const h = pageH - y * 2;
    ctx.save();
    roundedRectPath(ctx, x, y, w, h, radiusMm * ((pxPerMmX + pxPerMmY) / 2));
    ctx.lineWidth = borderMm * ((pxPerMmX + pxPerMmY) / 2);
    ctx.strokeStyle = borderColor;
    ctx.stroke();
    ctx.restore();
  }

  async function fetchAsDataUrl(url) {
    const absolute = new URL(url, document.baseURI).href;
    if (imageCache.has(absolute)) return imageCache.get(absolute);
    const response = await fetch(absolute, { mode: "cors", credentials: "omit", cache: "force-cache" });
    if (!response.ok) throw new Error("Falha ao baixar imagem");
    const dataUrl = await blobToDataUrl(await response.blob());
    imageCache.set(absolute, dataUrl);
    return dataUrl;
  }

  function isLogo(img) {
    const className = String((img.className && img.className.baseVal) || img.className || "");
    const alt = String(img.getAttribute("alt") || "");
    const src = String(img.currentSrc || img.getAttribute("src") || "");
    return /\b(pdf-logo|pdf-page-logo)\b/i.test(className) || /logotipo|bouquet\s*flores/i.test(alt) || /logo_bouquet_flores/i.test(src);
  }

  async function safeImageForCanvas(img) {
    const rawSrc = img.currentSrc || img.getAttribute("src") || "";
    if (!rawSrc) return await loadImage(BLANK_IMAGE);

    const key = `${rawSrc}|${isLogo(img) ? "logo" : "photo"}`;
    if (imageCache.has(key)) return await loadImage(imageCache.get(key));

    let dataUrl;
    try {
      dataUrl = /^data:/i.test(rawSrc) ? rawSrc : await fetchAsDataUrl(rawSrc);
    } catch (error) {
      dataUrl = BLANK_IMAGE;
    }

    const preserveAlpha = isLogo(img);
    const maxSide = preserveAlpha ? 2200 : 1800;
    const out = await normalizeImageDataUrl(dataUrl, { preserveAlpha, maxSide });
    imageCache.set(key, out);
    return await loadImage(out);
  }

  async function normalizeImageDataUrl(dataUrl, { preserveAlpha = false, maxSide = 1800 } = {}) {
    try {
      const image = await loadImage(/^data:image\//i.test(dataUrl) ? dataUrl : BLANK_IMAGE);
      const width = image.naturalWidth || image.width || 1;
      const height = image.naturalHeight || image.height || 1;
      const longest = Math.max(width, height);
      const ratio = Math.min(1, maxSide / longest);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      const ctx = canvas.getContext("2d", { alpha: preserveAlpha });
      if (!preserveAlpha) {
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      } else {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
      }
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
      return preserveAlpha ? canvas.toDataURL("image/png") : canvas.toDataURL("image/jpeg", 0.9);
    } catch (error) {
      return BLANK_IMAGE;
    }
  }

  function parseObjectPosition(value) {
    const text = String(value || "50% 50%").trim().toLowerCase();
    const parts = text.split(/\s+/);
    const parseOne = (part, axis) => {
      if (!part) return 0.5;
      if (part === "left" || part === "top") return 0;
      if (part === "right" || part === "bottom") return 1;
      if (part === "center") return 0.5;
      if (/%$/.test(part)) return clamp(parseFloat(part) / 100, 0, 1);
      return axis === "x" ? 0.5 : 0.5;
    };
    return { x: parseOne(parts[0], "x"), y: parseOne(parts[1] || parts[0], "y") };
  }

  function clipRounded(ctx, rect, radius) {
    roundedRectPath(ctx, rect.x, rect.y, rect.width, rect.height, radius);
    ctx.clip();
  }

  async function drawImageElement(ctx, img, map, targetWidth, targetHeight) {
    if (!isActuallyVisible(img)) return;
    const rect = rectToPage(img.getBoundingClientRect(), map);
    if (!intersectsPage(rect, targetWidth, targetHeight)) return;

    const style = getComputedStyle(img);
    const image = await safeImageForCanvas(img);
    const naturalW = image.naturalWidth || image.width || 1;
    const naturalH = image.naturalHeight || image.height || 1;
    const fit = style.objectFit || "fill";
    const pos = parseObjectPosition(style.objectPosition);
    let sx = 0, sy = 0, sw = naturalW, sh = naturalH;
    let dx = rect.x, dy = rect.y, dw = rect.width, dh = rect.height;

    if (fit === "cover" || fit === "contain") {
      const scale = fit === "cover"
        ? Math.max(rect.width / naturalW, rect.height / naturalH)
        : Math.min(rect.width / naturalW, rect.height / naturalH);
      const drawW = naturalW * scale;
      const drawH = naturalH * scale;
      if (fit === "cover") {
        sw = rect.width / scale;
        sh = rect.height / scale;
        sx = (naturalW - sw) * pos.x;
        sy = (naturalH - sh) * pos.y;
      } else {
        dw = drawW;
        dh = drawH;
        dx = rect.x + (rect.width - drawW) * pos.x;
        dy = rect.y + (rect.height - drawH) * pos.y;
      }
    }

    ctx.save();
    clipRounded(ctx, rect, inheritedClipRadii(img, cornerRadiiPx(style, map), map));
    ctx.drawImage(image, sx, sy, sw, sh, dx, dy, dw, dh);
    ctx.restore();
  }

  function nodeIsInsideImage(node) {
    let current = node && node.parentElement;
    while (current) {
      if (current.tagName && current.tagName.toLowerCase() === "img") return true;
      current = current.parentElement;
    }
    return false;
  }

  function visibleTextNodes(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode(node) {
        if (!node.nodeValue || !node.nodeValue.replace(/\s+/g, "").length) return NodeFilter.FILTER_REJECT;
        if (nodeIsInsideImage(node)) return NodeFilter.FILTER_REJECT;
        const parent = node.parentElement;
        if (!parent || !isActuallyVisible(parent)) return NodeFilter.FILTER_REJECT;
        const style = getComputedStyle(parent);
        const color = parseCssColor(style.color);
        if (!color) return NodeFilter.FILTER_REJECT;
        return NodeFilter.FILTER_ACCEPT;
      }
    });
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    return nodes;
  }

  function textFont(style) {
    const fontStyle = style.fontStyle || "normal";
    const fontVariant = style.fontVariant || "normal";
    const fontWeight = style.fontWeight || "400";
    const fontSize = style.fontSize || "16px";
    const fontFamily = style.fontFamily || "Arial, sans-serif";
    return `${fontStyle} ${fontVariant} ${fontWeight} ${fontSize} ${fontFamily}`;
  }

  function groupTextNodeByRenderedLine(node) {
    const text = node.nodeValue || "";
    const range = document.createRange();
    const groups = [];
    let current = null;
    let lastHadRect = false;

    for (let i = 0; i < text.length; i += 1) {
      range.setStart(node, i);
      range.setEnd(node, i + 1);
      const rects = Array.from(range.getClientRects()).filter(r => r.width || r.height);
      const rect = rects[0] || null;
      const char = text[i];

      if (!rect) {
        if (current && /\s/.test(char)) current.text += char;
        lastHadRect = false;
        continue;
      }

      const topKey = Math.round(rect.top * 2) / 2;
      if (!current || Math.abs(current.topKey - topKey) > 1.2 || (!lastHadRect && !/\s/.test(char))) {
        current = {
          text: "",
          rects: [],
          topKey
        };
        groups.push(current);
      }

      current.text += char;
      current.rects.push(rect);
      lastHadRect = true;
    }

    range.detach();
    return groups.map(group => {
      const left = Math.min(...group.rects.map(r => r.left));
      const top = Math.min(...group.rects.map(r => r.top));
      const right = Math.max(...group.rects.map(r => r.right));
      const bottom = Math.max(...group.rects.map(r => r.bottom));
      return {
        text: group.text.replace(/\s+$/g, ""),
        rect: { left, top, right, bottom, width: right - left, height: bottom - top }
      };
    }).filter(group => group.text.length);
  }

  function drawTextNode(ctx, node, map, targetWidth, targetHeight) {
    const parent = node.parentElement;
    if (!parent || !isActuallyVisible(parent)) return;
    const style = getComputedStyle(parent);
    const color = parseCssColor(style.color);
    if (!color) return;

    ctx.save();
    ctx.fillStyle = color;
    ctx.font = textFont(style);
    ctx.textAlign = "left";
    ctx.textBaseline = "alphabetic";
    if ("letterSpacing" in ctx) ctx.letterSpacing = style.letterSpacing || "0px";

    const fontSize = parsePx(style.fontSize) || 16;
    const groups = groupTextNodeByRenderedLine(node);
    for (const group of groups) {
      const rect = rectToPage(group.rect, map);
      if (!intersectsPage(rect, targetWidth, targetHeight)) continue;
      const baseline = rect.y + rect.height - Math.max(1.5, fontSize * 0.16);
      ctx.fillText(group.text, rect.x, baseline);
    }
    ctx.restore();
  }

  function collectElements(root) {
    return [root, ...Array.from(root.querySelectorAll("*"))];
  }

  async function ensureFontsReady() {
    if (!document.fonts || !document.fonts.ready) return;
    try {
      await Promise.all([
        document.fonts.load('400 18px "Clear Sans"', 'Orçamento Floral'),
        document.fonts.load('400 42pt "Magnolia Script"', 'Inspirações'),
        document.fonts.load('400 58pt "Gistesy"', 'Patricia Zeviani'),
        document.fonts.load('400 32pt "Gistesy"', 'Bouquet Flores')
      ]);
      await document.fonts.ready;
    } catch (error) {
      // Se uma fonte não carregar, usamos o mesmo fallback que o navegador já usa na prévia.
    }
  }

  async function renderPageToCanvas(page, options = {}) {
    const targetWidth = Number(options.pageWidthPx) || DEFAULT_PAGE_WIDTH_PX;
    const targetHeight = Number(options.pageHeightPx) || DEFAULT_PAGE_HEIGHT_PX;
    const scale = Number(options.scale) || 1.6;

    const canvas = document.createElement("canvas");
    canvas.width = Math.ceil(targetWidth * scale);
    canvas.height = Math.ceil(targetHeight * scale);
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, targetWidth, targetHeight);

    const map = getPageMapper(page, targetWidth, targetHeight);
    const elements = collectElements(page).filter(isActuallyVisible);

    // Fundo e bordas reais.
    for (const element of elements) drawElementBox(ctx, element, map, targetWidth, targetHeight);
    // Borda decorativa da folha, que vem de pseudo-elemento CSS.
    drawSheetPseudoBorder(ctx, page, map);
    // Imagens convertidas para data URL local antes de entrar no canvas.
    for (const img of Array.from(page.querySelectorAll("img"))) {
      await drawImageElement(ctx, img, map, targetWidth, targetHeight);
    }
    // Textos na posição calculada pelo próprio layout da pré-visualização.
    for (const node of visibleTextNodes(page)) drawTextNode(ctx, node, map, targetWidth, targetHeight);

    return canvas;
  }

  function canvasToJpegDataUrl(canvas, quality = 0.9) {
    // Como não desenhamos SVG/foreignObject nem imagens externas diretamente,
    // esse canvas permanece origin-clean no Android.
    return canvas.toDataURL("image/jpeg", quality);
  }

  class LocalPdfDocument {
    constructor() {
      this.pages = [];
    }

    addPageImage(dataUrl, xMm, yMm, widthMm, heightMm) {
      const { mime, bytes } = dataUrlToBytes(dataUrl);
      if (!/jpeg|jpg/.test(mime)) throw new Error("O PDF local usa páginas JPEG");
      const size = getJpegSize(bytes);
      this.pages.push({
        bytes,
        pixelWidth: size.width,
        pixelHeight: size.height,
        x: (Number(xMm) || 0) * MM_TO_PT,
        y: (Number(yMm) || 0) * MM_TO_PT,
        width: (Number(widthMm) || PAGE_WIDTH_MM) * MM_TO_PT,
        height: (Number(heightMm) || PAGE_HEIGHT_MM) * MM_TO_PT
      });
    }

    outputBytes() {
      if (!this.pages.length) throw new Error("Nenhuma página foi enviada ao PDF");
      const parts = [];
      const offsets = [0];
      const write = value => parts.push(value instanceof Uint8Array ? value : textEncoderBytes(String(value)));
      const position = () => parts.reduce((sum, part) => sum + part.length, 0);
      const objects = [];
      const addObject = bodyParts => {
        objects.push(Array.isArray(bodyParts) ? bodyParts : [bodyParts]);
        return objects.length;
      };
      const catalogId = addObject("");
      const pagesId = addObject("");
      const kids = [];

      this.pages.forEach((page, pageIndex) => {
        const imageName = `Im${pageIndex + 1}`;
        const imageId = addObject([
          `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.bytes.length} >>\nstream\n`,
          page.bytes,
          "\nendstream"
        ]);
        const x = page.x;
        const y = PAGE_HEIGHT_PT - page.y - page.height;
        const content = `q\n${page.width.toFixed(3)} 0 0 ${page.height.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n/${imageName} Do\nQ\n`;
        const contentBytes = textEncoderBytes(content);
        const contentId = addObject([
          `<< /Length ${contentBytes.length} >>\nstream\n`,
          contentBytes,
          "\nendstream"
        ]);
        const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH_PT.toFixed(3)} ${PAGE_HEIGHT_PT.toFixed(3)}] /Resources << /XObject << /${imageName} ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`);
        kids.push(`${pageId} 0 R`);
      });

      objects[catalogId - 1] = [`<< /Type /Catalog /Pages ${pagesId} 0 R >>`];
      objects[pagesId - 1] = [`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${kids.length} >>`];

      write("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n");
      objects.forEach((bodyParts, index) => {
        offsets[index + 1] = position();
        write(`${index + 1} 0 obj\n`);
        bodyParts.forEach(write);
        write("\nendobj\n");
      });
      const xrefOffset = position();
      write(`xref\n0 ${objects.length + 1}\n`);
      write("0000000000 65535 f \n");
      for (let i = 1; i <= objects.length; i += 1) write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
      write(`trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
      return concatBytes(parts);
    }

    save(filename) {
      const blob = new Blob([this.outputBytes()], { type: "application/pdf" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename || "orcamento-floral.pdf";
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    }
  }

  function chooseScales(options) {
    const list = Array.isArray(options.scales) && options.scales.length ? options.scales : [1.6, 1.3, 1];
    return list.map(Number).filter(n => Number.isFinite(n) && n > 0);
  }

  async function renderPageWithScaleFallback(page, options) {
    let lastError = null;
    for (const scale of chooseScales(options)) {
      try {
        return await renderPageToCanvas(page, { ...options, scale });
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError || new Error("Falha ao renderizar página do PDF");
  }

  async function downloadFromPreview(preview, options = {}) {
    if (!preview) throw new Error("Pré-visualização não encontrada");
    const selector = options.pageSelector || ".sheet";
    const pages = Array.from(preview.querySelectorAll(selector));
    if (!pages.length) throw new Error("Nenhuma página encontrada na pré-visualização");

    await ensureFontsReady();

    const pdf = new LocalPdfDocument();
    for (const page of pages) {
      const canvas = await renderPageWithScaleFallback(page, options);
      const jpeg = canvasToJpegDataUrl(canvas, 0.9);
      pdf.addPageImage(jpeg, 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
      canvas.width = 1;
      canvas.height = 1;
    }

    pdf.save(options.filename || "orcamento-floral.pdf");
  }

  window.OrcamentoPdf = { downloadFromPreview };
}());
