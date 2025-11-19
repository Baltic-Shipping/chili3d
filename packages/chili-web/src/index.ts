// See CHANGELOG.md for modifications (updated 2025-11-19)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { AppBuilder } from "chili-builder";
import {
    History,
    I18n,
    Logger,
    Material,
    PubSub,
    Transaction,
    VisualNode,
    getCurrentApplication,
} from "chili-core";
import { Loading } from "./loading";
import { ChiliOdoo } from "./odooApi";

const MATERIALS_CACHE_BASE_KEY = "chili:lastMaterials";

function materialsCacheKey(lang: string | undefined) {
    return lang ? `${MATERIALS_CACHE_BASE_KEY}:${lang}` : MATERIALS_CACHE_BASE_KEY;
}

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

type PartData = {
    thickness: number;
    width: number;
    height: number;
    area: number;
    materialKey: string;
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

function formatMoney(amount: number, currency: string, locale?: string) {
    const loc = locale || (typeof navigator !== "undefined" ? navigator.language : "en-US");
    try {
        return new Intl.NumberFormat(loc, { style: "currency", currency }).format(amount);
    } catch {
        return `${amount.toFixed(2)} ${currency}`;
    }
}

type OdooMat = { key: string; name: string; color?: string; density?: number; basis?: string; uom?: string };

function getPartDimensions(node: any): [number, number, number] | null {
    if (!node) return null;

    if (typeof node.boundingBox === "function") {
        const bb = node.boundingBox();
        if (bb) {
            const sizeX = (bb.max.x ?? 0) - (bb.min.x ?? 0);
            const sizeY = (bb.max.y ?? 0) - (bb.min.y ?? 0);
            const sizeZ = (bb.max.z ?? 0) - (bb.min.z ?? 0);

            if (
                Number.isFinite(sizeX) &&
                Number.isFinite(sizeY) &&
                Number.isFinite(sizeZ) &&
                sizeX > 0 &&
                sizeY > 0 &&
                sizeZ > 0
            ) {
                return [sizeX, sizeY, sizeZ];
            }
        }
    }

    const faces = node?.mesh?.faces;
    if (!faces || !faces.position?.length) return null;

    const pos = faces.position as Float32Array;

    let minX = Infinity,
        maxX = -Infinity;
    let minY = Infinity,
        maxY = -Infinity;
    let minZ = Infinity,
        maxZ = -Infinity;

    for (let i = 0; i < pos.length; i += 3) {
        const x = pos[i];
        const y = pos[i + 1];
        const z = pos[i + 2];

        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
        if (z < minZ) minZ = z;
        if (z > maxZ) maxZ = z;
    }

    const sizeX = maxX - minX;
    const sizeY = maxY - minY;
    const sizeZ = maxZ - minZ;

    if (!Number.isFinite(sizeX) || !Number.isFinite(sizeY) || !Number.isFinite(sizeZ)) {
        return null;
    }

    return [Math.abs(sizeX), Math.abs(sizeY), Math.abs(sizeZ)];
}

function detectThickness(
    dimensions: [number, number, number],
): { thickness: number; width: number; height: number } | null {
    const [a, b, c] = dimensions.sort((x, y) => x - y);

    const THINNESS_RATIO = 0.2;
    if (a / b <= THINNESS_RATIO) {
        return { thickness: a, width: b, height: c };
    }

    return null;
}

async function computePartDataAsync(
    doc: any,
    odooKeyByMatId: Map<string, string>,
): Promise<{ parts: Map<string, PartData[]>; rejectedCount: number }> {
    const partsByMaterialThickness = new Map<string, PartData[]>();
    let rejectedCount = 0;

    const stack: any[] = [];
    if (doc?.rootNode) stack.push(doc.rootNode);

    while (stack.length) {
        const node = stack.pop();

        const dimensions = getPartDimensions(node);
        if (dimensions) {
            const thicknessInfo = detectThickness(dimensions);
            if (thicknessInfo) {
                const materialId = typeof node.materialId === "string" ? node.materialId : null;
                const materialKey = materialId ? odooKeyByMatId.get(materialId) : null;

                if (materialKey) {
                    const key = `${materialKey}@${thicknessInfo.thickness.toFixed(2)}`;
                    if (!partsByMaterialThickness.has(key)) {
                        partsByMaterialThickness.set(key, []);
                    }

                    partsByMaterialThickness.get(key)!.push({
                        thickness: thicknessInfo.thickness,
                        width: thicknessInfo.width,
                        height: thicknessInfo.height,
                        area: thicknessInfo.width * thicknessInfo.height,
                        materialKey: materialKey,
                    });
                }
            } else {
                rejectedCount++;
            }
        }

        let c = node.firstChild;
        while (c) {
            stack.push(c);
            c = c.nextSibling;
        }
    }

    return { parts: partsByMaterialThickness, rejectedCount };
}

let loading = new Loading();
document.body.appendChild(loading);

function createQuoteCard() {
    const card = document.createElement("div");
    card.id = "quote-card";
    card.style.cssText = `
    position: fixed;
    right: 12px;
    bottom: 12px;
    width: 260px;
    border-radius: 12px;
    background: #fff;
    box-shadow: 0 8px 24px rgba(0,0,0,.25);
    font: 14px Manrope,sans-serif;
    overflow: hidden;
  `;
    card.style.display = "none";

    const header = document.createElement("div");
    header.style.cssText = `
    border-bottom: 1px solid rgba(255,255,255,.25);
    display: flex;
    justify-content: space-between;
    align-items: center;
  `;

    const body = document.createElement("div");
    body.style.cssText = `
    padding: 12px;
    display: flex;
    flex-direction: column;
    gap: 12px;
  `;

    const qtyControls = document.createElement("div");
    qtyControls.id = "qc-qty";
    qtyControls.style.cssText = `
    height: 38px;
    display: flex;
    align-items: stretch;
    align-self: flex-end;
    background: #fff;
    border-radius: 5px;
    border: 1px solid #d5d5d5;
    overflow: hidden;
  `;

    const materialsSection = document.createElement("div");
    materialsSection.style.cssText = `
    border: 1px solid #e0e0e0;
    border-radius: 6px;
    overflow: hidden;
    background: #fafafa;
  `;

    const materialsHeader = document.createElement("div");
    materialsHeader.style.cssText = `
    padding: 10px 12px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    cursor: pointer;
    user-select: none;
    transition: background .2s;
  `;
    materialsHeader.onmouseenter = () => (materialsHeader.style.background = "#f0f0f0");
    materialsHeader.onmouseleave = () => (materialsHeader.style.background = "transparent");

    const materialsTitle = document.createElement("span");
    I18n.set(materialsTitle, "textContent", "checkout.materials");
    materialsTitle.style.cssText = `font-weight: 600; color: #333; font-size: 13px;`;

    const materialsToggle = document.createElement("span");
    materialsToggle.textContent = "▼";
    materialsToggle.style.cssText = `font-size: 18px; color: #666; transition: transform .2s;`;

    materialsHeader.appendChild(materialsTitle);
    materialsHeader.appendChild(materialsToggle);

    const materialsList = document.createElement("div");
    materialsList.style.cssText = `
    max-height: 0;
    overflow: hidden;
    transition: max-height .3s ease-out;
    background: #fff;
  `;

    let isExpanded = false;
    materialsHeader.onclick = () => {
        isExpanded = !isExpanded;
        materialsList.style.maxHeight = isExpanded ? "200px" : "0";
        materialsList.style.overflowY = isExpanded ? "auto" : "hidden";
        materialsList.style.borderTop = isExpanded ? "1px solid #e0e0e0" : "none";
        materialsToggle.style.transform = isExpanded ? "rotate(180deg)" : "rotate(0)";
    };

    materialsSection.appendChild(materialsHeader);
    materialsSection.appendChild(materialsList);

    const minusButton = document.createElement("button");
    minusButton.id = "qc-minus";
    minusButton.textContent = "–";
    minusButton.setAttribute("aria-label", "minus");
    minusButton.style.cssText = `
    width: 30px;
    height: 100%;
    border: none;
    background: #fff;
    color: #111;
    cursor: pointer;
    font-size: 18px;
    font-weight: 600;
    transition: background .2s;
  `;
    minusButton.onmouseenter = () => (minusButton.style.background = "#f5f5f5");
    minusButton.onmouseleave = () => (minusButton.style.background = "#fff");

    const qtyInput = document.createElement("input");
    qtyInput.id = "qc-input";
    qtyInput.type = "number";
    qtyInput.min = "1";
    qtyInput.max = "100";
    qtyInput.value = "1";
    qtyInput.style.cssText = `
    width: 40px;
    text-align: center;
    border: none;
    padding: 6px 4px;
    background: #fff;
    color: #111;
    font-weight: 700;
    -moz-appearance: textfield;
  `;

    const style = document.createElement("style");
    style.textContent = `
    #qc-input::-webkit-outer-spin-button,
    #qc-input::-webkit-inner-spin-button {
      -webkit-appearance: none;
      margin: 0;
    }
  `;
    document.head.appendChild(style);

    const plusButton = document.createElement("button");
    plusButton.id = "qc-plus";
    plusButton.textContent = "+";
    plusButton.setAttribute("aria-label", "plus");
    plusButton.style.cssText = `
    width: 30px;
    height: 100%;
    border: none;
    background: #fff;
    color: #111;
    cursor: pointer;
    font-size: 18px;
    font-weight: 600;
    transition: background .2s;
  `;
    plusButton.onmouseenter = () => (plusButton.style.background = "#f5f5f5");
    plusButton.onmouseleave = () => (plusButton.style.background = "#fff");

    qtyControls.appendChild(minusButton);
    qtyControls.appendChild(qtyInput);
    qtyControls.appendChild(plusButton);

    const totalRow = document.createElement("div");
    totalRow.style.cssText = `
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 8px 0;
    border-top: 1px solid #e0e0e0;
  `;

    const totalLabel = document.createElement("div");
    I18n.set(totalLabel, "textContent", "checkout.total");
    totalLabel.style.cssText = `
    font-weight: 600;
    color: #666;
  `;

    const totalValue = document.createElement("div");
    totalValue.id = "qc-total";
    totalValue.textContent = "--";
    totalValue.style.cssText = `
    font-weight: 800;
    font-size: 18px;
    color: #111;
  `;

    totalRow.appendChild(totalLabel);
    totalRow.appendChild(totalValue);

    const buyButton = document.createElement("button");
    buyButton.id = "qc-buy";
    I18n.set(buyButton, "textContent", "checkout.addToCart");
    buyButton.style.cssText = `
    background: #E00C30;
    color: #fff;
    border: none;
    border-radius: 6px;
    padding: 10px;
    width: 100%;
    font: bold 14px Manrope,sans-serif;
    cursor: pointer;
    transition: background .2s;
  `;
    buyButton.onmouseenter = () => (buyButton.style.background = "#c00a28");
    buyButton.onmouseleave = () => (buyButton.style.background = "#E00C30");

    body.appendChild(qtyControls);
    body.appendChild(materialsSection);
    body.appendChild(totalRow);
    body.appendChild(buyButton);
    card.appendChild(header);
    card.appendChild(body);
    document.body.appendChild(card);

    return {
        card,
        buyButton,
        totalValue,
        qtyInput,
        minusButton,
        plusButton,
        materialsList,
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

        async function autosaveCurrentDocument(reason: string) {
            if (!currentDoc || typeof (currentDoc as any).save !== "function") return;

            try {
                await (currentDoc as any).save();
            } catch (err) {
                Logger.warn(`Autosave before ${reason} failed`, err);
            }
        }

        function hideQuoteCard() {
          ui.card.style.display = "none";
          ui.totalValue.textContent = "--";
          ui.materialsList.innerHTML = "";
          ui.buyButton.disabled = true;
        }

        function showQuoteCard() {
          ui.card.style.display = "block";
        }

        const hexToColor = (hex: string | undefined, key: string): number => {
            if (hex) {
                return parseInt(hex.substring(1), 16);
            }
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

          const lang = I18n.currentLanguage();
          const cacheKey = materialsCacheKey(lang);

          try {
            const res = await ChiliOdoo.materials(lang);
            const live: OdooMat[] = res?.materials || [];
            if (live.length) {
              list = live;
              try { localStorage.setItem(cacheKey, JSON.stringify(live)); } catch {}
            }
          } catch {
          }

          if (!list || !list.length) {
            try {
              const raw = localStorage.getItem(cacheKey);
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
              const color = hexToColor(o.color, o.key);
              const m = new Material(doc, o.name, color);
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
                I18n.set(ui.buyButton, "textContent", "checkout.addToCart");
                rebindMapFromDoc(currentDoc);
                normalizeUnknownMaterials(currentDoc);

                const result = await computePartDataAsync(currentDoc, odooKeyByMatId);
                const { parts: partsByGroup, rejectedCount } = result;
                // if (!partsByGroup || partsByGroup.size === 0) { return; }
                if (myGen !== latestGen()) return;

                const groups = partsByGroup && partsByGroup.size > 0 
                ? Array.from(partsByGroup, ([key, parts]) => {
                    const [materialKey, thicknessStr] = key.split('@');
                    const thickness = parseFloat(thicknessStr);
                    const totalArea = parts.reduce((sum, p) => sum + p.area, 0);
                    
                    return {
                        material_key: materialKey,
                        thickness: thickness,
                        total_area: totalArea,
                    };
                })
                : [];

                const res = await ChiliOdoo.quote({ groups, quantity });
                lastQuoteId = (res as any)?.quote_id;
                if (myGen !== latestGen()) return;

                if (res.requires_contact || rejectedCount > 0) {
                  const warning = document.createElement('div');
                  warning.style.cssText = `
                      padding: 8px 12px;
                      font-size: 12px;
                      color: #d32f2f;
                      background: #ffebee;
                      border-radius: 4px;
                  `;
                  I18n.set(warning, "textContent", "warning.quote");
                  if (rejectedCount > 0) {
                      I18n.set(warning, "textContent", "warning.nonLaser");
                  }
                  ui.totalValue.textContent = '--';
                  ui.materialsList.innerHTML = '';
                  ui.materialsList.appendChild(warning);
                  ui.buyButton.disabled = false;
                  I18n.set(ui.buyButton, "textContent", "checkout.quote");
                  return;
                }

                const fmt = (n: number) => formatMoney(n, res.currency);
                ui.totalValue.textContent = `${fmt(res.total)}`;
                ui.materialsList.innerHTML = '';
                if (res.items && Array.isArray(res.items)) {
                  res.items.forEach((item: any) => {
                    const material = odooList.find(m => m.key === item.key);
                    const materialName = material?.name || item.key;
                    
                    const row = document.createElement('div');
                    row.style.cssText = `
                      padding: 10px 12px;
                      display: grid;
                      grid-template-columns: 1fr auto auto;
                      gap: 12px;
                      align-items: center;
                      border-bottom: 1px solid #f0f0f0;
                      font-size: 13px;
                    `;
                    
                    const name = document.createElement('span');
                    name.textContent = materialName;
                    name.style.cssText = `color: #333; font-weight: 500;`;
                    
                    const qty = document.createElement('span');
                    // qty.textContent = `${item.quantity.toFixed(2)} kg`;
                    qty.style.cssText = `color: #666; text-align: right; font-size: 12px;`;
                    
                    const price = document.createElement('span');
                    price.textContent = fmt(item.subtotal);
                    price.style.cssText = `font-weight: 600; color: #333; text-align: right; min-width: 60px;`;
                    
                    row.appendChild(name);
                    row.appendChild(qty);
                    row.appendChild(price);
                    ui.materialsList.appendChild(row);
                  });
                }
                ui.buyButton.disabled = false;
            } catch (e:any) {
                if (myGen !== latestGen()) return;
                
                ui.totalValue.textContent = e?.code === 'BAD_INPUT' ? '--' : 'Offline';
                ui.materialsList.innerHTML = '';
                ui.buyButton.disabled = true;
                I18n.set(ui.buyButton, "textContent", "checkout.quote");
            }
        }

        async function beginCheckout() {
          if (!canQuote()) return;
          ui.buyButton.disabled = true;
          ui.buyButton.textContent = '...';

          try {
            await autosaveCurrentDocument("checkout");
            rebindMapFromDoc(currentDoc);
            normalizeUnknownMaterials(currentDoc);

            const snapshot = buildVerifySnapshot(currentDoc, odooKeyByMatId);
            const result = await computePartDataAsync(currentDoc, odooKeyByMatId);
            const { parts: partsByGroup, rejectedCount } = result;

            const groups = partsByGroup && partsByGroup.size > 0 
            ? Array.from(partsByGroup, ([key, parts]) => {
                const [materialKey, thicknessStr] = key.split('@');
                const thickness = parseFloat(thicknessStr);
                const totalArea = parts.reduce((sum, p) => sum + p.area, 0);
                
                return {
                    material_key: materialKey,
                    thickness: thickness,
                    total_area: totalArea,
                };
            })
            : [];  

            const [cdFile, stepFile] = await Promise.all([
              exportCdFile(currentDoc),
              exportStepFile(currentDoc).catch(() => null),
            ]);

            const res = await ChiliOdoo.checkout({ snapshot, quantity: quantity, groups, files: { cd: cdFile, step: stepFile },});
            
            window.onbeforeunload = null as any;
            (window.top || window).location.href = res.redirect_url;
          } catch (e: any) {
            ui.totalValue.textContent = 'Offline';
          } finally {
            if (document.visibilityState !== 'hidden') {
              ui.buyButton.disabled = false;
              I18n.set(ui.buyButton, "textContent", "checkout.addToCart");
            }
          }
        }

        ui.buyButton.onclick = () => beginCheckout();

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
            const app = getCurrentApplication();
            const view = app?.activeView;
            const doc = (currentDoc as any) || view?.document;

            if (doc && typeof doc.save === "function") {
              (async () => {
                try {
                  await doc.save();
                } catch (err) {
                  Logger.warn("Autosave when going to home failed", err);
                }
              })();
            }
            inDocument = false;
            currentDoc = null;
            hideQuoteCard();
          } else {
            const view = getCurrentApplication()?.activeView;
            inDocument = !!view
            currentDoc = view?.document ?? null;

            if (currentDoc) {
              showQuoteCard();
              (async () => {
                const docRef = currentDoc;
                try {
                  await syncMaterialsToDocument(docRef);
                  if (docRef === currentDoc) await requestQuote();
                } catch {
                  if (docRef === currentDoc ) ui.totalValue.textContent = 'Offline';
                }
              })();
            } else {
              hideQuoteCard();
            }
          }
        });

        PubSub.default.sub("activeViewChanged", async (view: any) => {
          inDocument = !!view;

          if (!view) {
            currentDoc = null;
            hideQuoteCard();
            return;
          }

          currentDoc = view.document;
          showQuoteCard();
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
