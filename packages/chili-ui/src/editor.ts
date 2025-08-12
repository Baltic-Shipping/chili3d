// See CHANGELOG.md for modifications (updated 2025-08-12)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, Expander, button, label, input, select, option, span } from "chili-controls";
import { RibbonButton } from "./ribbon/ribbonButton";
import {
    AsyncController,
    Button,
    CommandKeys,
    ButtonSize,
    I18nKeys,
    IApplication,
    IDocument,
    INode,
    IView,
    GeometryNode,
    Property,
    Material,
    ShapeNode,
    ShapeType,
    IFace,
    IElementarySurface,
    Plane,
    XYZ,
    PubSub,
    RibbonTab,
    VisualShapeData,
    getCurrentApplication,
    Transaction,
    VisualState,
    Orientation
} from "chili-core";
import { BooleanNode } from "../../chili/src/bodys/boolean";
import style from "./editor.module.css";
import { OKCancel } from "./okCancel";
import { ProjectView } from "./project";
import { PropertyView } from "./property";
import { MaterialDataContent, MaterialEditor } from "./property/material";
import { MaterialProperty } from "./property/materialProperty";
import { Ribbon, RibbonDataContent } from "./ribbon";
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
    private _applyBtn?: HTMLButtonElement;

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

    private buildCutoutUI() {
        if (!this._cutoutPanel) return;
        while (this._cutoutPanel.firstChild) this._cutoutPanel.removeChild(this._cutoutPanel.firstChild);

        const typeSel = select(
            { id: "cut-type" },
            option({ value: "circle", textContent: "Circle" }),
            option({ value: "rect", textContent: "Rectangle" }),
        );

        const cx = input({ id: "cut-cx", type: "number", value: "0", step: "0.1" });
        const cy = input({ id: "cut-cy", type: "number", value: "0", step: "0.1" });

        const radRow = div({ id: "row-radius" },
            label({ textContent: "Radius" }),
            input({ id: "cut-radius", type: "number", value: "10", min: "0", step: "0.1" }),
        );
        const wRow = div({ id: "row-width" },
            label({ textContent: "Width" }),
            input({ id: "cut-width", type: "number", value: "20", min: "0", step: "0.1" }),
        );
        const hRow = div({ id: "row-height" },
            label({ textContent: "Height" }),
            input({ id: "cut-height", type: "number", value: "20", min: "0", step: "0.1" }),
        );

        const depth = input({ id: "cut-depth", type: "number", value: "10", min: "0", step: "0.1" });
        const through = input({ id: "cut-through", type: "checkbox", checked: true });

        this._applyBtn = button({ textContent: "Apply", onclick: () => this.applyCutout() });
        const cancelBtn = button({ textContent: "Cancel", onclick: () => this.cancelCutout() });

        const onChange = () => {
            const t = (typeSel as HTMLSelectElement).value;
            (radRow as HTMLElement).style.display = t === "circle" ? "" : "none";
            (wRow as HTMLElement).style.display = t === "rect" ? "" : "none";
            (hRow as HTMLElement).style.display = t === "rect" ? "" : "none";
            this.updateCutoutPreview();
        };

        typeSel.onchange = onChange;
        (cx as HTMLInputElement).oninput = onChange;
        (cy as HTMLInputElement).oninput = onChange;
        (radRow.querySelector("#cut-radius") as HTMLInputElement).oninput = onChange;
        (wRow.querySelector("#cut-width") as HTMLInputElement).oninput = onChange;
        (hRow.querySelector("#cut-height") as HTMLInputElement).oninput = onChange;
        (depth as HTMLInputElement).oninput = onChange;
        (through as HTMLInputElement).onchange = onChange;

        this._cutoutPanel.append(
            div({}, label({ textContent: "Type" }), typeSel),
            div({}, label({ textContent: "Center X" }), cx),
            div({}, label({ textContent: "Center Y" }), cy),
            radRow,
            wRow,
            hRow,
            div({}, label({ textContent: "Depth" }), depth),
            div({}, label({ textContent: "Through" }), through),
            div({}, this._applyBtn, cancelBtn),
        );

        onChange();
    }

    private updateCutoutPreview() {
        const app = getCurrentApplication();
        const view = app?.activeView;
        if (!view || !this._cutoutPlane || !this._cutoutPanel) return;

        if (this._cutoutPreviewId !== undefined) {
            view.document.visual.context.removeMesh(this._cutoutPreviewId);
            this._cutoutPreviewId = undefined;
        }

        const plane = this._cutoutPlane;
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
        if (this._applyBtn) this._applyBtn.disabled = true;

        const app = getCurrentApplication();
        const view = app?.activeView;
        if (!view) { if (this._applyBtn) this._applyBtn.disabled = false; return; }

        const node = this._cutoutNode;
        const plane = this._cutoutPlane;
        const sf = app.shapeFactory;

        const cx = parseFloat(this._cutoutPanel.querySelector<HTMLInputElement>("#cut-cx")!.value) || 0;
        const cy = parseFloat(this._cutoutPanel.querySelector<HTMLInputElement>("#cut-cy")!.value) || 0;
        const center = plane.origin.add(plane.xvec.multiply(cx)).add(plane.yvec.multiply(cy));

        const through = this._cutoutPanel.querySelector<HTMLInputElement>("#cut-through")!.checked;
        const depthIn = parseFloat(this._cutoutPanel.querySelector<HTMLInputElement>("#cut-depth")!.value) || 0;

        const bb = node.boundingBox();
        if (!bb) { if (this._applyBtn) this._applyBtn.disabled = false; return; }

        const faceShape = this._cutoutFace!.shape as IFace;
        const surf = faceShape.surface() as IElementarySurface;
        const facePlane = surf.coordinates as Plane;

        const faceOutwardRaw = faceShape.orientation() === Orientation.REVERSED
        ? facePlane.normal.multiply(-1)
        : facePlane.normal;

        const faceOutwardUnit = faceOutwardRaw.normalize();
        if (!faceOutwardUnit) { if (this._applyBtn) this._applyBtn.disabled = false; return; }

        const inward = faceOutwardUnit.multiply(-1);
        const eps = 0.5;
        const span = this.projectSpanAlong(node, faceOutwardUnit);
        const height = through ? span + 2 * eps : Math.max(0.1, depthIn);

        const t = this._cutoutPanel.querySelector<HTMLSelectElement>("#cut-type")!.value;
        let toolRes;

        if (t === "circle") {
            const r = Math.max(0.1, parseFloat(this._cutoutPanel.querySelector<HTMLInputElement>("#cut-radius")!.value) || 0);
            const base = center.add(inward.multiply(eps));
            toolRes = sf.cylinder(inward, base, r, height);
        } else {
            const w = Math.max(0.1, parseFloat(this._cutoutPanel.querySelector<HTMLInputElement>("#cut-width")!.value) || 0);
            const h = Math.max(0.1, parseFloat(this._cutoutPanel.querySelector<HTMLInputElement>("#cut-height")!.value) || 0);
            const origin = center
                .add(facePlane.xvec.multiply(-w * 0.5))
                .add(facePlane.yvec.multiply(-h * 0.5))
                .add(inward.multiply(eps));
            toolRes = sf.box(new Plane(origin, inward, facePlane.xvec), w, h, height);
        }
        if (!toolRes.isOk) { if (this._applyBtn) this._applyBtn.disabled = false; return; }

        const baseShape = node.shape.value;
        const cutRes = sf.booleanCut([baseShape], [toolRes.value]);
        toolRes.value.dispose?.();
        if (!cutRes.isOk) { if (this._applyBtn) this._applyBtn.disabled = false; return; }

        Transaction.execute(view.document, "cutout", () => {
            const newNode = new BooleanNode(view.document, cutRes.value);
            node.parent?.remove(node);
            view.document.addNode(newNode);
        });

        this.finishCutout();
        view.document.visual.update();
    }

    private clearCutoutUI() {
        const view = getCurrentApplication()?.activeView;
        if (this._cutoutPreviewId !== undefined && view) {
            view.document.visual.context.removeMesh(this._cutoutPreviewId);
            this._cutoutPreviewId = undefined;
        }
        this.clearFaceHighlight();
        this._cutoutFace = undefined;
        this._cutoutNode = undefined;
        this._cutoutPlane = undefined;

        if (this._cutoutPanel) {
            while (this._cutoutPanel.firstChild) this._cutoutPanel.removeChild(this._cutoutPanel.firstChild);
            const addBtn = button({ textContent: "Add", onclick: () => this.startCutoutFlow() });
            this._cutoutPanel.append(addBtn);
        }
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
        const face = this._cutoutFace;
        if (!face) return;
        const doc = face.owner.node.document;
        try { doc.visual.highlighter.removeState(face.owner, VisualState.edgeHighlight, face.shape.shapeType, ...face.indexes); } catch {}
        try { doc.visual.highlighter.removeState(face.owner, VisualState.edgeSelected, face.shape.shapeType, ...face.indexes); } catch {}
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
        this._applyBtn = undefined;
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
