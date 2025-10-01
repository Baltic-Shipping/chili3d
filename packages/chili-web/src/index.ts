// See CHANGELOG.md for modifications (updated 2025-10-01)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppBuilder } from "chili-builder";
import { History, Logger, Material, PubSub, Transaction, VisualNode } from "chili-core";
import { Loading } from "./loading";
import { ChiliOdoo } from "./odooApi";

const MATERIALS_CACHE_KEY = "chili:lastMaterials";
const SLICE_MS = 8;

type VerifyNode = {
    world: number[];
    faces: { position: number[]; index?: number[] };
    materialId: string | string[];
    faceMaterialCounts?: number[];
};

type VerifySnapshot = {
    version: 1;
    units: "mm";
    materials: Record<string, string>;
    nodes: VerifyNode[];
};

function getAllVisualNodes(doc: any): VisualNode[] {
    const nodes: VisualNode[] = [];

    function collectNodes(node: any) {
        if (!node) return;
        if (node instanceof VisualNode) {
            nodes.push(node);
        }
        for (let child = node.firstChild; child; child = child.nextSibling) {
            collectNodes(child);
        }
    }

    collectNodes(doc.rootNode);
    return nodes;
}

function blobToBase64(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = String(reader.result || "");
            const base64Index = result.indexOf("base64,");
            const base64Data = base64Index >= 0 ? result.substring(base64Index + 7) : result;
            resolve(base64Data);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

async function exportStepFile(doc: any): Promise<{ name: string; b64: string } | null> {
    const nodes = getAllVisualNodes(doc);
    if (nodes.length === 0) return null;

    const parts = await doc.application.dataExchange.export(".step", nodes);
    if (!parts || parts.length === 0) return null;

    const blob = new Blob(parts, { type: "application/step" });
    const base64Data = await blobToBase64(blob);
    const filename = `${doc.name || "design"}.step`;

    return { name: filename, b64: base64Data };
}

async function exportCdFile(doc: any): Promise<{ name: string; b64: string }> {
    const jsonData = JSON.stringify(doc.serialize());
    const blob = new Blob([jsonData], { type: "application/json" });
    const filename = `${doc.name || "design"}.cd`;

    return {
        name: filename,
        b64: await blobToBase64(blob),
    };
}

function faceCountsForNode(node: any, matIds: string[] | undefined): number[] | undefined {
    const pairs = Array.isArray(node.faceMaterialPair) ? node.faceMaterialPair : [];
    if (!matIds || matIds.length <= 1) return undefined;
    if (!pairs.length) return new Array(matIds.length).fill(0);
    const counts = new Array(matIds.length).fill(0);
    for (const p of pairs) {
        const mi = (p as any).materialIndex ?? (Array.isArray(p) ? p[1] : undefined);
        if (typeof mi === "number" && mi >= 0 && mi < counts.length) counts[mi]++;
    }
    return counts;
}

export function buildVerifySnapshot(doc: any, odooKeyByMatId: Map<string, string>): VerifySnapshot {
    const nodes: VerifyNode[] = [];
    const matMap: Record<string, string> = {};
    for (const [docMatId, key] of odooKeyByMatId.entries()) matMap[docMatId] = key;

    function pushNode(gn: any) {
        const mesh = gn?.mesh;
        const faces = mesh?.faces;
        if (!faces || !faces.position || faces.position.length === 0) return;

        const world = gn.worldTransform?.().toArray?.();
        if (!world || world.length !== 16) return;

        const materialId = gn.materialId;
        let matIds: string[] | undefined;
        if (Array.isArray(materialId)) matIds = materialId.filter(Boolean);
        else if (typeof materialId === "string" && materialId) matIds = [materialId];

        const counts = faceCountsForNode(gn, matIds);

        nodes.push({
            world,
            faces: {
                position: Array.from(faces.position as Float32Array),
                index: faces.index ? Array.from(faces.index as Uint32Array) : undefined,
            },
            materialId: Array.isArray(materialId) ? materialId : (materialId ?? ""),
            faceMaterialCounts: counts,
        });
    }

    function walk(n: any) {
        const isGeom = n && typeof n === "object" && ("mesh" in n || "materialId" in n);
        if (isGeom) pushNode(n);
        let c = n?.firstChild;
        while (c) {
            walk(c);
            c = c.nextSibling;
        }
    }

    if (doc?.rootNode) walk(doc.rootNode);

    return { version: 1, units: "mm", materials: matMap, nodes };
}

function nowMs() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}
function sleep0() {
    return new Promise<void>((r) => setTimeout(r, 0));
}

function formatMoney(amount: number, currency: string, locale?: string) {
    const loc = locale || (typeof navigator !== "undefined" ? navigator.language : "en-US");
    try {
        return new Intl.NumberFormat(loc, { style: "currency", currency }).format(amount);
    } catch {
        return `${amount.toFixed(2)} ${currency}`;
    }
}

type OdooMat = { key: string; name: string; density?: number; basis?: string; uom?: string };
const METERS_PER_SCENE_UNIT = 0.001;
const UNIT3_TO_M3 = METERS_PER_SCENE_UNIT ** 3;
let lastVolSource: "solid" | "mesh" | "bbox" = "solid";

function nodeMeshVolumeM3(n: any): number {
    const faces = n?.mesh?.faces;
    if (!faces || !faces.position?.length) return 0;

    const pos = faces.position as Float32Array;
    const idx = faces.index && faces.index.length ? (faces.index as Uint32Array) : null;

    let vol = 0;
    const tri = (i1: number, i2: number, i3: number) => {
        const x1 = pos[i1 * 3],
            y1 = pos[i1 * 3 + 1],
            z1 = pos[i1 * 3 + 2];
        const x2 = pos[i2 * 3],
            y2 = pos[i2 * 3 + 1],
            z2 = pos[i2 * 3 + 2];
        const x3 = pos[i3 * 3],
            y3 = pos[i3 * 3 + 1],
            z3 = pos[i3 * 3 + 2];
        vol += (x1 * y2 * z3 + x2 * y3 * z1 + x3 * y1 * z2 - x1 * y3 * z2 - x2 * y1 * z3 - x3 * y2 * z1) / 6;
    };

    if (idx) {
        for (let k = 0; k < idx.length; k += 3) tri(idx[k], idx[k + 1], idx[k + 2]);
    } else {
        for (let i = 0; i < pos.length / 3; i += 3) tri(i, i + 1, i + 2);
    }

    const detWorld = Math.abs(n?.worldTransform?.().determinant?.() ?? 1);
    return Math.abs(vol) * detWorld * UNIT3_TO_M3;
}

function apportionByFaceCount(node: any): Map<string, number> {
    const out = new Map<string, number>();
    const mat = node?.materialId;
    const pairs: Array<{ faceIndex: number; materialIndex: number }> = node?.faceMaterialPair ?? [];
    if (!Array.isArray(mat)) {
        if (typeof mat === "string" && mat) out.set(mat, 1);
        return out;
    }
    if (!pairs.length) {
        const w = 1 / mat.length;
        for (let i = 0; i < mat.length; i++) out.set(mat[i], w);
        return out;
    }
    const counts = new Map<number, number>();
    for (const p of pairs) counts.set(p.materialIndex, (counts.get(p.materialIndex) || 0) + 1);
    const total = Array.from(counts.values()).reduce((a, b) => a + b, 0) || 1;
    for (const [mi, c] of counts) {
        const id = mat[mi];
        if (id) out.set(id, c / total);
    }
    return out;
}

async function computeKgByMaterialAsync(
    doc: any,
    odooKeyByMatId: Map<string, string>,
    odooList: OdooMat[],
    latestRef: () => number,
    myGen: number,
): Promise<Map<string, number> | null> {
    const densityByKey = new Map(odooList.map((o) => [o.key, Number(o.density || 0)]));
    const kgByKey = new Map<string, number>();

    const add = (key: string, kg: number) => {
        if (!isFinite(kg) || kg <= 0) return;
        kgByKey.set(key, (kgByKey.get(key) || 0) + kg);
    };

    const stack: any[] = [];
    if (doc?.rootNode) stack.push(doc.rootNode);

    let sliceStart = nowMs();
    while (stack.length) {
        if (myGen !== latestRef()) return null;

        const n = stack.pop();
        const vol_m3 = nodeMeshVolumeM3(n);
        if (vol_m3 > 0) {
            const mats = Array.isArray(n.materialId) ? apportionByFaceCount(n) : new Map<string, number>();
            if (mats.size === 0) {
                const id = typeof n.materialId === "string" ? n.materialId : null;
                const key = id ? odooKeyByMatId.get(id) : undefined;
                const rho = key ? densityByKey.get(key) || 0 : 0;
                if (key && rho > 0) add(key, vol_m3 * rho);
            } else {
                for (const [matId, w] of mats) {
                    const key = odooKeyByMatId.get(matId);
                    if (!key) continue;
                    const rho = densityByKey.get(key) || 0;
                    if (rho > 0) add(key, vol_m3 * rho * w);
                }
            }
        }

        let c = n.firstChild;
        while (c) {
            stack.push(c);
            c = c.nextSibling;
        }

        if (nowMs() - sliceStart > SLICE_MS) {
            await sleep0();
            sliceStart = nowMs();
        }
    }

    return kgByKey;
}

let loading = new Loading();
document.body.appendChild(loading);

function createQuoteCard() {
  const card = document.createElement('div');
  card.id = 'quote-card';
  card.style.cssText = `
    position: fixed;
    right: 12px;
    bottom: 12px;
    width: 260px;
    border-radius: 12px;
    background: #E00C30;
    color: #fff;
    box-shadow: 0 8px 24px rgba(0,0,0,.25);
    font: 14px/1.2 system-ui, -apple-system, sans-serif;
    overflow: hidden;
  `;

  const header = document.createElement('div');
  header.style.cssText = `
    padding: 10px 12px;
    border-bottom: 1px solid rgba(255,255,255,.25);
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;
  
  const title = document.createElement('span');
  title.textContent = 'Quote (live)';
  
  const buyButton = document.createElement('button');
  buyButton.id = 'qc-buy';
  buyButton.textContent = 'Add to cart';
  buyButton.style.cssText = `
    background: #fff;
    color: #E00C30;
    border: none;
    border-radius: 8px;
    padding: 6px 10px;
    font-weight: 600;
    cursor: pointer;
  `;
  
  header.appendChild(title);
  header.appendChild(buyButton);

  const body = document.createElement('div');
  body.style.cssText = `
    padding: 10px 12px;
    display: grid;
    grid-template-columns: 1fr auto;
    row-gap: 8px;
    column-gap: 8px;
    align-items: center;
  `;

  const qtyLabel = document.createElement('div');
  qtyLabel.textContent = 'Qty';

  const qtyControls = document.createElement('div');
  qtyControls.id = 'qc-qty';
  qtyControls.style.cssText = `
    display: flex;
    gap: 6px;
    align-items: center;
    justify-self: end;
  `;

  const minusButton = document.createElement('button');
  minusButton.id = 'qc-minus';
  minusButton.textContent = '–';
  minusButton.setAttribute('aria-label', 'minus');
  minusButton.style.cssText = `
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: rgba(0,0,0,.2);
    color: #fff;
    cursor: pointer;
  `;

  const qtyInput = document.createElement('input');
  qtyInput.id = 'qc-input';
  qtyInput.type = 'number';
  qtyInput.min = '1';
  qtyInput.max = '100';
  qtyInput.value = '1';
  qtyInput.style.cssText = `
    width: 52px;
    text-align: center;
    border: none;
    border-radius: 6px;
    padding: 4px 6px;
    background: #fff;
    color: #111;
    font-weight: 700;
  `;

  const plusButton = document.createElement('button');
  plusButton.id = 'qc-plus';
  plusButton.textContent = '+';
  plusButton.setAttribute('aria-label', 'plus');
  plusButton.style.cssText = `
    width: 28px;
    height: 28px;
    border-radius: 6px;
    border: none;
    background: rgba(0,0,0,.2);
    color: #fff;
    cursor: pointer;
  `;

  qtyControls.appendChild(minusButton);
  qtyControls.appendChild(qtyInput);
  qtyControls.appendChild(plusButton);

  const divider = document.createElement('div');
  divider.style.cssText = `
    grid-column: 1 / span 2;
    border-top: 1px solid rgba(255,255,255,.25);
    margin-top: 6px;
  `;

  const totalLabel = document.createElement('div');
  totalLabel.textContent = 'Total';
  totalLabel.style.fontWeight = '600';

  const totalValue = document.createElement('div');
  totalValue.id = 'qc-total';
  totalValue.textContent = '--';
  totalValue.style.cssText = `
    justify-self: end;
    font-weight: 800;
    font-size: 16px;
  `;

  const hint = document.createElement('div');
  hint.id = 'qc-hint';
  hint.style.cssText = `
    grid-column: 1 / span 2;
    opacity: .85;
    font-size: 12px;
  `;

  body.appendChild(qtyLabel);
  body.appendChild(qtyControls);
  body.appendChild(divider);
  body.appendChild(totalLabel);
  body.appendChild(totalValue);
  body.appendChild(hint);

  card.appendChild(header);
  card.appendChild(body);
  document.body.appendChild(card);

  return {
    card,
    buyButton,
    totalValue,
    hint,
    qtyInput,
    minusButton,
    plusButton,
  };
}

function debounce<T extends (...a: any[]) => any>(fn: T, ms: number) {
    let t: number | undefined;
    return (...a: Parameters<T>) => {
        if (t) clearTimeout(t as any);
        t = setTimeout(() => fn(...a), ms) as any;
    };
}

// prettier-ignore
new AppBuilder()
    .useIndexedDB()
    .useWasmOcc()
    .useThree()
    .useUI()
    .build()
    .then(x => {
        document.body.removeChild(loading)
        const ui = createQuoteCard();
        ui.buyButton.disabled = true;
        let quantity = 1;
        function clampQuantity(value: number): number {
          return Math.max(1, Math.min(100, Math.round(value)));
        }
        function setQuantity(value: number) {
          quantity = clampQuantity(value);
          ui.qtyInput.value = String(quantity);
          requestQuoteDebounced();
        }
        ui.minusButton.onclick = () => setQuantity(quantity - 1);
        ui.plusButton.onclick = () => setQuantity(quantity + 1);
        ui.qtyInput.onchange = () => setQuantity(Number(ui.qtyInput.value));
        let lastQuoteId: string | undefined;
        let computeGen = 0;
        const latestGen = () => computeGen;
        let curatedIds = new Set<string>();
        let firstCuratedId: string | null = null;
        let inDocument = false;
        let currentDoc: any = null;
        const odooKeyByMatId = new Map<string, string>();
        let odooList: OdooMat[] = [];
        const canQuote = () => inDocument && !!currentDoc && odooList.length > 0;

        const colorFromKey = (key: string) => {
            let h = 0; 
            for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0;
            const r = 0x80 + (h & 0x7F), g = 0x80 + ((h >> 7) & 0x7F), b = 0x80 + ((h >> 14) & 0x7F);
            return (r << 16) | (g << 8) | b;
        };

        function rebindMapFromDoc(doc: any) {
            odooKeyByMatId.clear();
            const mats = doc?.materials;
            if (!mats) return;
            const len = Math.min(odooList.length, mats.length ?? mats.count ?? 0);
            for (let i = 0; i < len; i++) {
                const m = mats.at(i);
                if (m?.id) odooKeyByMatId.set(m.id, odooList[i].key);
            }
        }

        async function syncMaterialsToDocument(doc: any) {
          let list: OdooMat[] | null = null;
          try {
            const res = await ChiliOdoo.materials();
            const live: OdooMat[] = res?.materials || [];
            if (live.length) {
              list = live;
              try { localStorage.setItem(MATERIALS_CACHE_KEY, JSON.stringify(live)); } catch {}
            }
          } catch {
          }

          if (!list || !list.length) {
            try {
              const raw = localStorage.getItem(MATERIALS_CACHE_KEY);
              const cached = raw ? (JSON.parse(raw) as OdooMat[]) : null;
              if (cached && cached.length) list = cached;
            } catch {
            }
          }

          if (!list || !list.length) {
            ui.totalValue.textContent = 'No materials';
            return;
          }

          const docMats = doc.materials;
          const oldLen  = docMats.length ?? docMats.count ?? 0;
          const oldMats: any[] = [];
          for (let i = 0; i < oldLen; i++) oldMats.push(docMats.at(i));

          const wasDisabled = !!doc.history?.disabled;
          if (doc.history) doc.history.disabled = true;
          try {
            const newMats: any[] = [];
            for (let i = 0; i < list.length; i++) {
              const o = list[i];
              const m = new Material(doc, o.name, colorFromKey(o.key));
              newMats.push(m);
            }
            docMats.push(...newMats);

            const newLen = newMats.length;
            const oldIdToNewId = new Map<string, string>();
            for (let i = 0; i < oldMats.length; i++) {
              const oldId = oldMats[i]?.id;
              if (!oldId) continue;
              const target = newMats[Math.min(i, newLen - 1)];
              oldIdToNewId.set(oldId, target.id);
            }

            const remapId = (id: string) => oldIdToNewId.get(id) || id;
            (function walk(n: any) {
              if (!n) return;
              const mId = n.materialId;
              if (Array.isArray(mId)) {
                n.materialId = mId.map((id: string) => remapId(id));
              } else if (typeof mId === "string" && mId) {
                const nid = remapId(mId);
                if (nid !== mId) n.materialId = nid;
              }
              let c = n.firstChild;
              while (c) { walk(c); c = c.nextSibling; }
            })(doc.rootNode);

            if (oldMats.length) docMats.remove(...oldMats);

            odooKeyByMatId.clear();
            for (let i = 0; i < newMats.length; i++) {
              odooKeyByMatId.set(newMats[i].id, list[i].key);
            }
            odooList = list;
            curatedIds = new Set(newMats.map(m => m.id));
            firstCuratedId = newMats.length ? newMats[0].id : null;
          } finally {
            if (doc.history) doc.history.disabled = wasDisabled;
          }
        }

        function normalizeUnknownMaterials(doc: any) {
          if (!firstCuratedId || curatedIds.size === 0) return;

          const wasDisabled = !!doc.history?.disabled;
          if (doc.history) doc.history.disabled = true;
          try {
            const remapId = (id: string) => curatedIds.has(id) ? id : firstCuratedId!;
            (function walk(n: any) {
              if (!n) return;
              const mId = n.materialId;
              if (Array.isArray(mId)) {
                const next = mId.map((id: string) => remapId(id));
                for (let i = 0; i < mId.length; i++) {
                  if (next[i] !== mId[i]) { n.materialId = next; break; }
                }
              } else if (typeof mId === "string" && mId) {
                const nid = remapId(mId);
                if (nid !== mId) n.materialId = nid;
              }
              for (let c = n.firstChild; c; c = c.nextSibling) walk(c);
            })(doc.rootNode);
            const mats = doc.materials;
            const extras: any[] = [];
            const len = mats.length ?? mats.count ?? 0;
            for (let i = 0; i < len; i++) {
              const m = mats.at(i);
              if (m?.id && !curatedIds.has(m.id)) extras.push(m);
            }
            if (extras.length) mats.remove(...extras);
          } finally {
            if (doc.history) doc.history.disabled = wasDisabled;
          }
        }

        async function requestQuote() {
            if (!canQuote()) { return; }
            const myGen = ++computeGen;
            try {
                rebindMapFromDoc(currentDoc);
                normalizeUnknownMaterials(currentDoc);
                const kgByKey = await computeKgByMaterialAsync(currentDoc, odooKeyByMatId, odooList, latestGen, myGen);
                if (kgByKey === null) return;
                const materials = Array.from(kgByKey, ([key, q]) => ({ key, quantity: q }));
                if (materials.length === 0) { return; }
                if (myGen !== latestGen()) return;
                const res = await ChiliOdoo.quote({ materials, quantity: quantity });
                lastQuoteId = (res as any)?.quote_id;
                if (myGen !== latestGen()) return;
                const fmt = (n: number) => formatMoney(n, res.currency);
                ui.totalValue.textContent = `${fmt(res.total)}${res.min_applied ? " (min)" : ""}`;
                if (Array.isArray(res.items)) {
                  ui.hint.textContent = res.items
                    .map((item: any) => `${item.quantity.toFixed(2)}kg × ${fmt(item.unit_price)} @ ${item.key}`)
                    .join("  ·  ");
                } else {
                  ui.hint.textContent = "";
                }

                ui.buyButton.disabled = false;
            } catch (e:any) {
                if (myGen !== latestGen()) return;
            }
        }

        async function beginCheckout() {
          if (!canQuote()) return;
          ui.buyButton.disabled = true;
          ui.buyButton.textContent = '...';

          try {
            rebindMapFromDoc(currentDoc);
            normalizeUnknownMaterials(currentDoc);
            const snapshot = buildVerifySnapshot(currentDoc, odooKeyByMatId);
            const kgByKey = await computeKgByMaterialAsync(currentDoc, odooKeyByMatId, odooList, () => computeGen, ++computeGen);
            if (!kgByKey || kgByKey.size === 0) { return; }

            const materials = kgByKey ? Array.from(kgByKey, ([key, q]) => ({ key, quantity: q })) : [];
            const [cdFile, stepFile] = await Promise.all([
              exportCdFile(currentDoc),
              exportStepFile(currentDoc).catch(() => null),
            ]);
            const res = await ChiliOdoo.checkout({ snapshot, quantity: quantity, files: { cd: cdFile, step: stepFile, }, });
            window.onbeforeunload = null as any;
            (window.top || window).location.href = res.checkout_url || '/shop/checkout';
          } catch (e:any) {
            ui.totalValue.textContent = 'Offline';
            ui.hint.textContent = '';
          } finally {
            if (document.visibilityState !== 'hidden') {
              ui.buyButton.disabled = false;
              ui.buyButton.textContent = 'Add to cart';
            }
          }
        }

        ui.buyButton.onclick = beginCheckout;

        const requestQuoteDebounced = debounce(requestQuote, 600);

        (function hookHistoryOnce() {
            const guard = "__quote_history_hook__";
            if ((window as any)[guard]) return;
            (window as any)[guard] = true;

            const T: any = Transaction;
            const origAddToHistory = T.addToHistory.bind(Transaction);
            T.addToHistory = (doc: any, record: any) => {
                try { origAddToHistory(doc, record); }
                finally { requestQuoteDebounced(); }
            };

            const H: any = History;
            const origUndo = H.prototype.undo;
            H.prototype.undo = function (...args: any[]) {
                const r = origUndo.apply(this, args);
                requestQuoteDebounced();
                return r;
            };

            const origRedo = H.prototype.redo;
            H.prototype.redo = function (...args: any[]) {
                const r = origRedo.apply(this, args);
                requestQuoteDebounced();
                return r;
            };
        })();

        PubSub.default.sub("displayHome", (show: boolean) => {
          if (show) {
            inDocument = false;
            currentDoc = null;
            ui.totalValue.textContent = '--';
          }
        });

        PubSub.default.sub("activeViewChanged", async (view: any) => {
          inDocument = !!view;

          if (!view) {
            currentDoc = null;
            ui.totalValue.textContent = '--';
            return;
          }

          currentDoc = view.document;
          const docRef = currentDoc;

          try {
            await syncMaterialsToDocument(docRef);
            if (docRef !== currentDoc) return;
            await requestQuote();
          } catch {
            if (docRef !== currentDoc) return;
            ui.totalValue.textContent = 'Offline';
          }
        });
    })
    .catch((err) => {
        Logger.error(err);
    });
