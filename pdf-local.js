/* Gerador local de PDF para o Auxiliar de Orçamento Floral.
   O PDF é gerado exclusivamente a partir das folhas já renderizadas na pré-visualização. */
(function () {
  "use strict";

  const MM_TO_PT = 72 / 25.4;
  const PAGE_WIDTH_MM = 210;
  const PAGE_HEIGHT_MM = 297;
  const PAGE_WIDTH_PT = PAGE_WIDTH_MM * MM_TO_PT;
  const PAGE_HEIGHT_PT = PAGE_HEIGHT_MM * MM_TO_PT;
  const BLANK_IMAGE = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCAABAAEDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwD9U6KKKAP/2Q==";
  let cachedBaseCss = null;
  let cachedFontCss = null;
  const fontDataUrlCache = new Map();

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
    return {
      mime: match[1].toLowerCase(),
      bytes: base64ToBytes(match[2])
    };
  }

  function getJpegSize(bytes) {
    if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return { width: 1, height: 1 };
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i += 1;
        continue;
      }

      const marker = bytes[i + 1];
      const length = (bytes[i + 2] << 8) + bytes[i + 3];
      if (!length || length < 2) break;

      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        const height = (bytes[i + 5] << 8) + bytes[i + 6];
        const width = (bytes[i + 7] << 8) + bytes[i + 8];
        return { width, height };
      }
      i += 2 + length;
    }
    return { width: 1, height: 1 };
  }

  function stripUnsafeCss(cssText) {
    return String(cssText || "")
      .replace(/@charset[^;]+;/gi, "")
      .replace(/@import[^;]+;/gi, "")
      .replace(/url\(\s*['\"]?https?:\/\/[^)]+\)/gi, "none");
  }

  function cssRuleText(rule) {
    const text = rule && rule.cssText ? String(rule.cssText) : "";
    if (!text) return "";
    if (/^\s*@import\b/i.test(text)) return "";
    if (/^\s*@charset\b/i.test(text)) return "";
    if (/^\s*@font-face\b/i.test(text)) return text;
    return stripUnsafeCss(text);
  }

  function collectCssFromCssom() {
    const chunks = [];

    for (const sheet of Array.from(document.styleSheets || [])) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          const text = cssRuleText(rule);
          if (text) chunks.push(text);
        }
      } catch (error) {
        // Alguns @imports externos deixam a folha inacessível. Nesse caso,
        // o fallback é buscar style.css diretamente abaixo.
      }
    }

    return chunks.join("\n");
  }


  function normalizeCssUrl(url, baseHref) {
    const value = String(url || "").trim().replace(/^['"]|['"]$/g, "");
    if (!value || /^data:/i.test(value) || /^blob:/i.test(value)) return value;
    try {
      return new URL(value, baseHref || document.baseURI).href;
    } catch (error) {
      return value;
    }
  }

  function extractFontFaceRules(cssText) {
    const css = String(cssText || "");
    const matches = css.match(/@font-face\s*\{[\s\S]*?\}/gi);
    return matches ? matches.join("\n") : "";
  }

  async function urlToDataUrl(url) {
    const absoluteUrl = new URL(url, document.baseURI).href;
    if (fontDataUrlCache.has(absoluteUrl)) return fontDataUrlCache.get(absoluteUrl);

    const response = await fetch(absoluteUrl, {
      mode: "cors",
      credentials: "omit",
      cache: "force-cache"
    });

    if (!response.ok) throw new Error("Falha ao baixar fonte");
    const dataUrl = await blobToDataUrl(await response.blob());
    fontDataUrlCache.set(absoluteUrl, dataUrl);
    return dataUrl;
  }

  async function inlineFontUrls(cssText, baseHref) {
    let css = String(cssText || "");
    const matches = Array.from(css.matchAll(/url\(\s*(['"]?)([^'"\)]+)\1\s*\)/gi));

    for (const match of matches) {
      const original = match[0];
      const rawUrl = match[2];
      const absoluteUrl = normalizeCssUrl(rawUrl, baseHref);
      if (!absoluteUrl || /^data:/i.test(absoluteUrl)) continue;

      try {
        const dataUrl = await urlToDataUrl(absoluteUrl);
        css = css.split(original).join(`url("${dataUrl}")`);
      } catch (error) {
        css = css.split(original).join(`url("${absoluteUrl}")`);
      }
    }

    return css;
  }


  async function ensureDocumentFontsReady() {
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
      // O CSS exportado ainda leva as @font-face embutidas para o SVG/canvas.
    }
  }

  async function collectFontCss() {
    if (cachedFontCss !== null) return cachedFontCss;

    const chunks = [];

    for (const link of Array.from(document.querySelectorAll('link[rel~="stylesheet"][href]'))) {
      const href = link.href;
      if (!href || !/font|cdnfonts/i.test(href)) continue;

      try {
        const response = await fetch(href, {
          mode: "cors",
          credentials: "omit",
          cache: "force-cache"
        });
        if (!response.ok) continue;
        const fontRules = extractFontFaceRules(await response.text());
        if (fontRules.trim()) chunks.push(await inlineFontUrls(fontRules, href));
      } catch (error) {
        // Se não for possível embutir as fontes, ainda tentamos as fontes já registradas no CSSOM abaixo.
      }
    }

    for (const sheet of Array.from(document.styleSheets || [])) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          const text = rule && rule.cssText ? String(rule.cssText) : "";
          if (/^\s*@font-face\b/i.test(text)) chunks.push(await inlineFontUrls(text, sheet.href || document.baseURI));
        }
      } catch (error) {
        // Folhas externas podem ser bloqueadas pelo navegador; o fetch acima cobre o caso normal.
      }
    }

    cachedFontCss = chunks.join("\n");
    return cachedFontCss;
  }

  async function collectBaseCss() {
    if (cachedBaseCss) return cachedBaseCss;

    let css = "";
    try {
      const response = await fetch(new URL("style.css", document.baseURI).href, { cache: "force-cache" });
      if (response.ok) css = await response.text();
    } catch (error) {
      css = "";
    }

    if (!css.trim()) {
      css = collectCssFromCssom();
    }

    cachedBaseCss = stripUnsafeCss(css);
    return cachedBaseCss;
  }

  function collectCssVariablesFrom(element) {
    const chunks = [];
    const styles = [
      getComputedStyle(document.documentElement),
      element ? getComputedStyle(element) : null
    ].filter(Boolean);

    styles.forEach(style => {
      for (let i = 0; i < style.length; i += 1) {
        const prop = style[i];
        if (prop && prop.startsWith("--")) {
          const value = style.getPropertyValue(prop).trim();
          if (value) chunks.push(`${prop}: ${value};`);
        }
      }
    });

    return chunks.join("\n");
  }

  async function buildExportCss(preview) {
    const fontCss = await collectFontCss();
    const baseCss = await collectBaseCss();
    const vars = collectCssVariablesFrom(preview);

    return `
      ${fontCss}
      ${baseCss}
      :root, html, body, .pdf-export-root {
        ${vars}
      }
      html, body {
        margin: 0 !important;
        padding: 0 !important;
        width: 794px !important;
        height: 1123px !important;
        overflow: hidden !important;
        background: #ffffff !important;
      }
      body {
        display: block !important;
      }
      *, *::before, *::after {
        box-sizing: border-box !important;
      }
      .sheet {
        position: relative !important;
        display: block !important;
        width: 210mm !important;
        height: 297mm !important;
        min-width: 210mm !important;
        max-width: 210mm !important;
        min-height: 297mm !important;
        max-height: 297mm !important;
        margin: 0 !important;
        transform: none !important;
        box-shadow: none !important;
        overflow: hidden !important;
        page-break-after: always !important;
      }
      .sheet-frame,
      .pdf-document,
      .preview-wrap {
        transform: none !important;
        overflow: visible !important;
      }
      .topbar, .editor, .no-print, dialog {
        display: none !important;
      }
    `;
  }

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Falha ao ler imagem"));
      reader.readAsDataURL(blob);
    });
  }

  function loadImage(src, { crossOrigin = null, timeout = 15000 } = {}) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error("Tempo esgotado ao carregar imagem"));
      }, timeout);

      image.decoding = "async";
      if (crossOrigin) image.crossOrigin = crossOrigin;

      image.onload = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(image);
      };

      image.onerror = () => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error("Falha ao carregar imagem"));
      };

      image.src = src;
    });
  }

  async function compressImageDataUrl(dataUrl, { maxSide = 1600, quality = 0.88 } = {}) {
    if (!/^data:image\//i.test(String(dataUrl || ""))) return BLANK_IMAGE;

    try {
      const image = await loadImage(dataUrl);
      const width = image.naturalWidth || image.width || 1;
      const height = image.naturalHeight || image.height || 1;
      const longest = Math.max(width, height);
      const ratio = Math.min(1, maxSide / longest);

      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * ratio));
      canvas.height = Math.max(1, Math.round(height * ratio));
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

      // Sempre convertemos para JPEG. Isso elimina variações de PNG/WebP/GIF
      // e evita que um formato específico derrube o SVG/canvas usado no PDF.
      return canvas.toDataURL("image/jpeg", quality);
    } catch (error) {
      return BLANK_IMAGE;
    }
  }

  async function fetchImageAsDataUrl(src) {
    const absoluteUrl = new URL(src, document.baseURI).href;
    const response = await fetch(absoluteUrl, {
      mode: "cors",
      credentials: "omit",
      cache: "force-cache"
    });
    if (!response.ok) throw new Error("Falha ao baixar imagem");
    return blobToDataUrl(await response.blob());
  }

  async function imageElementToDataUrl(img) {
    try {
      const src = img.currentSrc || img.getAttribute("src") || "";
      if (!src) return BLANK_IMAGE;

      if (/^data:/i.test(src)) {
        return await compressImageDataUrl(src);
      }

      try {
        return await compressImageDataUrl(await fetchImageAsDataUrl(src));
      } catch (fetchError) {
        // Última tentativa: usa a própria imagem já carregada na prévia.
        // Pode falhar por CORS; nesse caso removemos a imagem em vez de abortar o PDF.
        try {
          const loaded = img.complete && img.naturalWidth ? img : await loadImage(src, { crossOrigin: "anonymous" });
          const canvas = document.createElement("canvas");
          const width = Math.max(1, loaded.naturalWidth || loaded.width || 1);
          const height = Math.max(1, loaded.naturalHeight || loaded.height || 1);
          const longest = Math.max(width, height);
          const ratio = Math.min(1, 1600 / longest);
          canvas.width = Math.max(1, Math.round(width * ratio));
          canvas.height = Math.max(1, Math.round(height * ratio));
          const ctx = canvas.getContext("2d", { alpha: false });
          ctx.fillStyle = "#ffffff";
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(loaded, 0, 0, canvas.width, canvas.height);
          return canvas.toDataURL("image/jpeg", 0.88);
        } catch (canvasError) {
          return BLANK_IMAGE;
        }
      }
    } catch (error) {
      return BLANK_IMAGE;
    }
  }

  async function inlineImages(sourcePage, clonedPage) {
    const sourceImages = Array.from(sourcePage.querySelectorAll("img"));
    const clonedImages = Array.from(clonedPage.querySelectorAll("img"));

    for (let index = 0; index < clonedImages.length; index += 1) {
      const clonedImage = clonedImages[index];
      const sourceImage = sourceImages[index] || clonedImage;
      clonedImage.removeAttribute("srcset");
      clonedImage.removeAttribute("sizes");
      clonedImage.removeAttribute("loading");
      clonedImage.setAttribute("crossorigin", "anonymous");
      clonedImage.setAttribute("src", await imageElementToDataUrl(sourceImage));
    }
  }

  function makeExportPage(sourcePage) {
    const clone = sourcePage.cloneNode(true);
    clone.removeAttribute("id");
    clone.classList.add("pdf-export-root");
    clone.style.margin = "0";
    clone.style.transform = "none";
    clone.style.boxShadow = "none";
    clone.style.width = "210mm";
    clone.style.height = "297mm";
    clone.style.minWidth = "210mm";
    clone.style.maxWidth = "210mm";
    clone.style.minHeight = "297mm";
    clone.style.maxHeight = "297mm";
    clone.style.overflow = "hidden";
    return clone;
  }

  function serializePageForSvg(page) {
    const clone = page.cloneNode(true);
    clone.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");

    // XMLSerializer fecha corretamente tags vazias como <img />, o que evita
    // SVG inválido. Usar outerHTML direto pode gerar <img> sem fechamento e
    // causar o erro genérico "Falha ao carregar imagem" ao renderizar a página.
    return new XMLSerializer()
      .serializeToString(clone)
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/&nbsp;/g, "&#160;");
  }

  function cdataCss(value) {
    return String(value || "").replace(/]]>/g, "]]]]><![CDATA[>");
  }

  async function renderPageToCanvas(sourcePage, options, cssText) {
    const pageWidthPx = Number(options.pageWidthPx) || 794;
    const pageHeightPx = Number(options.pageHeightPx) || 1123;
    const scale = Number(options.scale) || 1.55;

    const clonedPage = makeExportPage(sourcePage);
    await inlineImages(sourcePage, clonedPage);

    const pageMarkup = serializePageForSvg(clonedPage);
    const xhtml = `
      <html xmlns="http://www.w3.org/1999/xhtml">
        <head>
          <meta charset="utf-8" />
          <style type="text/css"><![CDATA[${cdataCss(cssText)}]]></style>
        </head>
        <body>${pageMarkup}</body>
      </html>
    `;

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${pageWidthPx}" height="${pageHeightPx}" viewBox="0 0 ${pageWidthPx} ${pageHeightPx}">
        <foreignObject x="0" y="0" width="${pageWidthPx}" height="${pageHeightPx}">${xhtml}</foreignObject>
      </svg>
    `;

    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    try {
      let image;
      try {
        image = await loadImage(url);
      } catch (error) {
        throw new Error("Falha ao renderizar a página do PDF a partir da pré-visualização");
      }
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.ceil(pageWidthPx * scale));
      canvas.height = Math.max(1, Math.ceil(pageHeightPx * scale));
      const ctx = canvas.getContext("2d", { alpha: false });
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(scale, 0, 0, scale, 0, 0);
      ctx.drawImage(image, 0, 0, pageWidthPx, pageHeightPx);
      return canvas;
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  function canvasToJpegDataUrl(canvas, quality) {
    const dataUrl = canvas.toDataURL("image/jpeg", quality || 0.92);
    if (!/^data:image\/jpeg;base64,/i.test(dataUrl)) {
      throw new Error("Falha ao converter página para imagem do PDF");
    }
    return dataUrl;
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
      const write = value => {
        const bytes = value instanceof Uint8Array ? value : textEncoderBytes(String(value));
        parts.push(bytes);
      };
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
      for (let i = 1; i <= objects.length; i += 1) {
        write(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
      }
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
      setTimeout(() => URL.revokeObjectURL(url), 1500);
    }
  }

  async function renderWithScales(page, options, cssText) {
    const scales = Array.isArray(options.scales) && options.scales.length ? options.scales : [1.55, 1.25, 1];
    let lastError = null;

    for (const scale of scales) {
      try {
        return await renderPageToCanvas(page, { ...options, scale }, cssText);
      } catch (error) {
        lastError = error;
      }
    }

    throw lastError || new Error("Falha ao renderizar página");
  }

  async function downloadFromPreview(preview, options = {}) {
    if (!preview) throw new Error("Pré-visualização não encontrada");

    const selector = options.pageSelector || ".sheet";
    const pages = Array.from(preview.querySelectorAll(selector));
    if (!pages.length) throw new Error("Nenhuma página encontrada na pré-visualização");

    await ensureDocumentFontsReady();
    const cssText = await buildExportCss(preview);
    const pdf = new LocalPdfDocument();

    for (const page of pages) {
      const canvas = await renderWithScales(page, options, cssText);
      const jpeg = canvasToJpegDataUrl(canvas, 0.9);
      pdf.addPageImage(jpeg, 0, 0, PAGE_WIDTH_MM, PAGE_HEIGHT_MM);
      canvas.width = 1;
      canvas.height = 1;
    }

    pdf.save(options.filename || "orcamento-floral.pdf");
  }

  window.OrcamentoPdf = {
    downloadFromPreview
  };
}());
