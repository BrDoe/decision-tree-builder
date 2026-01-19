// src/App.tsx
import { useMemo, useRef, useState } from "react";

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

const DEFAULT_INPUT = `В запросе передан: manager
  manager == null?
    Нет
      Используем переданное значение manager
    Да
      Пытаемся достать manager из statdb
        Успешно (manager найден)
          Установить/сохранить manager из statdb
        Неуспешно (не найден / statdb недоступна / ошибка)
          Обнулить manager у аккаунта`;

function countLeadingSpaces(s: string): number {
  let i = 0;
  while (i < s.length && s[i] === " ") i++;
  return i;
}

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

function renderAsciiTree(nodes: Node[]): string {
  const out: string[] = [];

  const render = (node: Node, prefix: string, isLast: boolean) => {
    const connector = isLast ? "└─ " : "├─ ";
    out.push(prefix + connector + node.text);

    if (!node.children.length) return;

    const childPrefix = prefix + (isLast ? "   " : "│  ");
    out.push(childPrefix + "│");

    node.children.forEach((child, idx) => {
      render(child, childPrefix, idx === node.children.length - 1);
    });
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

function wrapForJira(code: string, language = "java"): string {
  return `{code:${language}}\n${code}\n{code}`;
}

async function copyToClipboard(text: string) {
  await navigator.clipboard.writeText(text);
}

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

function layoutTreeForSvg(flat: FlatNode[]) {
  const byId = new Map<number, FlatNode>();
  flat.forEach((n) => byId.set(n.id, n));
  const roots = flat.filter((n) => n.parentId === null).map((n) => n.id);

  const NODE_W = 300;
  const PADDING_X = 12;
  const PADDING_Y = 10;
  const LINE_H = 16;
  const MAX_LINES = 7;
  const CHARS_PER_LINE = 32;
  const GAP_X = 54;
  const GAP_Y = 50;

  const linesById = new Map<number, string[]>();
  const heightById = new Map<number, number>();
  for (const n of flat) {
    let lines = wrapTextToLines(n.text, CHARS_PER_LINE);
    if (lines.length > MAX_LINES) lines = [...lines.slice(0, MAX_LINES - 1), lines[MAX_LINES - 1] + " …"];
    linesById.set(n.id, lines);
    heightById.set(n.id, PADDING_Y * 2 + lines.length * LINE_H + 8);
  }

  const isLeaf = (id: number) => (byId.get(id)?.childrenIds.length ?? 0) === 0;

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

  const pxX = (u: number) => 30 + u * (NODE_W + GAP_X);

  let positioned: PositionedNode[] = flat.map((n) => {
    const cx = pxX(xUnit.get(n.id)!);
    const x = cx - NODE_W / 2;
    const y = yTopByDepth[n.depth];
    const lines = linesById.get(n.id)!;
    const h = heightById.get(n.id)!;
    return { ...n, x, y, w: NODE_W, h, lines };
  });

  const minX = Math.min(...positioned.map((p) => p.x));
  const minY = Math.min(...positioned.map((p) => p.y));
  const MARGIN = 20;

  const dx = minX < MARGIN ? MARGIN - minX : 0;
  const dy = minY < MARGIN ? MARGIN - minY : 0;

  if (dx || dy) positioned = positioned.map((p) => ({ ...p, x: p.x + dx, y: p.y + dy }));

  const maxX = Math.max(...positioned.map((p) => p.x + p.w), 420);
  const maxY = Math.max(...positioned.map((p) => p.y + p.h), 240);

  return {
    positioned,
    width: maxX + MARGIN,
    height: maxY + MARGIN,
    consts: { NODE_W, PADDING_X, PADDING_Y, LINE_H },
  };
}

function clamp(v: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, v));
}

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

/**
 * Экспорт SVG->PNG и сохранение на диск.
 * Важно: поддерживается на GitHub Pages (https).
 */
async function exportSvgAsPng(svgEl: SVGSVGElement, outW: number, outH: number, filename: string) {
  const clone = svgEl.cloneNode(true) as SVGSVGElement;
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.setAttribute("width", String(outW));
  clone.setAttribute("height", String(outH));
  clone.setAttribute("viewBox", `0 0 ${outW} ${outH}`);

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

        // белый фон
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
  // ВАЖНО: одинаковая высота контентных областей для всех 3 колонок
  // Также выравниваем “шапки” (заголовок+кнопка) одинаковой высотой.
  const CONTENT_HEIGHT = 660;
  const HEADER_HEIGHT = 36;

  const [input, setInput] = useState(DEFAULT_INPUT);
  const [wrap, setWrap] = useState(true);
  const [lang, setLang] = useState("java");

  // Zoom + Pan
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(0);
  const [panY, setPanY] = useState(0);

  const [isPanning, setIsPanning] = useState(false);
  const [panStart, setPanStart] = useState<{ x: number; y: number; px: number; py: number } | null>(null);

  // Держим ref на SVG, чтобы сохранить на диск
  const svgRef = useRef<SVGSVGElement | null>(null);

  const parsed = useMemo(() => parseIndentedTree(input, 2), [input]);
  const ascii = useMemo(() => renderAsciiTree(parsed), [parsed]);
  const jiraOut = useMemo(() => (wrap ? wrapForJira(ascii, lang) : ascii), [ascii, wrap, lang]);

  const flat = useMemo(() => flattenTree(parsed), [parsed]);
  const layout = useMemo(() => layoutTreeForSvg(flat), [flat]);

  const posById = useMemo(() => {
    const m = new Map<number, PositionedNode>();
    for (const p of layout.positioned) m.set(p.id, p);
    return m;
  }, [layout.positioned]);

  const zoomIn = () => setZoom((z) => clamp(Number((z * 1.15).toFixed(3)), 0.4, 3));
  const zoomOut = () => setZoom((z) => clamp(Number((z / 1.15).toFixed(3)), 0.4, 3));
  const resetView = () => {
    setZoom(1);
    setPanX(0);
    setPanY(0);
  };

  const saveGraphPng = async () => {
    try {
      if (!svgRef.current) {
        alert("SVG не найден.");
        return;
      }
      const filename = `decision-tree-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.png`;
      // Экспортируем “виртуальное полотно” layout.width/height (а не размер viewport)
      await exportSvgAsPng(svgRef.current, layout.width, layout.height, filename);
    } catch (e: any) {
      console.error(e);
      alert(`Не удалось сохранить PNG: ${e?.message ?? e}`);
    }
  };

  const Header = (props: { title: string; right: React.ReactNode }) => (
    <div
      style={{
        height: HEADER_HEIGHT,
        marginBottom: 6,
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

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 10, maxWidth: 1800, margin: "0 auto" }}>
      <h2 style={{ margin: "0 0 8px" }}>Decision Tree Builder</h2>

      {/* Общие настройки */}
      <div style={{ display: "flex", gap: 12, alignItems: "center", marginBottom: 10, flexWrap: "wrap" }}>
        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="checkbox" checked={wrap} onChange={(e) => setWrap(e.target.checked)} />
          Оборачивать в Jira {"{code}"}
        </label>

        <label style={{ display: "flex", gap: 8, alignItems: "center" }}>
          Язык:
          <input
            value={lang}
            onChange={(e) => setLang(e.target.value)}
            style={{ width: 90, padding: "4px 6px" }}
            disabled={!wrap}
          />
        </label>

        <div style={{ width: 10 }} />

        <button onClick={zoomOut} style={{ padding: "6px 10px", cursor: "pointer" }}>
          −
        </button>
        <div style={{ minWidth: 64, textAlign: "center", fontVariantNumeric: "tabular-nums" }}>
          {Math.round(zoom * 100)}%
        </div>
        <button onClick={zoomIn} style={{ padding: "6px 10px", cursor: "pointer" }}>
          +
        </button>
        <button onClick={resetView} style={{ padding: "6px 10px", cursor: "pointer" }}>
          Reset
        </button>

        <div style={{ color: "#666", fontSize: 12 }}>Панорамирование: ЛКМ + drag по графику.</div>
      </div>

      {/* 3 колонки */}
      <div style={{ display: "grid", gridTemplateColumns: "1.35fr 1.15fr 2.2fr", gap: 12, alignItems: "start" }}>
        {/* INPUT */}
        <div>
          <Header
            title="Действия"
            right={
              <button onClick={() => copyToClipboard(input)} style={{ padding: "6px 10px", cursor: "pointer" }}>
                Copy
              </button>
            }
          />

          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            style={{
              width: "100%",
              height: CONTENT_HEIGHT,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
              fontSize: 13,
              padding: 10,
              border: "1px solid #ccc",
              borderRadius: 8,
              resize: "vertical",
              boxSizing: "border-box",
            }}
          />
          <div style={{ marginTop: 8, color: "#555", fontSize: 12 }}>Правило: 2 пробела = 1 уровень.</div>
        </div>

        {/* JIRA */}
        <div>
          <Header
            title="Код для Jira"
            right={
              <button onClick={() => copyToClipboard(jiraOut)} style={{ padding: "6px 10px", cursor: "pointer" }}>
                Copy
              </button>
            }
          />

          <pre
            style={{
              width: "100%",
              height: CONTENT_HEIGHT,
              overflow: "auto",
              background: "#fafafa",
              border: "1px solid #ccc",
              borderRadius: 8,
              padding: 10,
              fontFamily:
                "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
              fontSize: 13,
              whiteSpace: "pre",
              margin: 0,
              color: "#111",
              boxSizing: "border-box",
            }}
          >
            {jiraOut}
          </pre>
          <div style={{ marginTop: 8, color: "#555", fontSize: 12 }}>
            Вставляйте в Jira в code block (или используйте {"{code:...}"}).
          </div>
        </div>

        {/* GRAPHIC */}
        <div>
          <Header
            title="Графика"
            right={
              <button onClick={saveGraphPng} style={{ padding: "6px 10px", cursor: "pointer" }}>
                Save PNG
              </button>
            }
          />

          {/* ВАЖНО: здесь тоже CONTENT_HEIGHT и boxSizing, чтобы высоты совпали пиксель-в-пиксель */}
          <div
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
            }}
          >
            <svg
              ref={svgRef}
              // ВАЖНО: делаем внутреннее SVG соответствующим “виртуальному полотну” для экспорта
              // но отображение во viewport — через 100% + viewBox.
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
                <marker
                  id="arrow"
                  viewBox="0 0 10 10"
                  refX="9"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="black" />
                </marker>
              </defs>

              {/* белый фон */}
              <rect x={0} y={0} width={layout.width} height={layout.height} fill="white" />

              {/* Рисуем внутри группы с pan/zoom */}
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
                      <path
                        key={`${n.id}-${cid}`}
                        d={d}
                        fill="none"
                        stroke="black"
                        strokeWidth={1}
                        markerEnd="url(#arrow)"
                        opacity={0.9}
                      />
                    );
                  });
                })}

                {/* nodes */}
                {layout.positioned.map((n) => {
                  const textX = n.x + 12;
                  const textY = n.y + 10 + 14;

                  return (
                    <g key={n.id} filter="url(#shadow)" pointerEvents="none">
                      <rect
                        x={n.x}
                        y={n.y}
                        width={n.w}
                        height={n.h}
                        rx={10}
                        ry={10}
                        fill="white"
                        stroke="black"
                        strokeWidth={1}
                      />
                      <text
                        x={textX}
                        y={textY}
                        fontFamily="ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace"
                        fontSize={12}
                      >
                        {n.lines.map((line, idx) => (
                          <tspan key={idx} x={textX} dy={idx === 0 ? 0 : 16}>
                            {line}
                          </tspan>
                        ))}
                      </text>
                    </g>
                  );
                })}
              </g>
            </svg>
          </div>

          <div style={{ marginTop: 8, color: "#555", fontSize: 12 }}>
            Save PNG сохраняет текущее состояние (с pan/zoom). Панорамирование: ЛКМ + drag.
          </div>
        </div>
      </div>
    </div>
  );
}
