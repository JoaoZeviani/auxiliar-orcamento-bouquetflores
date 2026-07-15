/* Gerador local de PDF para o Auxiliar de Orçamento Floral.
   O PDF é gerado exclusivamente a partir das folhas já renderizadas na pré-visualização. */
(function () {
  "use strict";

  const MM_TO_PT = 72 / 25.4;
  const PAGE_WIDTH_MM = 210;
  const PAGE_HEIGHT_MM = 297;
  const PAGE_WIDTH_PT = PAGE_WIDTH_MM * MM_TO_PT;
  const PAGE_HEIGHT_PT = PAGE_HEIGHT_MM * MM_TO_PT;
  const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";
  let cachedBaseCss = null;

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
      .replace(/@font-face\s*\{[^}]*url\([^}]+\}/gi, "")
      .replace(/url\(\s*['\"]?https?:\/\/[^)]+\)/gi, "none");
  }

  function cssRuleText(rule) {
    const text = rule && rule.cssText ? String(rule.cssText) : "";
    if (!text) return "";
    if (/^\s*@import\b/i.test(text)) return "";
    if (/^\s*@charset\b/i.test(text)) return "";
    if (/^\s*@font-face\b/i.test(text) && /url\(/i.test(text)) return "";
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
    const baseCss = await collectBaseCss();
    const vars = collectCssVariablesFrom(preview);

    return `
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

  function loadImage(src, { crossOrigin = null } = {}) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.decoding = "async";
      if (crossOrigin) image.crossOrigin = crossOrigin;
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Falha ao carregar imagem"));
      image.src = src;
    });
  }

  async function compressImageDataUrl(dataUrl, { maxSide = 1600, quality = 0.88 } = {}) {
    if (!/^data:image\//i.test(String(dataUrl || ""))) return dataUrl;

    const image = await loadImage(dataUrl);
    const width = image.naturalWidth || image.width || 1;
    const height = image.naturalHeight || image.height || 1;
    const longest = Math.max(width, height);

    if (longest <= maxSide && String(dataUrl).length < 1000000) {
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
    const src = img.currentSrc || img.getAttribute("src") || "";
    if (!src) return TRANSPARENT_PIXEL;

    if (/^data:/i.test(src)) {
      return compressImageDataUrl(src);
    }

    try {
      return await compressImageDataUrl(await fetchImageAsDataUrl(src));
    } catch (fetchError) {
      try {
        const loaded = img.complete && img.naturalWidth ? img : await loadImage(src, { crossOrigin: "anonymous" });
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, loaded.naturalWidth || loaded.width || 1);
        canvas.height = Math.max(1, loaded.naturalHeight || loaded.height || 1);
        const ctx = canvas.getContext("2d", { alpha: false });
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(loaded, 0, 0);
        return await compressImageDataUrl(canvas.toDataURL("image/jpeg", 0.88));
      } catch (canvasError) {
        return TRANSPARENT_PIXEL;
      }
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

  function normalizeSvgText(value) {
    return String(value || "")
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/&nbsp;/g, "&#160;");
  }

  async function renderPageToCanvas(sourcePage, options, cssText) {
    const pageWidthPx = Number(options.pageWidthPx) || 794;
    const pageHeightPx = Number(options.pageHeightPx) || 1123;
    const scale = Number(options.scale) || 1.55;

    const clonedPage = makeExportPage(sourcePage);
    await inlineImages(sourcePage, clonedPage);

    const xhtml = normalizeSvgText(`
      <html xmlns="http://www.w3.org/1999/xhtml">
        <head>
          <meta charset="utf-8" />
          <style><![CDATA[${String(cssText).replace(/\]\]>/g, "]] ]>")}]]></style>
        </head>
        <body>${clonedPage.outerHTML}</body>
      </html>
    `);

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${pageWidthPx}" height="${pageHeightPx}" viewBox="0 0 ${pageWidthPx} ${pageHeightPx}">
        <foreignObject x="0" y="0" width="${pageWidthPx}" height="${pageHeightPx}">${xhtml}</foreignObject>
      </svg>
    `;

    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);

    try {
      const image = await loadImage(url);
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
