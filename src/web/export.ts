import { diagramBounds } from "../core/geometry";
import { diagram } from "./state";

const PAD = 10;

function serialize() {
  const svg = document.querySelector<SVGSVGElement>("svg[data-canvas]");
  if (!svg) throw new Error("no canvas");
  const clone = svg.cloneNode(true) as SVGSVGElement;
  for (const el of clone.querySelectorAll("[data-ui]")) el.remove();
  clone.querySelector("[data-viewport]")?.removeAttribute("transform");
  clone.removeAttribute("style");
  const b = diagramBounds(diagram.value);
  const w = b.w + 2 * PAD;
  const h = b.h + 2 * PAD;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("viewBox", `${b.x - PAD} ${b.y - PAD} ${w} ${h}`);
  clone.setAttribute("width", String(w));
  clone.setAttribute("height", String(h));
  return { xml: new XMLSerializer().serializeToString(clone), w, h };
}

function download(blob: Blob, filename: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  URL.revokeObjectURL(a.href);
}

const svgBlob = (xml: string) => new Blob([xml], { type: "image/svg+xml;charset=utf-8" });

export function exportSvg(name: string): void {
  download(svgBlob(serialize().xml), `${name}.svg`);
}

export async function exportPng(name: string): Promise<void> {
  const { xml, w, h } = serialize();
  const url = URL.createObjectURL(svgBlob(xml));
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(w * 2));
    canvas.height = Math.max(1, Math.round(h * 2));
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const png = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/png"));
    if (!png) throw new Error("png encoding failed");
    download(png, `${name}.png`);
  } finally {
    URL.revokeObjectURL(url);
  }
}
