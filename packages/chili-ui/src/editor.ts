// See CHANGELOG.md for modifications (updated 2025-08-13)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { button, div, Expander, input, label, option, select } from "chili-controls";
import {
    AsyncController,
    Button,
    ButtonSize,
    CommandKeys,
    GeometryNode,
    getCurrentApplication,
    I18nKeys,
    IApplication,
    IDocument,
    IElementarySurface,
    IFace,
    INode,
    IView,
    Material,
    Orientation,
    Plane,
    Property,
    PubSub,
    RibbonTab,
    ShapeNode,
    ShapeType,
    Transaction,
    VisualShapeData,
    VisualState,
    XYZ
} from "chili-core";
import { BooleanNode } from "../../chili/src/bodys/boolean";
import style from "./editor.module.css";
import { OKCancel } from "./okCancel";
import { ProjectView } from "./project";
import { PropertyView } from "./property";
import { MaterialDataContent, MaterialEditor } from "./property/material";
import { MaterialProperty } from "./property/materialProperty";
import { Ribbon, RibbonDataContent } from "./ribbon";
import { RibbonButton } from "./ribbon/ribbonButton";
import { RibbonTabData } from "./ribbon/ribbonData";
import { Statusbar } from "./statusbar";
import { LayoutViewport } from "./viewport";

let quickCommands: CommandKeys[] = ["doc.save", "doc.saveToFile", "edit.undo", "edit.redo"];

export class Editor extends HTMLElement {
    readonly ribbonContent: RibbonDataContent;
    private readonly _selectionController: OKCancel;
    private readonly _viewportContainer: HTMLDivElement;
    private _sidebarWidth: number = 360;
    private _isResizingSidebar: boolean = false;
    private _templateSidebarEl: HTMLDivElement | null = null;
    private _sidebarEl: HTMLDivElement | null = null;
    private _materialExpander?: Expander;
    private _materialPanel?: HTMLDivElement;
    private _cutoutExpander?: Expander;
    private _cutoutPanel?: HTMLDivElement;
    private _cutoutPreviewId?: number;
    private _cutoutFace?: VisualShapeData;
    private _cutoutNode?: ShapeNode;
    private _cutoutPlane?: Plane;
    private _cutoutHintEl?: HTMLElement;
    private _cutoutActive = false;
    private _cutoutPrefs = { through: false, depth: 10 };

    constructor(app: IApplication, tabs: RibbonTab[]) {
        super();
        const allTabs = tabs.map(RibbonTabData.fromProfile);
        const filteredTabs = allTabs.filter(tabData => tabData.tabName !== "ribbon.tab.templates");
        this.ribbonContent = new RibbonDataContent(app, quickCommands, filteredTabs);

        const viewport = new LayoutViewport(app);
        viewport.classList.add(style.viewport);
        this._selectionController = new OKCancel();
        this._viewportContainer = div(
            { className: style.viewportContainer },
            this._selectionController,
            viewport,
        );
        this.clearSelectionControl();
        this.render();
        document.body.appendChild(this);
    }

    private readonly _updateMaterialSection = (document: IDocument, nodes: INode[]) => {
        if (!this._materialPanel) return;
        while (this._materialPanel.lastElementChild) this._materialPanel.removeChild(this._materialPanel.lastElementChild);
        const geomNodes = nodes.filter((n): n is GeometryNode => n instanceof GeometryNode);
        if (geomNodes.length === 0) return;
        const prop = Property.getProperty(GeometryNode.prototype, "materialId");
        if (!prop) return;
        this._materialPanel.append(new MaterialProperty(document, geomNodes, prop));
        };

        private readonly _onShowPropertiesForMaterial = (document: IDocument, nodes: INode[]) => {
        this._updateMaterialSection(document, nodes);
        };

        private readonly _onActiveViewChangedForMaterial = (view: IView | undefined) => {
        if (!view) {
            if (!this._materialPanel) return;
            while (this._materialPanel.lastElementChild) this._materialPanel.removeChild(this._materialPanel.lastElementChild);
            return;
        }
        const nodes = view.document.selection.getSelectedNodes();
        this._updateMaterialSection(view.document, nodes);
        };


    private render() {
        const templateCommands: CommandKeys[] = [
            "create.popupbox",
            "create.popuptube",
            "create.popupcylinder",
            "create.popupTeeSection",
            "create.popupLSection",
            "create.popupHSection",
            "create.popupUSection",
            "create.popupRecSection",
            "file.import",
        ];
        const templatesExpander = new Expander("ribbon.tab.templates" as I18nKeys);
        const contentPanel = templatesExpander.contenxtPanel;
        contentPanel.classList.add(style.templateGrid);
        templateCommands.forEach(cmd => {
            const btn = RibbonButton.fromCommandName(cmd, ButtonSize.large);
            if (!btn) return;
            const tooltip = btn.textContent?.trim() || '';
            btn.classList.add(style.hasTooltip);
            btn.setAttribute('data-tooltip', tooltip);
            btn.querySelectorAll('span, label').forEach(el => el.remove());
            btn.removeAttribute('title');
            contentPanel.append(btn);
        });
        const cutoutExpander = new Expander("templates.cutout" as I18nKeys);
        const cutoutPanel = cutoutExpander.contenxtPanel as HTMLDivElement;
        this._cutoutExpander = cutoutExpander;
        this._cutoutPanel = cutoutPanel;

        const addBtn = button({textContent: "Add", onclick: () => this.startCutoutFlow(),});
        cutoutPanel.append(addBtn);

        const materialExpander = new Expander("sidebar.material" as I18nKeys);
        const materialPanel = materialExpander.contenxtPanel as HTMLDivElement;
        this._materialExpander = materialExpander;
        this._materialPanel = materialPanel;
        this._templateSidebarEl = div(
            { 
                className: style.sidebar, style: `width: ${this._sidebarWidth}px; overflow-y: auto;` 
            },
            templatesExpander,
            cutoutExpander,
            materialExpander
        );

        this._sidebarEl = div(
            {
                className: style.sidebar,
                style: `width: ${this._sidebarWidth}px;`,
            },
            new ProjectView({ className: style.sidebarItem }),
            new PropertyView({ className: style.sidebarItem }),
            div({
                className: style.sidebarResizer,
                onmousedown: (e: MouseEvent) => this._startSidebarResize(e),
            }),
        );
        this.innerHTML = "";
        this.append(
            div(
                { className: style.root },
                new Ribbon(this.ribbonContent),
                div({ className: style.content }, this._templateSidebarEl, this._sidebarEl, this._viewportContainer),
                new Statusbar(style.statusbar),
            ),
        );
    }

    private async startCutoutFlow() {
        if (this._cutoutActive) return;
        const app = getCurrentApplication();
        const view = app?.activeView;
        if (!view) return;
        const doc = view.document;

        this._cutoutActive = true;
        this.clearCutoutUI();

        if (this._cutoutPanel) {
            this._cutoutHintEl = div({ textContent: "Click a face…" });
            this._cutoutPanel.append(this._cutoutHintEl);
        }
        PubSub.default.pub("statusBarTip", "prompt.select.face" as I18nKeys);
        PubSub.default.pub("viewCursor", "select.default");

        doc.selection.shapeType = ShapeType.Face;
        const controller = new AsyncController();
        const shapes = await doc.selection.pickShape("prompt.select.face" as I18nKeys, controller, false);

        PubSub.default.pub("clearStatusBarTip");
        PubSub.default.pub("viewCursor", "default");
        if (!shapes || shapes.length === 0) {
            if (this._cutoutHintEl) { this._cutoutHintEl.remove(); this._cutoutHintEl = undefined; }
            this._cutoutActive = false;
            this.resetCutoutPanel();
            return;
        }

        const vs = shapes[0] as VisualShapeData;
        const node = vs.owner.node as ShapeNode;
        const face = vs.shape as IFace;
        const surf = face.surface() as IElementarySurface;
        const plane = surf.coordinates as Plane;

        this._cutoutFace = vs;
        this._cutoutNode = node;
        this._cutoutPlane = plane;

        if (this._cutoutHintEl) { this._cutoutHintEl.remove(); this._cutoutHintEl = undefined; }
        this.buildCutoutUI();
        this.updateCutoutPreview();
    }

    private _computeCutDefaults(): { cx: number; cy: number; radius: number; rectW: number; rectH: number } {
        if (!this._cutoutFace || !this._cutoutPlane) {
            return { cx: 0, cy: 0, radius: 10, rectW: 20, rectH: 20 };
        }

        const planeW = (() => {
            const vs = this._cutoutFace!;
            try { return this._cutoutPlane!.transformed(vs.transform); } catch { return this._cutoutPlane!; }
        })();

        const face = this._cutoutFace.shape as IFace;
        const T = this._cutoutFace.transform;

        let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;

        try {
            const wire = face.outerWire();
            const edges = wire.edgesMeshPosition();
            const pos = edges.position as Float32Array | number[];
            const xv = planeW.xvec.normalize()!;
            const yv = planeW.yvec.normalize()!;
            const o = planeW.origin;
            for (let i = 0; i < pos.length; i += 3) {
                const px = pos[i], py = pos[i + 1], pz = pos[i + 2];
                const pWorld = T.ofPoint(new XYZ(px, py, pz));
                const d = pWorld.add(o.multiply(-1));
                const u = d.dot(xv);
                const v = d.dot(yv);
                if (u < minU) minU = u; if (u > maxU) maxU = u;
                if (v < minV) minV = v; if (v > maxV) maxV = v;
            }
        } catch {
            const bb = this._cutoutNode?.boundingBox();
            if (bb) {
                const xv = planeW.xvec.normalize()!;
                const yv = planeW.yvec.normalize()!;
                const o = planeW.origin;
                const corners = [
                    new XYZ(bb.min.x, bb.min.y, bb.min.z),
                    new XYZ(bb.max.x, bb.min.y, bb.min.z),
                    new XYZ(bb.min.x, bb.max.y, bb.min.z),
                    new XYZ(bb.min.x, bb.min.y, bb.max.z),
                    new XYZ(bb.max.x, bb.max.y, bb.min.z),
                    new XYZ(bb.max.x, bb.min.y, bb.max.z),
                    new XYZ(bb.min.x, bb.max.y, bb.max.z),
                    new XYZ(bb.max.x, bb.max.y, bb.max.z),
                ];
                for (const c of corners) {
                    const d = c.add(o.multiply(-1));
                    const u = d.dot(xv);
                    const v = d.dot(yv);
                    if (u < minU) minU = u; if (u > maxU) maxU = u;
                    if (v < minV) minV = v; if (v > maxV) maxV = v;
                }
            } else {
                minU = 0; maxU = 20; minV = 0; maxV = 20;
            }
        }

        const extU = Math.max(0.1, maxU - minU);
        const extV = Math.max(0.1, maxV - minV);
        const cx = (minU + maxU) / 2;
        const cy = (minV + maxV) / 2;
        const radius = Math.max(0.1, Math.min(extU, extV) / 2);
        const rectW = extU;
        const rectH = extV;

        return { cx, cy, radius, rectW, rectH };
    }

    private buildCutoutUI() {
        if (!this._cutoutPanel) return;
        while (this._cutoutPanel.firstChild) this._cutoutPanel.removeChild(this._cutoutPanel.firstChild);
        const def = this._computeCutDefaults();

        const typeSel = select(
            { id: "cut-type" },
            option({ value: "circle", textContent: "Circle" }),
            option({ value: "rect", textContent: "Rectangle" }),
        );

        const cx = input({ id: "cut-cx", type: "number", value: String(+def.cx.toFixed(3)), step: "0.1" });
        const cy = input({ id: "cut-cy", type: "number", value: String(+def.cy.toFixed(3)), step: "0.1" });

        const radRow = div({ id: "row-radius" },
            label({ textContent: "Radius" }),
            input({ id: "cut-radius", type: "number", value: String(+def.radius.toFixed(3)), min: "0", step: "0.1" }),
        );

        const wRow = div({ id: "row-width" },
            label({ textContent: "Width" }),
            input({ id: "cut-width", type: "number", value: String(+def.rectW.toFixed(3)), min: "0", step: "0.1" }),
        );

        const hRow = div({ id: "row-height" },
            label({ textContent: "Height" }),
            input({ id: "cut-height", type: "number", value: String(+def.rectH.toFixed(3)), min: "0", step: "0.1" }),
        );

        const depth = input({ id: "cut-depth", type: "number", value: String(this._cutoutPrefs.depth), min: "0", step: "0.1" });
        const through = input({ id: "cut-through", type: "checkbox", checked: this._cutoutPrefs.through });
        const depthRow = div({}, label({ textContent: "Depth" }), depth);

        const applyBtn = button({ textContent: "Apply", onclick: () => this.applyCutout() });
        const cancelBtn = button({ textContent: "Cancel", onclick: () => this.cancelCutout() });

        const applyVisibility = () => {
            (depthRow as HTMLElement).style.display = (through as HTMLInputElement).checked ? "none" : "";
        };

        const onShapeChange = () => {
            const t = (typeSel as HTMLSelectElement).value;
            (radRow as HTMLElement).style.display = t === "circle" ? "" : "none";
            (wRow as HTMLElement).style.display = t === "rect" ? "" : "none";
            (hRow as HTMLElement).style.display = t === "rect" ? "" : "none";
            this.updateCutoutPreview();
        };

        typeSel.onchange = onShapeChange;
        (cx as HTMLInputElement).oninput = onShapeChange;
        (cy as HTMLInputElement).oninput = onShapeChange;
        (radRow.querySelector("#cut-radius") as HTMLInputElement).oninput = onShapeChange;
        (wRow.querySelector("#cut-width") as HTMLInputElement).oninput = onShapeChange;
        (hRow.querySelector("#cut-height") as HTMLInputElement).oninput = onShapeChange;

        (depth as HTMLInputElement).oninput = () => {
            this._cutoutPrefs.depth = parseFloat(depth.value) || 0;
            this.updateCutoutPreview();
        };

        (through as HTMLInputElement).onchange = () => {
            this._cutoutPrefs.through = (through as HTMLInputElement).checked;
            applyVisibility();
            this.updateCutoutPreview();
        };

        this._cutoutPanel.append(
            div({}, label({ textContent: "Type" }), typeSel),
            div({}, label({ textContent: "Center X" }), cx),
            div({}, label({ textContent: "Center Y" }), cy),
            radRow,
            wRow,
            hRow,
            depthRow,
            div({}, label({ textContent: "Through" }), through),
            div({}, applyBtn, cancelBtn),
        );

        onShapeChange();
        applyVisibility();
    }

    private updateCutoutPreview() {
        const app = getCurrentApplication();
        const view = app?.activeView;
        if (!view || !this._cutoutPlane || !this._cutoutPanel) return;

        if (this._cutoutPreviewId !== undefined) {
            view.document.visual.context.removeMesh(this._cutoutPreviewId);
            this._cutoutPreviewId = undefined;
        }

        const plane = this.getWorldPlane();
        const typeSel = this._cutoutPanel.querySelector<HTMLSelectElement>("#cut-type")!;
        const cx = parseFloat(this._cutoutPanel.querySelector<HTMLInputElement>("#cut-cx")!.value) || 0;
        const cy = parseFloat(this._cutoutPanel.querySelector<HTMLInputElement>("#cut-cy")!.value) || 0;
        const center = plane.origin.add(plane.xvec.multiply(cx)).add(plane.yvec.multiply(cy));

        const sf = app.shapeFactory;

        if (typeSel.value === "circle") {
            const r = Math.max(0.1, parseFloat(this._cutoutPanel.querySelector<HTMLInputElement>("#cut-radius")!.value) || 0);
            const edge = sf.circle(plane.normal, center, r);
            if (!edge.isOk) return;
            const mesh = edge.value.mesh.edges!;
            this._cutoutPreviewId = view.document.visual.context.displayMesh([mesh]);
            edge.value.dispose();
        } else {
            const w = Math.max(0.1, parseFloat(this._cutoutPanel.querySelector<HTMLInputElement>("#cut-width")!.value) || 0);
            const h = Math.max(0.1, parseFloat(this._cutoutPanel.querySelector<HTMLInputElement>("#cut-height")!.value) || 0);
            const o = center.add(plane.xvec.multiply(-w * 0.5)).add(plane.yvec.multiply(-h * 0.5));
            const faceRes = sf.rect(new Plane(o, plane.normal, plane.xvec), w, h);
            if (!faceRes.isOk) return;
            const wire = faceRes.value.outerWire();
            const mesh = wire.mesh.edges!;
            this._cutoutPreviewId = view.document.visual.context.displayMesh([mesh]);
            wire.dispose();
            faceRes.value.dispose();
        }

        view.update();
    }

    private applyCutout() {
        if (!this._cutoutNode || !this._cutoutPlane || !this._cutoutPanel) return;

        const app = getCurrentApplication();
        const view = app?.activeView;
        if (!view) return;

        const node = this._cutoutNode;
        const plane = this._cutoutPlane;
        const panel = this._cutoutPanel!;
        const sf = app.shapeFactory;

        const cx = parseFloat(panel.querySelector<HTMLInputElement>("#cut-cx")!.value) || 0;
        const cy = parseFloat(panel.querySelector<HTMLInputElement>("#cut-cy")!.value) || 0;
        const centerOnFace = plane.origin.add(plane.xvec.multiply(cx)).add(plane.yvec.multiply(cy));

        const through = panel.querySelector<HTMLInputElement>("#cut-through")!.checked;
        const depthIn = parseFloat(panel.querySelector<HTMLInputElement>("#cut-depth")!.value) || 0;

        const nUnit = plane.normal.normalize();
        if (!nUnit) return;

        const face = this._cutoutFace!.shape as IFace;
        const outwardLocal = face.orientation() === Orientation.REVERSED ? nUnit.multiply(-1) : nUnit;
        const inwardLocal = outwardLocal.multiply(-1);
        
        const T = this._cutoutFace!.transform;
        const outwardWorld = T.ofVector(outwardLocal);
        const eps = through ? 0.5 : 0.0;
        const span = this.projectSpanAlong(node, outwardWorld);
        const H = through ? (span + 2 * eps) : Math.max(0.1, depthIn);


        const t = panel.querySelector<HTMLSelectElement>("#cut-type")!.value;
        let toolRes;

        if (t === "circle") {
            const r = Math.max(0.1, parseFloat(panel.querySelector<HTMLInputElement>("#cut-radius")!.value) || 0);
            const edgeRes = sf.circle(plane.normal, centerOnFace, r);
            if (!edgeRes.isOk) return;
            const wireRes = sf.wire([edgeRes.value]);
            edgeRes.value.dispose?.();
            if (!wireRes.isOk) return;
            const faceRes = sf.face([wireRes.value]);
            wireRes.value.dispose?.();
            if (!faceRes.isOk) return;
            toolRes = sf.prism(faceRes.value, inwardLocal.multiply(H));
            faceRes.value.dispose?.();
        } else {
            const w = Math.max(0.1, parseFloat(panel.querySelector<HTMLInputElement>("#cut-width")!.value) || 0);
            const h = Math.max(0.1, parseFloat(panel.querySelector<HTMLInputElement>("#cut-height")!.value) || 0);
            const origin = centerOnFace.add(plane.xvec.multiply(-w*0.5)).add(plane.yvec.multiply(-h*0.5));
            const faceRes = sf.rect(new Plane(origin, plane.normal, plane.xvec), w, h);
            if (!faceRes.isOk) return;
            toolRes = sf.prism(faceRes.value, inwardLocal.multiply(H));
            faceRes.value.dispose?.();
        }
        if (!toolRes.isOk) return;

        const baseShape = node.shape.value;
        const cutRes = sf.booleanCut([baseShape], [toolRes.value]);
        toolRes.value.dispose?.();
        if (!cutRes.isOk) return;
        const oldTransform = node.transform;
        const oldMaterial = (node as GeometryNode).materialId;
        Transaction.execute(view.document, "cutout", () => {
            const newNode = new BooleanNode(view.document, cutRes.value);
            newNode.transform = oldTransform;
            (newNode as GeometryNode).materialId = oldMaterial;
            node.parent?.remove(node);
            view.document.addNode(newNode);
        });

        try { view.document.visual.update(); } finally { this.finishCutout(); }
    }

    private clearCutoutUI() {
        const view = getCurrentApplication()?.activeView;
        if (this._cutoutPreviewId !== undefined && view) {
            view.document.visual.context.removeMesh(this._cutoutPreviewId);
            this._cutoutPreviewId = undefined;
        }
        this._cutoutFace = undefined;
        this._cutoutNode = undefined;
        this._cutoutPlane = undefined;
        if (this._cutoutPanel) {
            while (this._cutoutPanel.firstChild) this._cutoutPanel.removeChild(this._cutoutPanel.firstChild);
            this._cutoutPanel.append(button({ textContent: "Add", onclick: () => this.startCutoutFlow() }));
        }
        this._cutoutActive = false;
    }

    private projectSpanAlong(node: ShapeNode, dir: XYZ) {
        const bb = node.boundingBox();
        if (!bb) return 1000;
        const u = dir.normalize()!;
        const corners = [
            new XYZ(bb.min.x, bb.min.y, bb.min.z),
            new XYZ(bb.max.x, bb.min.y, bb.min.z),
            new XYZ(bb.min.x, bb.max.y, bb.min.z),
            new XYZ(bb.min.x, bb.min.y, bb.max.z),
            new XYZ(bb.max.x, bb.max.y, bb.min.z),
            new XYZ(bb.max.x, bb.min.y, bb.max.z),
            new XYZ(bb.min.x, bb.max.y, bb.max.z),
            new XYZ(bb.max.x, bb.max.y, bb.max.z),
        ];
        let min = Infinity, max = -Infinity;
        for (const c of corners) {
            const p = u.dot(c);
            if (p < min) min = p;
            if (p > max) max = p;
        }
        return max - min;
    }

    private _startSidebarResize(e: MouseEvent) {
        e.preventDefault();
        this._isResizingSidebar = true;
        document.body.style.cursor = "ew-resize";
        const onMouseMove = (ev: MouseEvent) => {
            if (!this._isResizingSidebar || !this._sidebarEl || !this._templateSidebarEl) return;
            const sidebarRect = this._sidebarEl.getBoundingClientRect();
            let newWidth = ev.clientX - sidebarRect.left;
            const minWidth = 75;
            const maxWidth = Math.floor(window.innerWidth * 0.85);
            newWidth = Math.max(minWidth, Math.min(maxWidth, newWidth));
            this._sidebarWidth = newWidth;
            this._sidebarEl.style.width = `${newWidth}px`;
            this._templateSidebarEl.style.width = `${newWidth}px`;
        };
        const onMouseUp = () => {
            this._isResizingSidebar = false;
            document.body.style.cursor = "";
            window.removeEventListener("mousemove", onMouseMove);
            window.removeEventListener("mouseup", onMouseUp);
        };
        window.addEventListener("mousemove", onMouseMove);
        window.addEventListener("mouseup", onMouseUp);
    }

    connectedCallback(): void {
        PubSub.default.sub("showSelectionControl", this.showSelectionControl);
        PubSub.default.sub("editMaterial", this._handleMaterialEdit);
        PubSub.default.sub("clearSelectionControl", this.clearSelectionControl);

        PubSub.default.sub("showProperties", this._onShowPropertiesForMaterial);
        PubSub.default.sub("activeViewChanged", this._onActiveViewChangedForMaterial);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("showSelectionControl", this.showSelectionControl);
        PubSub.default.remove("editMaterial", this._handleMaterialEdit);
        PubSub.default.remove("clearSelectionControl", this.clearSelectionControl);

        PubSub.default.remove("showProperties", this._onShowPropertiesForMaterial);
        PubSub.default.remove("activeViewChanged", this._onActiveViewChangedForMaterial);
    }

    private readonly showSelectionControl = (controller: AsyncController) => {
        this._selectionController.setControl(controller);
        this._selectionController.style.visibility = "visible";
        this._selectionController.style.zIndex = "1000";
    };

    private readonly clearSelectionControl = () => {
        this._selectionController.setControl(undefined);
        this._selectionController.style.visibility = "hidden";
    };

    private readonly _handleMaterialEdit = (
        document: IDocument,
        editingMaterial: Material,
        callback: (material: Material) => void,
    ) => {
        let context = new MaterialDataContent(document, callback, editingMaterial);
        this._viewportContainer.append(new MaterialEditor(context));
    };

    private cancelCutout() {
        this.finishCutout();
    }

    private clearFaceHighlight() {
        const view = getCurrentApplication()?.activeView;
        const highlighter = view?.document.visual.highlighter;
        if (!highlighter) return;

        const face = this._cutoutFace;
        if (face && face.owner && face.owner.node) {
            try { highlighter.removeState(face.owner, VisualState.edgeHighlight, face.shape.shapeType, ...face.indexes); } catch {}
            try { highlighter.removeState(face.owner, VisualState.edgeSelected, face.shape.shapeType, ...face.indexes); } catch {}
        }

        try { highlighter.clear(); } catch {}
    }

    private getWorldPlane(): Plane {
        const vs = this._cutoutFace!;
        return this._cutoutPlane!.transformed(vs.transform);
    }

    private clearPreview() {
        const view = getCurrentApplication()?.activeView;
        if (this._cutoutPreviewId !== undefined && view) {
            view.document.visual.context.removeMesh(this._cutoutPreviewId);
            this._cutoutPreviewId = undefined;
        }
    }

    private resetCutoutPanel() {
        if (!this._cutoutPanel) return;
        while (this._cutoutPanel.firstChild) this._cutoutPanel.removeChild(this._cutoutPanel.firstChild);
        this._cutoutPanel.append(button({ textContent: "Add", onclick: () => this.startCutoutFlow() }));
    }

    private finishCutout() {
        this.clearPreview();
        this.clearFaceHighlight();
        PubSub.default.pub("clearStatusBarTip");
        PubSub.default.pub("viewCursor", "default");
        this._cutoutFace = undefined;
        this._cutoutNode = undefined;
        this._cutoutPlane = undefined;
        this._cutoutActive = false;
        this.resetCutoutPanel();
    }

    registerRibbonCommand(tabName: I18nKeys, groupName: I18nKeys, command: CommandKeys | Button) {
        const tab = this.ribbonContent.ribbonTabs.find((p) => p.tabName === tabName);
        const group = tab?.groups.find((p) => p.groupName === groupName);
        group?.items.push(command);
    }
}

customElements.define("chili-editor", Editor);
