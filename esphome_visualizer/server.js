'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const chokidar = require('chokidar');

const PORT = process.env.PORT || 3000;
const YAML_ROOT = path.resolve(__dirname, '../esphome-builder');
const MAIN_FILE = path.join(YAML_ROOT, 'crowpanel-advance-7-hmi-esp32-s3.yaml');
const INDEX_HTML = path.join(__dirname, 'index.html');

// ── YAML parsing ──────────────────────────────────────────────────────────────

let watchedFiles = new Set([MAIN_FILE]);

function makeSchema(baseDir) {
  return yaml.DEFAULT_SCHEMA.extend([
    new yaml.Type('!include', {
      kind: 'scalar',
      construct(data) {
        const fullPath = path.resolve(baseDir, data);
        watchedFiles.add(fullPath);
        return parseYamlFile(fullPath);
      },
    }),
    new yaml.Type('!secret', {
      kind: 'scalar',
      construct: () => '__secret',
    }),
    new yaml.Type('!lambda', {
      kind: 'scalar',
      construct: () => '__lambda',
    }),
  ]);
}

function parseYamlFile(filePath) {
  try {
    const content = fs.readFileSync(filePath, 'utf8');
    return yaml.load(content, { schema: makeSchema(path.dirname(filePath)) });
  } catch (e) {
    console.error(`  Parse error in ${path.relative(YAML_ROOT, filePath)}: ${e.message}`);
    return null;
  }
}

// ── Widget normalization ───────────────────────────────────────────────────────

function parsePoints(rawPoints) {
  if (!Array.isArray(rawPoints)) return [];
  return rawPoints.map(p => {
    if (Array.isArray(p)) return [Number(p[0]), Number(p[1])];
    if (typeof p === 'string') {
      const parts = p.split(',').map(s => parseInt(s.trim(), 10));
      return [parts[0] || 0, parts[1] || 0];
    }
    return [0, 0];
  });
}

function normalizeWidget(raw) {
  if (!raw || typeof raw !== 'object') return null;

  for (const type of ['obj', 'label', 'line', 'arc']) {
    if (!(type in raw)) continue;
    const props = raw[type];
    if (!props || typeof props !== 'object') continue;

    const w = { type };

    for (const [k, v] of Object.entries(props)) {
      if (k === 'widgets' || k === 'indicator') continue;
      w[k] = v;
    }

    if (type === 'obj' && Array.isArray(props.widgets)) {
      w.children = props.widgets.map(normalizeWidget).filter(Boolean);
    }

    if (type === 'arc' && props.indicator && typeof props.indicator === 'object') {
      if (props.indicator.arc_color !== undefined) w.indicator_color = props.indicator.arc_color;
      if (props.indicator.arc_width !== undefined) w.indicator_width = props.indicator.arc_width;
    }

    if (type === 'line' && props.points) {
      w.points = parsePoints(props.points);
    }

    return w;
  }
  return null;
}

// ── Layout extraction ─────────────────────────────────────────────────────────

function extractLayout(main) {
  if (!main) return null;

  const fonts = {};
  const widgets = [];

  function collectFonts(fontArray) {
    if (!Array.isArray(fontArray)) return;
    for (const f of fontArray) {
      if (f && f.id && f.size) fonts[f.id] = f.size;
    }
  }

  function collectWidgets(lvglObj) {
    if (!lvglObj) return;
    // lvgl: widgets: [...]
    if (Array.isArray(lvglObj.widgets)) {
      for (const w of lvglObj.widgets) {
        const n = normalizeWidget(w);
        if (n) widgets.push(n);
      }
    }
    // lvgl: pages: [{ widgets: [...] }]
    if (Array.isArray(lvglObj.pages)) {
      for (const page of lvglObj.pages) {
        if (Array.isArray(page.widgets)) {
          for (const w of page.widgets) {
            const n = normalizeWidget(w);
            if (n) widgets.push(n);
          }
        }
      }
    }
  }

  // Root-level font and lvgl from main YAML
  collectFonts(main.font);
  const rootBgColor = main.lvgl?.bg_color ?? 0x0B1120;
  const defaultFont = main.lvgl?.text_font ?? 'montserrat_20';

  // Process packages in declaration order
  if (main.packages && typeof main.packages === 'object') {
    for (const pkg of Object.values(main.packages)) {
      if (!pkg) continue;
      collectFonts(pkg.font);
      collectWidgets(pkg.lvgl);
    }
  }

  // Main YAML's own lvgl widgets (usually none, but handle gracefully)
  collectWidgets(main.lvgl);

  // Display dimensions
  const display = { width: 800, height: 480 };
  if (Array.isArray(main.display) && main.display[0]?.dimensions) {
    const d = main.display[0].dimensions;
    if (d.width) display.width = d.width;
    if (d.height) display.height = d.height;
  }

  return { display, bg_color: rootBgColor, default_font: defaultFont, fonts, widgets };
}

// ── Layout cache ──────────────────────────────────────────────────────────────

let cachedLayout = null;
let cachedError = null;

function rebuildLayout() {
  watchedFiles = new Set([MAIN_FILE]);
  try {
    const main = parseYamlFile(MAIN_FILE);
    const layout = extractLayout(main);
    if (!layout) throw new Error('extractLayout returned null');
    cachedLayout = layout;
    cachedError = null;
    const wCount = countWidgets(layout.widgets);
    console.log(`Layout rebuilt: ${layout.widgets.length} top-level containers, ${wCount} total widgets, ${Object.keys(layout.fonts).length} fonts`);
  } catch (e) {
    cachedError = e.message;
    console.error('Layout rebuild failed:', e.message);
  }
}

function countWidgets(widgets) {
  let n = widgets.length;
  for (const w of widgets) {
    if (w.children) n += countWidgets(w.children);
  }
  return n;
}

// ── SSE ───────────────────────────────────────────────────────────────────────

const sseClients = new Set();

function broadcast(event, data) {
  const msg = `event: ${event}\ndata: ${data}\n\n`;
  for (const res of sseClients) {
    try { res.write(msg); } catch (_) { sseClients.delete(res); }
  }
}

// Heartbeat keeps connections alive through proxies
setInterval(() => {
  for (const res of sseClients) {
    try { res.write(':\n\n'); } catch (_) { sseClients.delete(res); }
  }
}, 20_000);

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const urlPath = new URL(req.url, `http://localhost:${PORT}`).pathname;

  if (urlPath === '/') {
    try {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(INDEX_HTML, 'utf8'));
    } catch (e) {
      res.writeHead(500); res.end('index.html not found');
    }
    return;
  }

  if (urlPath === '/api/layout') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    });
    if (cachedError) {
      res.end(JSON.stringify({ error: cachedError }));
    } else {
      res.end(JSON.stringify(cachedLayout));
    }
    return;
  }

  if (urlPath === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    });
    res.write(':\n\n'); // initial ping
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return;
  }

  res.writeHead(404); res.end('Not found');
});

// ── File watcher ──────────────────────────────────────────────────────────────

const watchPaths = [MAIN_FILE, path.join(YAML_ROOT, 'packages')];

const watcher = chokidar.watch(watchPaths, {
  ignoreInitial: true,
  awaitWriteFinish: { stabilityThreshold: 120, pollInterval: 50 },
});

watcher.on('change', filePath => {
  console.log(`Changed: ${path.relative(YAML_ROOT, filePath)}`);
  rebuildLayout();
  broadcast('reload', 'changed');
});

watcher.on('add', filePath => {
  console.log(`Added:   ${path.relative(YAML_ROOT, filePath)}`);
  rebuildLayout();
  broadcast('reload', 'changed');
});

// ── Boot ──────────────────────────────────────────────────────────────────────

rebuildLayout();
server.listen(PORT, () => {
  console.log(`\nESPHome LVGL Visualizer → http://localhost:${PORT}\n`);
});
