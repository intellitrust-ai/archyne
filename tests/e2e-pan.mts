/**
 * What a left drag does on the canvas, in every mode that decides it: the
 * select tool (marquee), a touchscreen (pans), an embed with `&pan=drag`
 * (empty canvas pans, boxes still move, Shift + drag draws the marquee) and
 * the hand tool (pans from anywhere, boxes inert) — alone and on top of
 * `&pan=drag`.
 *
 * Run:  npm run dev, then npx tsx tests/e2e-pan.mts
 */
import { chromium, type Frame, type Page } from "playwright";
import { BASE, CHANNEL, codeUrl } from "./env.mts";

const FLOW = `flowchart LR
  a[Alpha] --> b[Beta]
  b --> c[Gamma]
%% graph:positions {"a":{"x":0,"y":0},"b":{"x":300,"y":0},"c":{"x":600,"y":0}}
`;

let failed = false;
const check = (label: string, ok: boolean, detail = "") => {
  if (!ok) failed = true;
  console.log(`  ${ok ? "✓" : "✗"} ${label}${ok ? "" : ` — ${detail}`}`);
};

type Target = Page | Frame;
type TestWindow = {
  __graphTest: {
    ready(): boolean;
    store: {
      getState(): {
        nodes: Array<{ id: string; selected?: boolean; position: { x: number; y: number } }>;
      };
    };
  };
};

const viewport = (t: Target) =>
  t.evaluate(
    () => (document.querySelector(".react-flow__viewport") as HTMLElement).style.transform,
  );
const nodePos = (t: Target, id: string) =>
  t.evaluate((id) => {
    const n = (window as unknown as TestWindow).__graphTest.store
      .getState()
      .nodes.find((x) => x.id === id)!;
    return `${n.position.x},${n.position.y}`;
  }, id);
const selectedCount = (t: Target) =>
  t.evaluate(() => document.querySelectorAll(".react-flow__node.selected").length);
/** Back to the fitted view, so every gesture starts with all nodes on screen. */
const refit = async (t: Target) => {
  await t.locator(".react-flow__controls-fitview").click();
  await t.waitForTimeout(600);
};
const clearSelection = async (page: Page, t: Target) => {
  const pane = (await t.locator(".react-flow__pane").boundingBox())!;
  // Top right: bottom left holds the zoom controls and the select/hand button.
  await page.mouse.click(pane.x + pane.width - 40, pane.y + 40);
  await page.waitForTimeout(150);
};

/** Drag in page coordinates, optionally holding Shift. */
async function drag(page: Page, x: number, y: number, dx: number, dy: number, shift = false) {
  if (shift) await page.keyboard.down("Shift");
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, y + dy, { steps: 10 });
  await page.mouse.up();
  if (shift) await page.keyboard.up("Shift");
  await page.waitForTimeout(300);
}

/** A point of bare canvas just above-left of every node, and the span to cover them. */
async function marquee(t: Target) {
  const boxes = await t.locator(".react-flow__node").evaluateAll((els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { l: r.left, t: r.top, r: r.right, b: r.bottom };
    }),
  );
  const l = Math.min(...boxes.map((b) => b.l));
  const top = Math.min(...boxes.map((b) => b.t));
  const r = Math.max(...boxes.map((b) => b.r));
  const bot = Math.max(...boxes.map((b) => b.b));
  // Stay on the canvas: the nodes are fitted close to its edges.
  const pane = await t
    .locator(".react-flow__pane")
    .evaluate((e) => e.getBoundingClientRect().toJSON() as DOMRect);
  // Clear of the 40px band where React Flow auto-pans as the marquee nears an edge.
  const x0 = Math.max(pane.left + 60, l - 30);
  const y0 = Math.max(pane.top + 60, top - 30);
  const x1 = Math.min(pane.right - 60, r + 30);
  const y1 = Math.min(pane.bottom - 60, bot + 30);
  return { x: x0, y: y0, dx: x1 - x0, dy: y1 - y0 };
}

/** Frame offset in the page, so frame-relative rects can be driven with page.mouse. */
async function offset(page: Page, t: Target) {
  if (t === page) return { x: 0, y: 0 };
  const r = (await page.locator("iframe").boundingBox())!;
  return { x: r.x, y: r.y };
}

async function emptyDrag(page: Page, t: Target) {
  await refit(t);
  const o = await offset(page, t);
  const m = await marquee(t);
  const vp0 = await viewport(t);
  await clearSelection(page, t);
  await drag(page, o.x + m.x, o.y + m.y, m.dx, m.dy);
  return { panned: (await viewport(t)) !== vp0, selected: await selectedCount(t) };
}

async function nodeDrag(page: Page, t: Target, id = "b") {
  await refit(t);
  const box = (await t.locator(`.react-flow__node[data-id="${id}"]`).boundingBox())!;
  const [vp0, n0] = [await viewport(t), await nodePos(t, id)];
  // boundingBox is page-relative already, iframe or not.
  await drag(page, box.x + box.width / 2, box.y + box.height / 2, 120, 80);
  return { panned: (await viewport(t)) !== vp0, moved: (await nodePos(t, id)) !== n0 };
}

async function shiftDrag(page: Page, t: Target) {
  await refit(t);
  const o = await offset(page, t);
  const m = await marquee(t);
  await clearSelection(page, t);
  const vp0 = await viewport(t);
  await drag(page, o.x + m.x, o.y + m.y, m.dx, m.dy, true);
  return { panned: (await viewport(t)) !== vp0, selected: await selectedCount(t) };
}

const ready = (t: Target) =>
  t.waitForFunction(
    () => (window as unknown as Partial<TestWindow>).__graphTest?.ready(),
    undefined,
    {
      timeout: 30000,
    },
  );

const browser = await chromium.launch({ channel: CHANNEL, headless: true });

/** Standalone app (or a touchscreen when `touch`). */
async function standalone(touch: boolean) {
  const context = await browser.newContext({
    viewport: { width: 1400, height: 900 },
    ...(touch ? { hasTouch: true, isMobile: true } : {}),
  });
  const page = await context.newPage();
  await page.goto(codeUrl(FLOW));
  await ready(page);
  await page.waitForTimeout(1200);
  return { context, page };
}

/** Archyne in an iframe of a host page, loaded with `load` on `ready`. */
async function embedded(params: string) {
  const context = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await context.newPage();
  const hostUrl = `${BASE}/__pan-host.html`;
  await page.route(hostUrl, (route) =>
    route.fulfill({
      contentType: "text/html",
      body: `<!doctype html><html><body style="margin:0">
<iframe src="/?embed=1&origin=${encodeURIComponent(BASE)}${params}" style="border:0;width:1400px;height:900px"></iframe>
<script>
  const code = ${JSON.stringify(FLOW)};
  addEventListener("message", (e) => {
    if (e.data && e.data.type === "ready")
      document.querySelector("iframe").contentWindow.postMessage({ type: "load", code }, location.origin);
  });
</script></body></html>`,
    }),
  );
  await page.goto(hostUrl);
  const frame = page.frames().find((f) => f !== page.mainFrame())!;
  await frame.waitForLoadState();
  await ready(frame);
  await frame.waitForFunction(
    () => document.querySelectorAll(".react-flow__node").length === 3,
    undefined,
    {
      timeout: 15000,
    },
  );
  await page.waitForTimeout(1200);
  return { context, page, frame };
}

// 1. Mouse, select tool.
{
  console.log("Mouse, select tool (default)");
  const { context, page } = await standalone(false);
  const e = await emptyDrag(page, page);
  check("empty drag draws the marquee", e.selected === 3 && !e.panned, JSON.stringify(e));
  const n = await nodeDrag(page, page);
  check("dragging a box moves it", n.moved && !n.panned, JSON.stringify(n));
  await context.close();
}

// 2. Touchscreen.
{
  console.log("Touchscreen (pointer: coarse)");
  const { context, page } = await standalone(true);
  const coarse = await page.evaluate(() => matchMedia("(pointer: coarse)").matches);
  check("emulated pointer is coarse", coarse);
  const e = await emptyDrag(page, page);
  check("empty drag pans", e.panned && e.selected === 0, JSON.stringify(e));
  await context.close();
}

// 3. Embedded without &pan=drag: unchanged default.
{
  console.log("Embedded, no &pan=drag");
  const { context, page, frame } = await embedded("");
  const e = await emptyDrag(page, frame);
  check("empty drag draws the marquee", e.selected === 3 && !e.panned, JSON.stringify(e));
  await context.close();
}

// 4. Embedded with &pan=drag, then 5. the hand on top of it.
{
  console.log("Embedded, &pan=drag");
  const { context, page, frame } = await embedded("&pan=drag");
  const e = await emptyDrag(page, frame);
  check("empty drag pans", e.panned && e.selected === 0, JSON.stringify(e));
  const n = await nodeDrag(page, frame);
  check("dragging a box moves it", n.moved && !n.panned, JSON.stringify(n));
  const s = await shiftDrag(page, frame);
  check("Shift + drag draws the marquee", s.selected === 3 && !s.panned, JSON.stringify(s));

  console.log("Embedded, &pan=drag + hand (H)");
  await clearSelection(page, frame);
  await frame.locator(".react-flow__pane").hover();
  await page.keyboard.press("h");
  const cursor = await frame.evaluate(
    () => getComputedStyle(document.querySelector(".react-flow__pane")!).cursor,
  );
  check("hand cursor", cursor === "grab", cursor);
  const h = await nodeDrag(page, frame);
  check("dragging from a box pans, box stays", h.panned && !h.moved, JSON.stringify(h));
  await page.keyboard.press("v");
  const back = await nodeDrag(page, frame);
  check("V: boxes move again", back.moved && !back.panned, JSON.stringify(back));
  await context.close();
}

// 6. Hand alone, standalone.
{
  console.log("Mouse, hand tool (H)");
  const { context, page } = await standalone(false);
  await page.locator(".react-flow__pane").hover();
  await page.keyboard.press("h");
  const e = await emptyDrag(page, page);
  check("empty drag pans", e.panned && e.selected === 0, JSON.stringify(e));
  const n = await nodeDrag(page, page);
  check("dragging from a box pans, box stays", n.panned && !n.moved, JSON.stringify(n));
  await context.close();
}

await browser.close();
console.log(failed ? "\nSOME CASES FAIL" : "\nall cases behave as described");
process.exit(failed ? 1 : 0);
