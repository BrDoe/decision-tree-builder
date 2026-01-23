# Decision Tree Builder

[English](#english) | [Русский](#русский)

---

## English

A small React app that converts an indented “actions” list into a decision-tree representation suitable for **Jira** and for quick visual review.

### Key features

- **Indented text → tree** parsing (2 spaces = one nesting level)
- **ASCII tree** output with connectors (`├─`, `└─`) for copy/paste to Jira
- Optional **Jira `{code:LANG}` wrapper** around the ASCII output
- **SVG diagram preview** with zoom/pan + reset
- **PNG export** of the current diagram (tight crop)
- **Import**: paste an ASCII tree from Jira (including `{code}` blocks) and restore the indented text
- **Local history** of recent trees (stored in the browser)

### Tech stack

- React + TypeScript
- **Vite** for dev server and build
- No backend; everything runs locally in the browser

### Persistence

- UI state and history are stored in the browser via `localStorage`

### Requirements

- Node.js 18+ (recommended LTS)
- npm (or yarn/pnpm)

### Run locally (Vite)

```bash
npm install
npm run dev
```

Vite will print the local URL (commonly `http://localhost:5173`).

### Build & preview (Vite)

```bash
npm run build
npm run preview
```

Preview is typically available on `http://localhost:4173`.

### Deploy

Any static hosting works:

1. Build: `npm run build`
2. Publish the `dist/` folder

---

## Русский

Небольшое React-приложение, которое превращает список действий с отступами в “дерево решений” — удобно для вставки в **Jira** и быстрого визуального просмотра.

### Возможности

- **Текст с отступами → дерево** (2 пробела = один уровень вложенности)
- **ASCII-дерево** с символами (`├─`, `└─`) для копирования в Jira
- Опциональная обёртка **Jira `{code:LANG}`** вокруг ASCII
- **SVG-превью** диаграммы с масштабированием/панорамированием + reset
- **Экспорт в PNG** текущей диаграммы (аккуратная обрезка по контенту)
- **Импорт**: вставка ASCII-дерева из Jira (включая `{code}`) и восстановление текста
- **Локальная история** последних схем (хранится в браузере)

### Технологии

- React + TypeScript
- **Vite** (dev-сервер и сборка)
- Бэкенда нет — приложение полностью работает в браузере

### Хранение данных

- Состояние UI и история сохраняются в браузере через `localStorage`

### Требования

- Node.js 18+ (желательно LTS)
- npm (или yarn/pnpm)

### Запуск локально (Vite)

```bash
npm install
npm run dev
```

Vite выведет URL в терминале (часто `http://localhost:5173`).

### Сборка и локальный просмотр (Vite)

```bash
npm run build
npm run preview
```

Preview обычно доступен по `http://localhost:4173`.

### Деплой

Подходит любой static hosting:

1. Соберите: `npm run build`
2. Публикуйте папку `dist/`

