// src/App.tsx
import React, { useEffect, useMemo, useRef, useState } from "react";

type Node = {
  text: string;
  children: Node[];
};

type FlatNode = {
  id: number;
  text: string;
  depth: number;
  parentId: number | null;
  childrenIds: number[];
};

type PositionedNode = FlatNode & {
  x: number;
  y: number;
  w: number;
  h: number;
  lines: string[];
};

type HistoryEntry = {
  id: string;
  createdTs: number; // when this history item was first created
  ts: number; // last updated, epoch ms
  title: string;
  text: string;
};


const DEFAULT_INPUT = `Схема принятия решений  
  Действия
    Опишите схему текстом с отступами
      Import. Восстановите текст из ASCII-схемы
      History. Вернитесь к ранее созданным схемам
  ASCII
    Получите готовую ASCII-схему
      Используйте {code}, чтобы Jira корректно отображала схему
  Диаграмма
    Просмотрите визуальную диаграмму
      Масштабируйте и перемещайте
      Экспортируейте диаграмму в PNG`;

// Count leading spaces in a string.

function countLeadingSpaces(s: string): number {
  let i = 0;
  while (i < s.length && s[i] === " ") i++;
  return i;
}

// Get current line indent (spaces) before the caret position.

function getLineIndentBeforeCursor(text: string, cursor: number): number {
  const lineStart = text.lastIndexOf("\n", cursor - 1) + 1;
  let i = lineStart;
  while (i < text.length && text[i] === " ") i++;
  return i - lineStart;
}

// Parse indented text into a tree (2 spaces per level by default).

function parseIndentedTree(input: string, indentSize = 2): Node[] {
  const lines = input
    .replace(/\t/g, " ".repeat(indentSize))
    .split("\n")
    .map((l) => l.replace(/\s+$/g, ""))
    .filter((l) => l.trim().length > 0);

  const root: Node = { text: "__ROOT__", children: [] };
  const stack: { level: number; node: Node }[] = [{ level: -1, node: root }];

  for (const raw of lines) {
    const lead = countLeadingSpaces(raw);
    const level = Math.floor(lead / indentSize);
    const text = raw.trim();

    const node: Node = { text, children: [] };

    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const parent = stack[stack.length - 1]?.node ?? root;

    parent.children.push(node);
    stack.push({ level, node });
  }

  return root.children;
}

// Render a tree into an ASCII diagram using box-drawing characters.

function renderAsciiTree(nodes: Node[]): string {
  const out: string[] = [];

  const render = (node: Node, prefix: string, isLast: boolean) => {
    const connector = isLast ? "└─ " : "├─ ";
    out.push(prefix + connector + node.text);

    if (!node.children.length) return;

    const childPrefix = prefix + (isLast ? "   " : "│  ");
    out.push(childPrefix + "│");

    // spacer with line between sibling branches
    for (let idx = 0; idx < node.children.length; idx++) {
      const child = node.children[idx];
      const childIsLast = idx === node.children.length - 1;

      render(child, childPrefix, childIsLast);

      if (!childIsLast) {
        out.push(childPrefix + "│");
      }
    }
  };

  nodes.forEach((root, idx) => {
    out.push(root.text);

    if (root.children.length) {
      out.push("│");
      root.children.forEach((child, cidx) => {
        render(child, "", cidx === root.children.length - 1);
      });
    }

    if (idx !== nodes.length - 1) out.push("");
  });

  return out.join("\n");
}

// Import Jira ASCII (supports optional {code} wrapper).

function importJiraToIndented(raw: string, indentSize = 2): string {
  const withoutCode = raw
    .replace(/^\s*\{code(?::[^}]*)?\}\s*\n?/i, "")
    .replace(/\n?\s*\{code\}\s*$/i, "");

  const lines = withoutCode
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((l) => l.replace(/\s+$/g, "")); // Trim trailing whitespace.

  const out: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();

    if (trimmed.length === 0) {
      out.push("");
      continue;
    }

    // 1) Drop connector-only lines (│ and spaces).
    //    Examples: "│", "│  │", "   │   ", "│  │  │".
    if (/^[│\s]+$/.test(trimmed)) {
      continue;
    }

    const idxA = line.indexOf("├─ ");
    const idxB = line.indexOf("└─ ");
    const idx = idxA >= 0 ? idxA : idxB;

    // 2) Root line (no branch markers).
    if (idx < 0) {
      out.push(trimmed);
      continue;
    }

    const prefix = line.slice(0, idx);
    const text = line.slice(idx + 3).trim();

    // 3) ASCII prefix is built in 3-char blocks: "│  " or "   ".
    //    Root children have prefix.length === 0 and must become level 1.
    const level = Math.max(0, Math.floor(prefix.length / 3) + 1);

    out.push(" ".repeat(level * indentSize) + text);
  }

  while (out.length && out[out.length - 1].trim() === "") out.pop();

  return out.join("\n");
}

// Wrap text into a Jira {code:LANG} block.

function wrapForJira(code: string, language = "java"): string {
  return `{code:${language}}\n${code}\n{code}`;
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

// Flatten a tree into an array with parent/child references.

function flattenTree(roots: Node[]): FlatNode[] {
  let id = 1;
  const flat: FlatNode[] = [];

  const walk = (node: Node, depth: number, parentId: number | null) => {
    const myId = id++;
    const entry: FlatNode = { id: myId, text: node.text, depth, parentId, childrenIds: [] };
    flat.push(entry);

    for (const child of node.children) {
      const childId = walk(child, depth + 1, myId);
      entry.childrenIds.push(childId);
    }
    return myId;
  };

  for (const r of roots) walk(r, 0, null);
  return flat;
}

// Word-wrap text into lines with a max character count.

function wrapTextToLines(text: string, maxCharsPerLine: number): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [""];

  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  const pushCurrent = () => {
    if (current.trim().length) lines.push(current.trim());
    current = "";
  };

  for (const w of words) {
    if (w.length > maxCharsPerLine) {
      pushCurrent();
      let chunk = w;
      while (chunk.length > maxCharsPerLine) {
        lines.push(chunk.slice(0, maxCharsPerLine));
        chunk = chunk.slice(maxCharsPerLine);
      }
      if (chunk.length) lines.push(chunk);
      continue;
    }

    const candidate = current ? `${current} ${w}` : w;
    if (candidate.length <= maxCharsPerLine) current = candidate;
    else {
      pushCurrent();
      current = w;
    }
  }
  pushCurrent();

  return lines.length ? lines : [clean];
}

// Measure text width and wrap by pixel width for SVG node sizing.
// We use an offscreen canvas with the same font as the SVG text.
let __measureCtx: CanvasRenderingContext2D | null = null;

function measureTextPx(text: string, font: string): number {
  if (!__measureCtx) {
    const c = document.createElement("canvas");
    __measureCtx = c.getContext("2d");
  }
  if (!__measureCtx) return text.length * 7; // Fallback (should not happen in browsers)
  __measureCtx.font = font;
  return __measureCtx.measureText(text).width;
}

function wrapTextToLinesPx(text: string, maxWidthPx: number, font: string): string[] {
  const clean = text.replace(/\s+/g, " ").trim();
  if (!clean) return [""];

  // Extended word-wrap:
  // - primary breaks: spaces
  // - additional soft breaks after: '-', '/', ':', '+' (useful for technical text)
  // - if a single token still doesn't fit, split by characters

  const splitWordWithSoftBreaks = (word: string): string[] => {
    // Split and keep delimiters as separate tokens.
    const parts = word.split(/([\-\/:\+])/g).filter((p) => p.length > 0);

    // Re-attach delimiters to the left side so we can break AFTER them.
    const out: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (p.length === 1 && "-/:+".includes(p)) {
        if (out.length === 0) out.push(p);
        else out[out.length - 1] = out[out.length - 1] + p;
      } else {
        out.push(p);
      }
    }
    return out;
  };

  const words = clean.split(" ");
  const lines: string[] = [];
  let current = "";

  const push = () => {
    const t = current.trim();
    if (t.length) lines.push(t);
    current = "";
  };

  const pushToken = (token: string, withLeadingSpace: boolean) => {
    const prefixed = withLeadingSpace && current.length ? ` ${token}` : token;
    const candidate = current ? current + prefixed : token;
    if (measureTextPx(candidate, font) <= maxWidthPx) {
      current = candidate;
      return;
    }

    // If current line already has something — wrap.
    if (current.trim().length) {
      push();
      // Retry without a leading space on a new line.
      if (measureTextPx(token, font) <= maxWidthPx) {
        current = token;
        return;
      }
    }

    // Token still too long: split by characters.
    let chunk = "";
    for (const ch of token) {
      const next = chunk + ch;
      if (measureTextPx(next, font) <= maxWidthPx) chunk = next;
      else {
        if (chunk.length) lines.push(chunk);
        chunk = ch;
      }
    }
    if (chunk.length) {
      // If we are in the middle of building a line, continue there; otherwise push as a full line.
      if (current.trim().length === 0) lines.push(chunk);
      else current = chunk;
    }
    current = "";
  };

  for (const w of words) {
    const parts = splitWordWithSoftBreaks(w);
    for (let i = 0; i < parts.length; i++) {
      // Only the first part of the word may require a leading space.
      pushToken(parts[i], i === 0);
    }
  }
  push();

  return lines.length ? lines : [clean];
}


// Compute node positions and canvas size for SVG rendering.

function layoutTreeForSvg(flat: FlatNode[]) {
  const byId = new Map<number, FlatNode>();
  flat.forEach((n) => byId.set(n.id, n));
  const roots = flat.filter((n) => n.parentId === null).map((n) => n.id);

  // Sizing policy:
  // - Nodes shrink to fit their content, but never exceed MAX_NODE_W.
  // - Long labels wrap and grow down, not wider than MAX_NODE_W.
  const MIN_NODE_W = 120;
  const MAX_NODE_W = 210;

  const FONT_SIZE = 13;
  const FONT_FAMILY =
    "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  const FONT = `${FONT_SIZE}px ${FONT_FAMILY}`;

  const PADDING_X = 12;
  const PADDING_Y = 10;
  const LINE_H = 16;
  const MAX_LINES = 7;

  // Spacing between node "slots" (centers).
  const GAP_X = 54;
  const GAP_Y = 50;

  const clampW = (w: number) => Math.max(MIN_NODE_W, Math.min(MAX_NODE_W, w));

  const linesById = new Map<number, string[]>();
  const widthById = new Map<number, number>();
  const heightById = new Map<number, number>();

  for (const n of flat) {
    const clean = n.text.replace(/\s+/g, " ").trim();

    // Desired width if rendered in one line.
    const oneLineW = clampW(measureTextPx(clean, FONT) + PADDING_X * 2);

    const w = oneLineW;
    const innerW = Math.max(40, w - PADDING_X * 2);

    let lines = wrapTextToLinesPx(clean, innerW, FONT);
    if (lines.length > MAX_LINES) {
      lines = [...lines.slice(0, MAX_LINES - 1), lines[MAX_LINES - 1] + " …"];
    }

    // If the single-line width would exceed MAX_NODE_W, we cap width and wrap.
    const needsWrap = measureTextPx(clean, FONT) + PADDING_X * 2 > MAX_NODE_W;
    const finalW = needsWrap ? MAX_NODE_W : w;

    // If we capped width, re-wrap using the capped width (more accurate).
    const finalInnerW = Math.max(40, finalW - PADDING_X * 2);
    if (needsWrap) {
      lines = wrapTextToLinesPx(clean, finalInnerW, FONT);
      if (lines.length > MAX_LINES) {
        lines = [...lines.slice(0, MAX_LINES - 1), lines[MAX_LINES - 1] + " …"];
      }
    }

    linesById.set(n.id, lines);
    widthById.set(n.id, finalW);
    heightById.set(n.id, PADDING_Y * 2 + lines.length * LINE_H + 8);
  }

  const isLeaf = (id: number) => (byId.get(id)?.childrenIds.length ?? 0) === 0;

  // Keep the current "triangle" geometry: leaves define horizontal ordering.
  // We space node centers by MAX_NODE_W so variable widths never overlap.
  let leafCursor = 0;
  const leafX = new Map<number, number>();
  const assignLeaves = (id: number) => {
    const n = byId.get(id)!;
    if (isLeaf(id)) {
      leafX.set(id, leafCursor++);
      return;
    }
    n.childrenIds.forEach(assignLeaves);
  };
  roots.forEach(assignLeaves);

  const xUnit = new Map<number, number>();
  const computeX = (id: number) => {
    const n = byId.get(id)!;
    n.childrenIds.forEach(computeX);
    if (isLeaf(id)) xUnit.set(id, leafX.get(id)!);
    else {
      const xs = n.childrenIds.map((cid) => xUnit.get(cid)!);
      xUnit.set(id, xs.reduce((a, b) => a + b, 0) / xs.length);
    }
  };
  roots.forEach(computeX);

  const maxDepth = Math.max(0, ...flat.map((n) => n.depth));
  const maxHPerDepth: number[] = Array.from({ length: maxDepth + 1 }, () => 0);
  for (const n of flat) {
    const h = heightById.get(n.id)!;
    maxHPerDepth[n.depth] = Math.max(maxHPerDepth[n.depth], h);
  }

  const yTopByDepth: number[] = [];
  let accY = 30;
  for (let d = 0; d <= maxDepth; d++) {
    yTopByDepth[d] = accY;
    accY += maxHPerDepth[d] + GAP_Y;
  }

  const SLOT_W = MAX_NODE_W;
  const pxX = (u: number) => 30 + u * (SLOT_W + GAP_X);

  let positioned: PositionedNode[] = flat.map((n) => {
    const cx = pxX(xUnit.get(n.id)!);
    const w = widthById.get(n.id)!;
    const x = cx - w / 2;
    const y = yTopByDepth[n.depth];
    const lines = linesById.get(n.id)!;
    const h = heightById.get(n.id)!;
    return { ...n, x, y, w, h, lines };
  });

  const minX = Math.min(...positioned.map((p) => p.x));
  const minY = Math.min(...positioned.map((p) => p.y));
  const MARGIN = 20;
  const MIN_CANVAS_W = 900;
  const MIN_CANVAS_H = 600;

  const dx = minX < MARGIN ? MARGIN - minX : 0;
  const dy = minY < MARGIN ? MARGIN - minY : 0;

  if (dx || dy) positioned = positioned.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));

  // Center content horizontally within the canvas (X only).
  const contentMinX = Math.min(...positioned.map((p) => p.x));
  const contentMaxX = Math.max(...positioned.map((p) => p.x + p.w));
  const contentWidth = contentMaxX - contentMinX;

  const canvasWidth = Math.max(contentMaxX, MIN_CANVAS_W) + MARGIN;
  const desiredMinX = Math.max(MARGIN, (canvasWidth - contentWidth) / 2);
  const dxCenter = desiredMinX - contentMinX;

  if (dxCenter) positioned = positioned.map((p) => ({ ...p, x: p.x + dxCenter, y: p.y }));

  const maxX = Math.max(...positioned.map((p) => p.x + p.w), MIN_CANVAS_W);
  const maxY = Math.max(...positioned.map((p) => p.y + p.h), MIN_CANVAS_H);

  return {
    positioned,
    width: maxX + MARGIN,
    height: maxY + MARGIN,
    consts: { PADDING_X, PADDING_Y, LINE_H, FONT_SIZE, FONT_FAMILY, MAX_NODE_W },
  };
}
// Clamp a number to the [lo, hi] range.

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

// Trigger a browser download for a given Blob.

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function exportSvgAsPng(
  svgEl: SVGSVGElement,
  outW: number,
  outH: number,
  filename: string,
  viewBoxOverride?: { x: number; y: number; w: number; h: number }
) {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(outW));
  clone.setAttribute("height", String(outH));

  if (viewBoxOverride) {
    clone.setAttribute("viewBox", `${viewBoxOverride.x} ${viewBoxOverride.y} ${viewBoxOverride.w} ${viewBoxOverride.h}`);
  } else {
    clone.setAttribute("viewBox", `0 0 ${outW} ${outH}`);
  }

  const serializer = new XMLSerializer();
  const svgText = serializer.serializeToString(clone);
  const svgBlob = new Blob([svgText], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(svgBlob);

  const img = new Image();
  img.decoding = "async";

  const pngBlob: Blob = await new Promise((resolve, reject) => {
    img.onload = () => {
      try {
        const canvas = document.createElement("canvas");
        canvas.width = Math.ceil(outW);
        canvas.height = Math.ceil(outH);

        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("canvas ctx is null");

        // White background (so SVG transparency does not become black in PNG).
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);

        canvas.toBlob((b) => {
          if (!b) reject(new Error("toBlob returned null"));
          else resolve(b);
        }, "image/png");
      } catch (e) {
        reject(e);
      } finally {
        URL.revokeObjectURL(url);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("SVG image load failed"));
    };
    img.src = url;
  });

  downloadBlob(pngBlob, filename);
}

export default function App() {

  //const CONTENT_HEIGHT = 660;
  const CONTENT_HEIGHT = "clamp(520px, calc(100vh - 200px), 920px)";
  //const CONTENT_HEIGHT = "calc(100vh - 200px)"; 
  const HEADER_HEIGHT = 36;
  const FOOTER_HEIGHT = 36;
  const ROW_GAP = 6;
  const INDENT_SIZE = 2;

  const COLUMN_STYLE: React.CSSProperties = {
    display: "grid",
    gridTemplateRows: `${HEADER_HEIGHT}px ${CONTENT_HEIGHT}px ${FOOTER_HEIGHT}px`,
    rowGap: ROW_GAP,
    minWidth: 0,
  };

  const FOOTER_STYLE: React.CSSProperties = {
    height: FOOTER_HEIGHT,
    color: "#555",
    fontSize: 11,
    lineHeight: "18px",
    overflow: "hidden",
    whiteSpace: "normal",
  };

  const [input, setInput] = useState(DEFAULT_INPUT);
  const [wrap, setWrap] = useState(true);
  const [lang, setLang] = useState("java");

  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; px: number; py: number } | null>(null);

  const [isImportOpen, setIsImportOpen] = useState(false);
  const [importText, setImportText] = useState("");

const [isHistoryOpen, setIsHistoryOpen] = useState(false);
const [history, setHistory] = useState<HistoryEntry[]>([]);

const HISTORY_LS_KEY = "dtb.history.v1";
const HISTORY_MAX = 50;
  const MODAL_MIN_H = 560;

const safeJsonParse = <T,>(raw: string | null, fallback: T): T => {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
};

const deriveTitleFromInput = (text: string): string => {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0);
  return lines[0] ?? "(пусто)";
};

const loadHistory = (): HistoryEntry[] => {
  const raw = localStorage.getItem(HISTORY_LS_KEY);
  const parsed = safeJsonParse<HistoryEntry[]>(raw, []);
  // Normalize and drop invalid entries.
  const cleaned = parsed
    .filter((e) => e && typeof e.text === "string")
    .map((e) => ({
      id: typeof e.id === "string" ? e.id : String(e.ts ?? Date.now()),
      createdTs: typeof (e as any).createdTs === "number" ? (e as any).createdTs : (typeof e.ts === "number" ? e.ts : Date.now()),
      ts: typeof e.ts === "number" ? e.ts : Date.now(),
      title: typeof e.title === "string" && e.title.trim().length ? e.title : deriveTitleFromInput(e.text),
      text: e.text,
    }))
    .slice(0, HISTORY_MAX);
  return cleaned;
};

const persistHistory = (items: HistoryEntry[]) => {
  try {
    localStorage.setItem(HISTORY_LS_KEY, JSON.stringify(items.slice(0, HISTORY_MAX)));
  } catch (e) {
    console.warn("Failed to persist history", e);
  }
};

const HOUR_MS = 60 * 60 * 1000;

const pushToHistory = (text: string) => {
  const trimmed = text.trim();
  if (trimmed.length === 0) return;

  // Do not store the default template (autosave or manual).
  if (text === DEFAULT_INPUT) return;

  const now = Date.now();
  const title = deriveTitleFromInput(text);

  const current = loadHistory();

  // Avoid consecutive duplicates.
  const last = current[0];
  if (last && last.text === text) return;

  // "One-hour per title" rule:
  // - if the newest entry with the same title was created < 1 hour ago,
  //   update it (ts/text) instead of adding a new one.
  // - if >= 1 hour, create a new entry even with the same title.
  const sameTitleIdx = current.findIndex((e) => e.title === title);
  if (sameTitleIdx >= 0) {
    const existing = current[sameTitleIdx];
    const created = typeof (existing as any).createdTs === "number" ? (existing as any).createdTs : existing.ts;
    const ageMs = now - created;

    // If text is unchanged, do nothing (avoid extending the window indefinitely).
    if (existing.text === text) return;

    if (ageMs < HOUR_MS) {
      const updated: HistoryEntry = {
        ...existing,
        ts: now,
        text,
        title,
        createdTs: created,
      };

      const next = [
        updated,
        ...current
          .filter((_, i) => i !== sameTitleIdx)
          // Deduplicate by full text.
          .filter((e) => e.text !== text),
      ].slice(0, HISTORY_MAX);

      persistHistory(next);
      setHistory(next);
      return;
    }
  }

  const entry: HistoryEntry = {
    id: `${now}-${Math.random().toString(16).slice(2)}`,
    createdTs: now,
    ts: now,
    title,
    text,
  };

  // Deduplicate by full text.
  const next = [entry, ...current.filter((e) => e.text !== text)].slice(0, HISTORY_MAX);
  persistHistory(next);
  setHistory(next);
};

const clearHistory = () => {
  localStorage.removeItem(HISTORY_LS_KEY);
  setHistory([]);
};


const formatDateTime = (ts: number): string => {
  const d = new Date(ts); // timezone from device
  const pad2 = (n: number) => String(n).padStart(2, "0");
  return `${pad2(d.getDate())}.${pad2(d.getMonth() + 1)}.${d.getFullYear()} ${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
};

const deleteHistoryEntry = (id: string) => {
  const next = loadHistory().filter((e) => e.id !== id);
  persistHistory(next);
  setHistory(next);

  // UX: if the last entry was deleted, close the modal and restore the default template.
  if (next.length === 0) {
    setIsHistoryOpen(false);
    setInput(DEFAULT_INPUT);
  }
};


useEffect(() => {
  // On startup: show latest history entry, otherwise the default template.
  const h = loadHistory();
  if (h.length > 0) {
    setInput(h[0].text);
  } else {
    setInput(DEFAULT_INPUT);
  }
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, []);

useEffect(() => {
  if (!isImportOpen && !isHistoryOpen) return;

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key !== "Escape") return;

    // If both modals are open, close Import first, otherwise close History.
    if (isImportOpen) {
      setIsImportOpen(false);
      return;
    }
    if (isHistoryOpen) {
      setIsHistoryOpen(false);
    }
  };

  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}, [isImportOpen, isHistoryOpen]);






  const svgRef = useRef<SVGSVGElement | null>(null);

  const parsed = useMemo(() => parseIndentedTree(input, INDENT_SIZE), [input]);
  const ascii = useMemo(() => renderAsciiTree(parsed), [parsed]);
  const jiraOut = useMemo(() => (wrap ? wrapForJira(ascii, lang) : ascii), [ascii, wrap, lang]);

  const flat = useMemo(() => flattenTree(parsed), [parsed]);
  const layout = useMemo(() => layoutTreeForSvg(flat), [flat]);

  const posById = useMemo(() => {
    const m = new Map<number, PositionedNode>();
    for (const p of layout.positioned) m.set(p.id, p);
    return m;
  }, [layout.positioned]);

  const zoomIn = () => setZoom((z) => clamp(Number((z * 1.15).toFixed(3)), 0.4, 5));
  const zoomOut = () => setZoom((z) => clamp(Number((z / 1.15).toFixed(3)), 0.4, 5));
  const resetView = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  const onGraphWheel: React.WheelEventHandler<HTMLDivElement> = (e) => {
    e.preventDefault();

    const dy = e.deltaY;
    const intensity = Math.min(1, Math.abs(dy) / 60);
    const step = 0.01 + intensity * 0.05;
    const next = dy > 0 ? 1 - step : 1 + step;

    setZoom((z) => clamp(Number((z * next).toFixed(4)), 0.4, 5));
  };

const saveGraphPng = async () => {
  try {
    // Mandatory save on Save PNG
    pushToHistory(input);

    if (!svgRef.current) {
      alert("SVG не найден.");
      return;
    }

    const filename = `decision-tree-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;

    // Fit-to-content export:
    // - UI canvas may be larger (MIN_CANVAS_*), but the exported PNG should be tightly cropped.
    // - We keep a padding so that strokes/curves are not clipped.
    const PAD = 32;

    if (layout.positioned.length === 0) {
      // Nothing to crop – export the whole canvas.
      await exportSvgAsPng(svgRef.current, layout.width, layout.height, filename);
      return;
    }

    const xs = layout.positioned.flatMap((p) => [p.x, p.x + p.w]);
    const ys = layout.positioned.flatMap((p) => [p.y, p.y + p.h]);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    const vbX = Math.floor(minX - PAD);
    const vbY = Math.floor(minY - PAD);
    const vbW = Math.ceil(maxX - minX + PAD * 2);
    const vbH = Math.ceil(maxY - minY + PAD * 2);

    await exportSvgAsPng(svgRef.current, vbW, vbH, filename, { x: vbX, y: vbY, w: vbW, h: vbH });
  } catch (e: any) {
    console.error(e);
    alert(`Не удалось сохранить изображение: ${e?.message ?? e}`);
  }
};

  const runImport = () => {
    const converted = importJiraToIndented(importText, INDENT_SIZE);
    if (converted.trim().length === 0) {
      alert("Не удалось распознать дерево. Проверьте, что вы вставили текст из Jira (можно с {code}).");
      return;
    }
    setInput(converted);
    pushToHistory(converted);
    setIsImportOpen(false);
    setImportText("");
  };

  const Header = (props: { title: string; right: React.ReactNode }) => (
    <div
      style={{
        height: HEADER_HEIGHT,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
      }}
    >
      <div style={{ fontWeight: 600 }}>{props.title}</div>
      {props.right}
    </div>
  );

  const Header3 = (props: { title: string; center?: React.ReactNode; right?: React.ReactNode }) => (
    <div
      style={{
        height: HEADER_HEIGHT,
        display: "grid",
        gridTemplateColumns: "1fr auto 1fr",
        alignItems: "center",
        columnGap: 10,
      }}
    >
      <div style={{ justifySelf: "start", fontWeight: 600 }}>{props.title}</div>
      <div style={{ justifySelf: "center" }}>{props.center}</div>
      <div style={{ justifySelf: "end" }}>{props.right}</div>
    </div>
  );

  const onInputKeyDown: React.KeyboardEventHandler<HTMLTextAreaElement> = (e) => {
    if (e.key !== "Enter" || e.shiftKey) return;
    // @ts-ignore
    if ((e as any).isComposing) return;

    e.preventDefault();

    const el = e.currentTarget;
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;

    const indent = getLineIndentBeforeCursor(input, start);
    const insert = "\n" + " ".repeat(indent + INDENT_SIZE);

    const next = input.slice(0, start) + insert + input.slice(end);
    setInput(next);

    const nextPos = start + insert.length;
    requestAnimationFrame(() => {
      el.selectionStart = nextPos;
      el.selectionEnd = nextPos;
    });
  };

// Autosave input to history (debounced).
useEffect(() => {
  const t = window.setTimeout(() => {
    pushToHistory(input);
  }, 800);
  return () => window.clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
}, [input]);


  return (
<div
  style={{
    fontFamily: "system-ui, sans-serif",
    padding: 8,
    width: "min(2200px, 100%)",
    margin: "0 auto",
    overflow: "hidden",
    boxSizing: "border-box",
  }}
>
      <h2 style={{ margin: "0 0 8px" }}>Decision Tree Builder</h2>

      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }} title="Добавляет обёртку {code:...} для Jira">
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
          Оборачивать в {"{code}"}
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }} title="Язык для {code:LANG} (например java)">
          Язык:
          <input
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            style={{ width: 90, padding: "4px 6px" }}
            disabled={!wrap}
          />
        </label>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1.15fr 2.2fr", gap: 12, alignItems: "start" }}>
        {/* INPUT */}
        <div style={COLUMN_STYLE}>
          <Header
            title="Действия"
            right={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button
                  title="Конвертировать ASCII-схему в обычный текст с отступами"
                  onClick={() => {
                    setIsImportOpen(true);
                    setImportText("");
                  }}
                  style={{ padding: "6px 10px", cursor: "pointer" }}
                >
                  Import
                </button>
<button
  title="Открыть историю"
  onClick={() => {
    setHistory(loadHistory());
    setIsHistoryOpen(true);
  }}
  style={{ padding: "6px 10px", cursor: "pointer" }}
>
  History
</button>


                <button
                  title="Скопировать схему с отступами"
                  onClick={() => { pushToHistory(input); copyToClipboard(input); }}
                  style={{ padding: "6px 10px", cursor: "pointer" }}
                >
                  Copy
                </button>
              </div>
            }
          />

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onInputKeyDown}
            style={{
              width: "100%",
              height: CONTENT_HEIGHT,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
              fontSize: 13,
              padding: 10,
              border: "1px solid #ccc",
              borderRadius: 8,
              resize: "none",
              boxSizing: "border-box",
            }}
          />

          <div style={FOOTER_STYLE}>
            Отступ 2 пробела = новый уровень. Пустые строки игнорируются.<br />
            Enter: новый шаг на уровень ниже, Shift+Enter: обычный перенос.
          </div>
        </div>

        {/* JIRA */}
        <div style={COLUMN_STYLE}>
          <Header
            title="ASCII"
            right={
              <button
                title="Скопировать ASCII-схему"
                onClick={() => copyToClipboard(jiraOut)}
                style={{ padding: "6px 10px", cursor: "pointer" }}
              >
                Copy
              </button>
            }
          />

          <pre
            style={{
              width: "100%",
              height: CONTENT_HEIGHT,
              overflowY: "auto",
              overflowX: "hidden",
              background: "#fafafa",
              border: "1px solid #ccc",
              borderRadius: 8,
              padding: 10,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
              fontSize: 13,
              whiteSpace: "pre-wrap",
              wordBreak: "break-word",
              margin: 0,
              color: "#111",
              boxSizing: "border-box",
              minWidth: 0,
            }}
          >
            {jiraOut}
          </pre>

          <div style={FOOTER_STYLE}>Готовая схема для вставки в Jira.<br />
          Можно конвертировать в обычный текст через Import.
          </div>
        </div>

        {/* GRAPHIC */}
        <div style={COLUMN_STYLE}>
          <Header3
            title="Диаграмма"
            center={
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <button title="Уменьшить масштаб" onClick={zoomOut} style={{ padding: "6px 10px", cursor: "pointer" }}>
                  −
                </button>

                <div title="Текущий масштаб" style={{ minWidth: 64, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
                  {Math.round(zoom * 100)}%
                </div>

                <button title="Увеличить масштаб" onClick={zoomIn} style={{ padding: "6px 10px", cursor: "pointer" }}>
                  +
                </button>

                <button title="Сбросить масштаб и смещение" onClick={resetView} style={{ padding: "6px 10px", cursor: "pointer" }}>
                  Reset
                </button>
              </div>
            }
            right={
              <button title="Сохранить в PNG схему в текущем масштабе" onClick={saveGraphPng} style={{ padding: "6px 10px", cursor: "pointer" }}>
                Save
              </button>
            }
          />

          <div
            onWheel={onGraphWheel}
            onMouseDown={(e) => {
              setIsPanning(true);
              setPanStart({ x: e.clientX, y: e.clientY, px: panX, py: panY });
            }}
            onMouseMove={(e) => {
              if (!isPanning || !panStart) return;
              const dx = e.clientX - panStart.x;
              const dy = e.clientY - panStart.y;
              setPanX(panStart.px + dx);
              setPanY(panStart.py + dy);
            }}
            onMouseUp={() => {
              setIsPanning(false);
              setPanStart(null);
            }}
            onMouseLeave={() => {
              setIsPanning(false);
              setPanStart(null);
            }}
            style={{
              border: "1px solid #ccc",
              borderRadius: 8,
              background: "#fff",
              height: CONTENT_HEIGHT,
              width: "100%",
              overflow: "hidden",
              position: "relative",
              cursor: isPanning ? "grabbing" : "grab",
              userSelect: "none",
              boxSizing: "border-box",
              display: "block",
              touchAction: "none",
            }}
          >
            <svg
              ref={svgRef}
              width="100%"
              height="100%"
              viewBox={`0 0 ${layout.width} ${layout.height}`}
              preserveAspectRatio="xMinYMin meet"
              style={{ display: "block" }}
            >
              <defs>
                <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
                  <feDropShadow dx="0" dy="1" stdDeviation="1.2" floodOpacity="0.18" />
                </filter>
                <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="black" />
                </marker>
              </defs>

              <rect x={0} y={0} width={layout.width} height={layout.height} fill="white" />

              <g transform={`translate(${panX}, ${panY}) scale(${zoom})`}>
                {/* edges */}
                {layout.positioned.flatMap((n) => {
                  if (!n.childrenIds.length) return [];
                  return n.childrenIds.map((cid) => {
                    const c = posById.get(cid);
                    if (!c) return null;

                    const x1 = n.x + n.w / 2;
                    const y1 = n.y + n.h;
                    const x2 = c.x + c.w / 2;
                    const y2 = c.y;

                    const midY = (y1 + y2) / 2;
                    const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;

                    return (
                      <path key={`${n.id}-${cid}`} d={d} fill="none" stroke="black" strokeWidth={1} markerEnd="url(#arrow)" opacity={0.9} />
                    );
                  });
                })}

                {/* nodes */}
                {layout.positioned.map((n) => {
                  const padX = (layout.consts as any)?.PADDING_X ?? 12;
                  const padY = (layout.consts as any)?.PADDING_Y ?? 10;
                  const fontSize = (layout.consts as any)?.FONT_SIZE ?? 12;
                  const lineH = (layout.consts as any)?.LINE_H ?? 16;
                  const fontFamily = (layout.consts as any)?.FONT_FAMILY ?? "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";

                  const textX = n.x + padX;
                  const textY = n.y + padY + fontSize + 2;
                  const isSingleLine = n.lines.length === 1;
                  const singleLine = isSingleLine ? n.lines[0] ?? "" : "";
                  // SVG "justify" via textLength/lengthAdjust stretches glyph spacing when there are too few spaces.
                  // Enable it only for single-line strings with at least 3 words (>=2 spaces).
                  const canJustify = isSingleLine && ((singleLine.match(/ /g)?.length ?? 0) >= 2);
                  const shouldCenter = isSingleLine && !canJustify;
                  const baseX = shouldCenter ? n.x + n.w / 2 : textX;
                  const textAnchor = shouldCenter ? "middle" : "start";
                  const availableW = Math.max(0, n.w - padX * 2);


                  return (
                    <g key={n.id} filter="url(#shadow)" pointerEvents="none">
                      <rect x={n.x} y={n.y} width={n.w} height={n.h} rx={10} ry={10} fill="white" stroke="black" strokeWidth={1} />
                      <text x={baseX} y={textY} fontFamily={fontFamily} fontSize={fontSize} textAnchor={textAnchor}>
                        {n.lines.map((line, idx) => {
                          return (
                            <tspan
                              key={idx}
                              x={baseX}
                              dy={idx === 0 ? 0 : lineH}
                              textLength={canJustify ? availableW : undefined}
                              lengthAdjust={canJustify ? "spacing" : undefined}
                            >
                              {line}
                            </tspan>
                          );
                        })}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          <div style={FOOTER_STYLE}>Сохранение в PNG в том виде как на экране (масштаб/смещение).<br />
          Масштаб: колесо мыши или кнопки -+. Смещение: зажать ЛКМ и тянуть.</div>
        </div>
      </div>

{/* MODAL: History */}
{isHistoryOpen && (
  <div
    role="dialog"
    aria-modal="true"
    onMouseDown={(e) => {
      if (e.target === e.currentTarget) {
        setIsHistoryOpen(false);
      }
    }}
    style={{
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.6)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      padding: 32,
      zIndex: 9999,
    }}
  >
    <div
      style={{
        width: "100%",
        maxWidth: 760,
        maxHeight: "calc(100vh - 64px)",
        minHeight: MODAL_MIN_H,
        display: "flex",
        flexDirection: "column",

        border: "1px solid rgba(255,255,255,0.10)",
        borderRadius: 12,
        background: "#1f1f1f",
        boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
        padding: 16,
        color: "#eaeaea",
      }}
    >
      <div
        style={{
          height: 40,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginBottom: 10,
        }}
      >
        <div style={{ fontWeight: 700, color: "#f2f2f2" }}>История</div>

        <button
          onClick={() => setIsHistoryOpen(false)}
          aria-label="Close"
          title="Закрыть"
          style={{
            width: 34,
            height: 34,
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.14)",
            background: "#262626",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 20,
            fontWeight: 700,
            color: "#f2f2f2",
            lineHeight: 1,
          }}
        >
          ×
        </button>
      </div>

      <div style={{ color: "rgba(255,255,255,0.70)", fontSize: 12, marginBottom: 8 }}>
        Последние {HISTORY_MAX} схем. История хранится локально в браузере. Название схемы: первая строка в поле Действия.
      </div>

      <div
        style={{
          border: "1px solid rgba(255,255,255,0.12)",
          borderRadius: 10,
          background: "#141414",
          overflow: "hidden",
          flex: 1,
          minHeight: 0,
        }}
      >
        <div style={{ height: "100%", overflowY: "auto" }}>
          {history.length === 0 ? (
            <div style={{ padding: 12, color: "rgba(255,255,255,0.65)", fontSize: 13 }}>История пуста.</div>
          ) : (
            history.map((h) => (
              <div
                key={h.id}
                style={{
                  display: "flex",
                  alignItems: "stretch",
                  borderBottom: "1px solid rgba(255,255,255,0.08)",
                }}
              >
                <button
                  onClick={() => {
                    setInput(h.text);
                    setIsHistoryOpen(false);
                  }}
                  title="Загрузить схему в поле «Действия»"
                  style={{
                    flex: 1,
                    textAlign: "left",
                    padding: "10px 12px",
                    cursor: "pointer",
                    background: "transparent",
                    color: "#eaeaea",
                    border: "none",
                    fontSize: 13,
                  }}
                >
                  <div style={{ fontWeight: 600, color: "#f2f2f2" }}>{h.title}</div>
                  <div style={{ fontSize: 11, color: "rgba(255,255,255,0.55)", marginTop: 2 }}>
                    {formatDateTime(h.ts)}
                  </div>
                </button>

                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteHistoryEntry(h.id);
                  }}
                  title="Удалить запись"
                  aria-label="Delete"
                  style={{
                    width: 44,
                    border: "none",
                    background: "transparent",
                    cursor: "pointer",
                    color: "rgba(255,255,255,0.70)",
                    fontSize: 18,
                    fontWeight: 700,
                  }}
                >
                  ×
                </button>
              </div>
            ))
          )}
        </div>
      </div>

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, marginTop: 10 }}>
        <div style={{ color: "rgba(255,255,255,0.60)", fontSize: 12 }}>
          Выберите схему, чтобы загрузить её в поле Действия. Кнопка Clear очищает историю.
        </div>

        <button
          title="Очистить историю схем"
          onClick={() => {
                  const ok = window.confirm("Очистить историю схем?");
                  if (!ok) return;
                  clearHistory();
                  setIsHistoryOpen(false);
                  setInput(DEFAULT_INPUT);
                }}
          style={{
            padding: "6px 12px",
            cursor: "pointer",
            borderRadius: 8,
            border: "1px solid rgba(255,255,255,0.16)",
            background: "#262626",
            color: "#f2f2f2",
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          Clear
        </button>
      </div>
    </div>
  </div>
)}

      {/* MODAL: Import Jira */}
      {isImportOpen && (
        <div
          role="dialog"
          aria-modal="true"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) {
              setIsImportOpen(false);
              setImportText("");
            }
          }}
          style={{
            position: "fixed",
            inset: 0,
            // Slightly darker to dim the background behind the modal.
            background: "rgba(0,0,0,0.6)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: 32,
            zIndex: 9999,
          }}
        >
          <div
            style={{
              width: "100%",
              maxWidth: 760,
              maxHeight: "calc(100vh - 64px)",
        minHeight: MODAL_MIN_H,
              display: "flex",
              flexDirection: "column",

              // Dark UI card styling.
              border: "1px solid rgba(255,255,255,0.10)",
              borderRadius: 12,
              background: "#1f1f1f",
              boxShadow: "0 18px 60px rgba(0,0,0,0.55)",
              padding: 16,
              color: "#eaeaea",
            }}
          >
            {/* Header */}
            <div
              style={{
                height: 40,
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                marginBottom: 10,
              }}
            >
              <div style={{ fontWeight: 700, color: "#f2f2f2" }}>Импорт из ASCII</div>

              <button
                onClick={() => {
                  setIsImportOpen(false);
                  setImportText("");
                }}
                aria-label="Close"
                title="Закрыть"
                style={{
                  width: 34,
                  height: 34,
                  borderRadius: 8,
                  border: "1px solid rgba(255,255,255,0.14)",
                  background: "#262626",
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontSize: 20,
                  fontWeight: 700,
                  color: "#f2f2f2",
                  lineHeight: 1,
                }}
              >
                ×
              </button>
            </div>

            {/* Description */}
            <div style={{ color: "rgba(255,255,255,0.70)", fontSize: 12, marginBottom: 8 }}>
              Вставьте ASCII-схему для восстановления обычного текста с отступами. Можно вставить вместе с {"{code}"}.
            </div>

            {/* Textarea */}
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              placeholder={`{code:java}\n...\n{code}`}
              style={{
                width: "100%",
                flex: 1,
                minHeight: 0,
                fontFamily:
                  "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
                fontSize: 13,
                padding: 10,
                borderRadius: 10,
                resize: "vertical",
                boxSizing: "border-box",
                outline: "none",

                // Dark textarea styling.
                background: "#141414",
                color: "#eaeaea",
                border: "1px solid rgba(255,255,255,0.12)",
              }}
            />

            {/* Footer */}
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 12,
                marginTop: 10,
                //paddingTop: 10,
                //borderTop: "1px solid rgba(255,255,255,0.10)",
              }}
            >
              <div style={{ color: "rgba(255,255,255,0.60)", fontSize: 12 }}>
                Нажмите кнопку Import, чтобы импортировать в поле Действия обычный текст.
              </div>

              <button
                title="Импортировать и заменить текст в поле Действия"
                onClick={runImport}
                style={{
                  padding: "6px 12px",
                  cursor: "pointer",
                  borderRadius: 8,

                  // Dark button styling.
                  border: "1px solid rgba(255,255,255,0.16)",
                  background: "#262626",
                  color: "#f2f2f2",
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                Import
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
