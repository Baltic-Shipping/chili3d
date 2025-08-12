// See CHANGELOG.md for modifications (updated 2025-08-12)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { div, Expander } from "chili-controls";
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
    PubSub,
    RibbonTab,
} from "chili-core";
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
        const cutoutPanel = cutoutExpander.contenxtPanel;
        const cutoutBtn = RibbonButton.fromCommandName("modify.cutout", ButtonSize.large);
        if (cutoutBtn) {
            cutoutBtn.querySelectorAll("span, label").forEach(el => el.remove());
            cutoutPanel.append(cutoutBtn);
        }
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

    registerRibbonCommand(tabName: I18nKeys, groupName: I18nKeys, command: CommandKeys | Button) {
        const tab = this.ribbonContent.ribbonTabs.find((p) => p.tabName === tabName);
        const group = tab?.groups.find((p) => p.groupName === groupName);
        group?.items.push(command);
    }
}

customElements.define("chili-editor", Editor);
