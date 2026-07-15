/* Gerador local de PDF para o Auxiliar de Orçamento Floral.
   Mantém o botão Baixar PDF sem depender de html2pdf/jsPDF/html2canvas por CDN. */
(function () {
  "use strict";

  const MM_TO_PT = 72 / 25.4;
  const PAGE_WIDTH_MM = 210;
  const PAGE_HEIGHT_MM = 297;
  const PAGE_WIDTH_PT = PAGE_WIDTH_MM * MM_TO_PT;
  const PAGE_HEIGHT_PT = PAGE_HEIGHT_MM * MM_TO_PT;

  function textEncoderBytes(text) {
    const bytes = new Uint8Array(text.length);
    for (let i = 0; i < text.length; i += 1) bytes[i] = text.charCodeAt(i) & 0xff;
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
    while (i < bytes.length) {
      if (bytes[i] !== 0xff) { i += 1; continue; }
      const marker = bytes[i + 1];
      const length = (bytes[i + 2] << 8) + bytes[i + 3];
      if ([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf].includes(marker)) {
        const height = (bytes[i + 5] << 8) + bytes[i + 6];
        const width = (bytes[i + 7] << 8) + bytes[i + 8];
        return { width, height };
      }
      i += 2 + length;
    }
    return { width: 1, height: 1 };
  }

  function collectCssText() {
    const chunks = [];
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        for (const rule of Array.from(sheet.cssRules || [])) {
          const cssText = rule.cssText || "";
          if (/^@import/i.test(cssText.trim())) continue;
          chunks.push(cssText);
        }
      } catch (error) {
        // Folhas externas sem permissão de leitura são ignoradas.
      }
    }

    chunks.push(`
      html, body { margin: 0 !important; padding: 0 !important; background: #ffffff !important; }
      body { width: 100% !important; min-width: 0 !important; overflow: hidden !important; }
      .sheet { margin: 0 !important; box-shadow: none !important; transform: none !important; }
      .sheet-frame { width: 210mm !important; height: 297mm !important; overflow: hidden !important; }
      img { max-width: 100%; }
      .no-print, dialog { display: none !important; }
    `);

    return chunks.join("\n");
  }

  const TRANSPARENT_PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==";

  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error || new Error("Falha ao ler imagem"));
      reader.readAsDataURL(blob);
    });
  }

  function waitForDomImage(image) {
    return new Promise((resolve, reject) => {
      if (image.complete && image.naturalWidth) {
        resolve(image);
        return;
      }
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error("Falha ao carregar imagem"));
    });
  }

  async function compressDataUrl(dataUrl) {
    if (!/^data:image\//i.test(String(dataUrl || ""))) return dataUrl;

    const image = new Image();
    image.decoding = "sync";
    image.src = dataUrl;
    await waitForDomImage(image);

    const width = image.naturalWidth || image.width || 1;
    const height = image.naturalHeight || image.height || 1;
    const longest = Math.max(width, height);

    if (longest <= 1600 && String(dataUrl).length < 900000) {
      return dataUrl;
    }

    const ratio = Math.min(1, 1600 / longest);
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(width * ratio));
    canvas.height = Math.max(1, Math.round(height * ratio));
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.88);
  }

  async function sourceToSafeDataUrl(src) {
    if (!src) return TRANSPARENT_PIXEL;

    if (/^data:/i.test(src)) {
      return compressDataUrl(src);
    }

    const absoluteUrl = new URL(src, document.baseURI).href;
    const response = await fetch(absoluteUrl, { mode: "cors", credentials: "omit", cache: "force-cache" });
    if (!response.ok) throw new Error("Falha ao baixar imagem");
    const blob = await response.blob();
    const dataUrl = await blobToDataUrl(blob);
    return compressDataUrl(dataUrl);
  }

  async function inlineImages(root) {
    const images = Array.from(root.querySelectorAll("img"));
    await Promise.all(images.map(async img => {
      const src = img.getAttribute("src");
      img.removeAttribute("srcset");
      img.removeAttribute("sizes");
      img.setAttribute("crossorigin", "anonymous");

      try {
        img.setAttribute("src", await sourceToSafeDataUrl(src));
      } catch (error) {
        // Para não cancelar o PDF inteiro quando uma imagem externa falhar,
        // substitui apenas aquela imagem por um pixel transparente.
        img.setAttribute("src", TRANSPARENT_PIXEL);
      }
    }));
  }

  function waitForImage(image) {
    return new Promise((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error("Falha ao renderizar página do PDF"));
    });
  }

  async function renderElementToCanvas(element, options) {
    const scale = Number(options && options.scale) || 2;
    const width = Math.ceil((options && options.windowWidth) || element.scrollWidth || element.getBoundingClientRect().width || 794);
    const height = Math.ceil((options && options.windowHeight) || element.scrollHeight || element.getBoundingClientRect().height || 1123);
    const backgroundColor = (options && options.backgroundColor) || "#ffffff";

    const clone = element.cloneNode(true);
    await inlineImages(clone);

    const xhtml = `
      <html xmlns="http://www.w3.org/1999/xhtml">
        <head>
          <meta charset="utf-8" />
          <style>${collectCssText()}</style>
        </head>
        <body>${clone.outerHTML}</body>
      </html>
    `;

    const svg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
        <foreignObject x="0" y="0" width="100%" height="100%">${xhtml}</foreignObject>
      </svg>
    `;

    const svgBlob = new Blob([svg], { type: "image/svg+xml;charset=utf-8" });
    const url = URL.createObjectURL(svgBlob);
    const image = new Image();
    image.decoding = "sync";
    image.src = url;
    await waitForImage(image);

    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.ceil(width * scale));
    canvas.height = Math.max(1, Math.ceil(height * scale));
    const ctx = canvas.getContext("2d", { alpha: false });
    ctx.fillStyle = backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.drawImage(image, 0, 0, width, height);
    URL.revokeObjectURL(url);
    return canvas;
  }

  class LocalJsPdf {
    constructor() {
      this.pages = [[]];
    }

    addPage() {
      this.pages.push([]);
      return this;
    }

    addImage(dataUrl, format, xMm, yMm, widthMm, heightMm) {
      const { mime, bytes } = dataUrlToBytes(dataUrl);
      if (!/jpeg|jpg/.test(mime) && !/jpeg|jpg/i.test(format || "")) {
        throw new Error("O gerador local espera imagens JPEG");
      }

      const size = getJpegSize(bytes);
      const currentPage = this.pages[this.pages.length - 1];
      currentPage.push({
        bytes,
        pixelWidth: size.width,
        pixelHeight: size.height,
        x: (Number(xMm) || 0) * MM_TO_PT,
        y: (Number(yMm) || 0) * MM_TO_PT,
        width: (Number(widthMm) || PAGE_WIDTH_MM) * MM_TO_PT,
        height: (Number(heightMm) || PAGE_HEIGHT_MM) * MM_TO_PT
      });
      return this;
    }

    outputBytes() {
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
      const pageIds = [];
      const kids = [];

      this.pages.forEach((page, pageIndex) => {
        const imageEntries = [];
        const xObjects = [];
        let contents = "";

        page.forEach((image, imageIndex) => {
          const imageName = `Im${pageIndex + 1}_${imageIndex + 1}`;
          const imageId = addObject([
            `<< /Type /XObject /Subtype /Image /Width ${image.pixelWidth} /Height ${image.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.bytes.length} >>\nstream\n`,
            image.bytes,
            "\nendstream"
          ]);
          imageEntries.push(`/${imageName} ${imageId} 0 R`);

          const x = image.x;
          const y = PAGE_HEIGHT_PT - image.y - image.height;
          contents += `q\n${image.width.toFixed(3)} 0 0 ${image.height.toFixed(3)} ${x.toFixed(3)} ${y.toFixed(3)} cm\n/${imageName} Do\nQ\n`;
        });

        const contentBytes = textEncoderBytes(contents);
        const contentId = addObject([
          `<< /Length ${contentBytes.length} >>\nstream\n`,
          contentBytes,
          "\nendstream"
        ]);

        xObjects.push(imageEntries.join(" "));
        const resources = imageEntries.length ? `<< /XObject << ${xObjects.join(" ")} >> >>` : "<< >>";
        const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${PAGE_WIDTH_PT.toFixed(3)} ${PAGE_HEIGHT_PT.toFixed(3)}] /Resources ${resources} /Contents ${contentId} 0 R >>`);
        pageIds.push(pageId);
        kids.push(`${pageId} 0 R`);
      });

      objects[catalogId - 1] = [`<< /Type /Catalog /Pages ${pagesId} 0 R >>`];
      objects[pagesId - 1] = [`<< /Type /Pages /Kids [${kids.join(" ")}] /Count ${pageIds.length} >>`];

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
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      return this;
    }
  }

  window.html2canvas = window.html2canvas || renderElementToCanvas;
  window.jspdf = window.jspdf || {};
  window.jspdf.jsPDF = window.jspdf.jsPDF || LocalJsPdf;
}());
