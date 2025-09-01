import { command, IApplication, Transaction, PubSub, DialogResult, Matrix4, XYZ } from "chili-core";
import { GroupNode, VisualNode } from "chili-core";
import { form, div, label, input } from "chili-controls";

type NodeLike = VisualNode | GroupNode;

@command({ key: "modify.smartScale", icon: "icon-move" })
export class SmartScaleCommand {
    async execute(application: IApplication): Promise<void> {
        const view = application.activeView!;
        const doc = view.document;
        const scope = this.getScope(doc);
        const items = this.collectTopLevel(scope);
        const sheet = this.detectSheet(items);
        if (!sheet) return;
        const legs = this.detectLegs(items, sheet);
        const fence = this.detectFence(items, sheet);
        const current = this.currentParams(sheet, legs, fence);
        const dlg = this.buildDialog(current);
        PubSub.default.pub("showDialog", "dialog.smartScale" as any, dlg, (r: DialogResult) => {
            if (r !== DialogResult.ok) return;
            const target = this.readDialog(dlg, current);
            Transaction.execute(doc, "smart scale", () => {
                if (Number.isFinite(target.sheetW) && Number.isFinite(target.sheetD)) this.resizeSheet(sheet, target.sheetW, target.sheetD);
                if (Number.isFinite(target.legPX) && Number.isFinite(target.legPY)) this.layoutLegs(sheet, legs, target.legPX, target.legPY);
                if (Number.isFinite(target.fenceP)) this.layoutFence(sheet, fence, target.fenceP);
                doc.visual.update();
            });
        });
    }

    private getScope(doc: any): any {
        const sel = doc.selection.getSelectedNodes();
        return (sel[0]?.parent ?? doc.rootNode) as any;
    }

    private collectTopLevel(scope: any): { node: NodeLike; bbox: any }[] {
        const list: { node: NodeLike; bbox: any }[] = [];
        let c = scope.firstChild;
        while (c) {
            if (c instanceof VisualNode || c instanceof GroupNode) {
                const bbox = this.computeBBox(c as any);
                if (bbox) list.push({ node: c as any, bbox });
            }
            c = c.nextSibling;
        }
        return list;
    }

    private computeBBox(node: NodeLike): any | undefined {
        if (node instanceof VisualNode) {
            return node.boundingBox();
        }
        let minX = Number.POSITIVE_INFINITY, minY = Number.POSITIVE_INFINITY, minZ = Number.POSITIVE_INFINITY;
        let maxX = Number.NEGATIVE_INFINITY, maxY = Number.NEGATIVE_INFINITY, maxZ = Number.NEGATIVE_INFINITY;
        let child = node.firstChild as any;
        while (child) {
            if (child instanceof VisualNode) {
                const b = (child as VisualNode).boundingBox();
                if (b) {
                    const pts = [
                        b.min.x, b.min.y, b.min.z,
                        b.max.x, b.min.y, b.min.z,
                        b.min.x, b.max.y, b.min.z,
                        b.max.x, b.max.y, b.min.z,
                        b.min.x, b.min.y, b.max.z,
                        b.max.x, b.min.y, b.max.z,
                        b.min.x, b.max.y, b.max.z,
                        b.max.x, b.max.y, b.max.z,
                    ];
                    const tp = node.transform.ofPoints(pts);
                    for (let i = 0; i < 8; i++) {
                        const x = tp[i * 3], y = tp[i * 3 + 1], z = tp[i * 3 + 2];
                        if (x < minX) minX = x; if (y < minY) minY = y; if (z < minZ) minZ = z;
                        if (x > maxX) maxX = x; if (y > maxY) maxY = y; if (z > maxZ) maxZ = z;
                    }
                }
            }
            child = child.nextSibling;
        }
        if (!isFinite(minX)) return undefined;
        return { min: new XYZ(minX, minY, minZ), max: new XYZ(maxX, maxY, maxZ) };
    }

    private sizeXY(b: any) { return { w: b.max.x - b.min.x, d: b.max.y - b.min.y, h: b.max.z - b.min.z }; }

    private detectSheet(items: { node: NodeLike; bbox: any }[]): NodeLike | undefined {
        let best: { node: NodeLike; bbox: any } | undefined;
        for (const it of items) {
            const s = this.sizeXY(it.bbox);
            const score = s.h < Math.min(s.w, s.d) * 0.2 ? s.w * s.d : -1;
            if (!best || score > (this.sizeXY(best.bbox).h < Math.min(this.sizeXY(best.bbox).w, this.sizeXY(best.bbox).d) * 0.2 ? this.sizeXY(best.bbox).w * this.sizeXY(best.bbox).d : -1)) best = it;
        }
        return best?.node;
    }

    private signature(it: { node: NodeLike; bbox: any }) {
        const s = this.sizeXY(it.bbox);
        const dims = [Math.round(s.w), Math.round(s.d), Math.round(s.h)].sort((a, b) => a - b);
        return dims.join("x");
    }

    private detectLegs(items: { node: NodeLike; bbox: any }[], sheet: NodeLike): NodeLike[] {
        const groups = new Map<string, { node: NodeLike; bbox: any }[]>();
        for (const it of items) {
            if (it.node === sheet) continue;
            const key = this.signature(it) + ":" + it.node.constructor.name;
            const arr = groups.get(key);
            if (arr) arr.push(it); else groups.set(key, [it]);
        }
        let best: { node: NodeLike; bbox: any }[] = [];
        let bestScore = -1;
        const sbox = this.computeBBox(sheet)!;
        const s = this.sizeXY(sbox);
        for (const g of groups.values()) {
            const dim = this.sizeXY(g[0].bbox);
            const tall = dim.h > Math.min(s.w, s.d) * 0.15;
            const score = g.length * (tall ? 2 : 1);
            if (score > bestScore) { best = g; bestScore = score; }
        }
        return best.map(x => x.node);
    }

    private detectFence(items: { node: NodeLike; bbox: any }[], sheet: NodeLike): NodeLike[] {
        const sbox = this.computeBBox(sheet)!;
        const groups = new Map<string, { node: NodeLike; bbox: any }[]>();
        for (const it of items) {
            if (it.node === sheet) continue;
            const key = this.signature(it) + ":" + it.node.constructor.name;
            const arr = groups.get(key);
            if (arr) arr.push(it); else groups.set(key, [it]);
        }
        let best: { node: NodeLike; bbox: any }[] = [];
        let bestScore = -1;
        for (const g of groups.values()) {
            if (g.length < 3) continue;
            const nearPerimeter = g.filter(x => this.nearPerimeter(x.bbox, sbox, 0.05)).length / g.length;
            const score = g.length * nearPerimeter;
            if (score > bestScore) { best = g; bestScore = score; }
        }
        return best.map(x => x.node);
    }

    private nearPerimeter(b: any, sheet: any, ratio: number) {
        const s = this.sizeXY(sheet);
        const m = ratio * Math.min(s.w, s.d);
        const left = Math.abs(b.min.x - sheet.min.x) < m;
        const right = Math.abs(sheet.max.x - b.max.x) < m;
        const bottom = Math.abs(b.min.y - sheet.min.y) < m;
        const top = Math.abs(sheet.max.y - b.max.y) < m;
        return left || right || bottom || top;
    }

    private currentParams(sheet: NodeLike, legs: NodeLike[], fence: NodeLike[]) {
        const sb = this.computeBBox(sheet)!;
        const s = this.sizeXY(sb);
        const legPX = this.estimateLegSpacing(legs, true) || s.w / Math.max(1, Math.round(Math.sqrt(Math.max(1, legs.length))));
        const legPY = this.estimateLegSpacing(legs, false) || s.d / Math.max(1, Math.round(Math.sqrt(Math.max(1, legs.length))));
        const fenceP = this.estimateFenceSpacing(fence, sb) || ((s.w + s.d) * 0.5);
        return { sheetW: s.w, sheetD: s.d, legPX, legPY, fenceP };
    }

    private estimateLegSpacing(legs: NodeLike[], xAxis: boolean): number | undefined {
        if (legs.length < 2) return undefined;
        const coords = legs.map(n => this.center(this.computeBBox(n)!)).map(c => xAxis ? c.x : c.y).sort((a, b) => a - b);
        let gaps: number[] = [];
        for (let i = 1; i < coords.length; i++) gaps.push(coords[i] - coords[i - 1]);
        gaps.sort((a, b) => a - b);
        return gaps[Math.floor(gaps.length / 2)];
    }

    private estimateFenceSpacing(fence: NodeLike[], sb: any): number | undefined {
        if (fence.length < 2) return undefined;
        const per = this.perimeter(sb);
        const n = fence.length;
        return per / n;
    }

    private perimeter(b: any) {
        const s = this.sizeXY(b);
        return 2 * (s.w + s.d);
    }

    private buildDialog(init: { sheetW: number; sheetD: number; legPX: number; legPY: number; fenceP: number; }) {
        const el = form(
            {},
            div({}, label({ textContent: "Sheet width" }), input({ id: "sheet_w", value: init.sheetW.toFixed(3) })),
            div({}, label({ textContent: "Sheet depth" }), input({ id: "sheet_d", value: init.sheetD.toFixed(3) })),
            div({}, label({ textContent: "Leg spacing X" }), input({ id: "leg_px", value: init.legPX.toFixed(3) })),
            div({}, label({ textContent: "Leg spacing Y" }), input({ id: "leg_py", value: init.legPY.toFixed(3) })),
            div({}, label({ textContent: "Fence spacing" }), input({ id: "fence_p", value: init.fenceP.toFixed(3) })),
        );
        return el;
    }

    private readDialog(el: HTMLElement, fallback: any) {
        const num = (id: string, d: number) => {
            const v = parseFloat((el.querySelector("#" + id) as HTMLInputElement | null)?.value ?? "");
            return Number.isFinite(v) ? v : d;
        };
        return {
            sheetW: num("sheet_w", fallback.sheetW),
            sheetD: num("sheet_d", fallback.sheetD),
            legPX: num("leg_px", fallback.legPX),
            legPY: num("leg_py", fallback.legPY),
            fenceP: num("fence_p", fallback.fenceP),
        };
    }

    private resizeSheet(sheet: NodeLike, targetW: number, targetD: number) {
        const bb = this.computeBBox(sheet)!;
        const s = this.sizeXY(bb);
        const kx = s.w === 0 ? 1 : targetW / s.w;
        const ky = s.d === 0 ? 1 : targetD / s.d;
        const sc = sheet.transform.getScale();
        const rot = sheet.transform.getEulerAngles();
        const tr = sheet.transform.translationPart();
        sheet.transform = Matrix4.createFromTRS(tr, rot, new XYZ(sc.x * kx, sc.y * ky, sc.z));
    }

    private layoutLegs(sheet: NodeLike, legs: NodeLike[], px: number, py: number) {
        if (legs.length === 0) return;
        const sbox = this.computeBBox(sheet)!;
        const xs = sbox.min.x, xe = sbox.max.x, ys = sbox.min.y, ye = sbox.max.y;
        const cols = Math.max(1, Math.round((xe - xs) / px));
        const rows = Math.max(1, Math.round((ye - ys) / py));
        let i = 0;
        for (let ry = 0; ry < rows; ry++) {
            for (let cx = 0; cx < cols; cx++) {
                if (i >= legs.length) return;
                const x = cols === 1 ? (xs + xe) * 0.5 : xs + cx * ((xe - xs) / (cols - 1));
                const y = rows === 1 ? (ys + ye) * 0.5 : ys + ry * ((ye - ys) / (rows - 1));
                const z = this.center(this.computeBBox(legs[i])!).z;
                this.setWorldTranslation(legs[i++], new XYZ(x, y, z));
            }
        }
    }

    private layoutFence(sheet: NodeLike, fence: NodeLike[], p: number) {
        if (fence.length === 0) return;
        const sbox = this.computeBBox(sheet)!;
        const pts = [
            new XYZ(sbox.min.x, sbox.min.y, sbox.min.z),
            new XYZ(sbox.max.x, sbox.min.y, sbox.min.z),
            new XYZ(sbox.max.x, sbox.max.y, sbox.min.z),
            new XYZ(sbox.min.x, sbox.max.y, sbox.min.z),
        ];
        const edges = [[pts[0], pts[1]], [pts[1], pts[2]], [pts[2], pts[3]], [pts[3], pts[0]]];
        const total = edges.reduce((a, [a0, b0]) => a + Math.hypot(b0.x - a0.x, b0.y - a0.y), 0);
        const n = Math.max(1, Math.min(fence.length, Math.floor(total / p)));
        let targets: XYZ[] = [];
        for (let i = 0; i < n; i++) {
            let d = (i / n) * total;
            for (const [a, b] of edges) {
                const l = Math.hypot(b.x - a.x, b.y - a.y);
                if (d <= l) {
                    const t = l === 0 ? 0 : d / l;
                    targets.push(new XYZ(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z));
                    break;
                }
                d -= l;
            }
        }
        for (let i = 0; i < n; i++) {
            const z = this.center(this.computeBBox(fence[i])!).z;
            this.setWorldTranslation(fence[i], new XYZ(targets[i].x, targets[i].y, z));
        }
    }

    private center(b: any) {
        return new XYZ((b.min.x + b.max.x) * 0.5, (b.min.y + b.max.y) * 0.5, (b.min.z + b.max.z) * 0.5);
    }

    private setWorldTranslation(node: NodeLike, world: XYZ) {
        const sc = node.transform.getScale();
        const rot = node.transform.getEulerAngles();
        const parent = (node as any).parent as any;
        const W = Matrix4.createFromTRS(world, rot, sc);
        if (parent && (parent as any).transform) {
            const inv = parent.transform.invert();
            node.transform = inv ? inv.multiply(W) : W;
        } else {
            node.transform = W;
        }
    }
}
