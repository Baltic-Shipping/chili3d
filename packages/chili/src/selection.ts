// See CHANGELOG.md for modifications (updated 2025-08-11)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    AsyncController,
    CursorType,
    I18nKeys,
    IDisposable,
    IDocument,
    IEventHandler,
    INode,
    INodeFilter,
    ISelection,
    IShapeFilter,
    Logger,
    PubSub,
    Config,
    ShapeNode,
    ShapeType,
    VisualNode,
    VisualState,
} from "chili-core";
import { NodeSelectionHandler, SubshapeSelectionHandler } from "chili-vis";

export class Selection implements ISelection, IDisposable {
    private _selectedNodes: INode[] = [];
    private _unselectedNodes: INode[] = [];

    shapeType: ShapeType = ShapeType.Shape;
    shapeFilter?: IShapeFilter;
    nodeFilter?: INodeFilter;

    constructor(readonly document: IDocument) {}

    async pickShape(
        prompt: I18nKeys,
        controller: AsyncController,
        multiMode: boolean,
        selectedState: VisualState = VisualState.edgeSelected,
        highlightState: VisualState = VisualState.edgeHighlight,
    ) {
        const handler = new SubshapeSelectionHandler(
            this.document,
            this.shapeType,
            multiMode,
            controller,
            this.shapeFilter,
            this.nodeFilter,
        );
        handler.selectedState = selectedState;
        handler.highlightState = highlightState;
        await this.pickAsync(handler, prompt, controller, multiMode);
        return handler.shapes();
    }

    async pickNode(prompt: I18nKeys, controller: AsyncController, multiMode: boolean) {
        const handler = new NodeSelectionHandler(this.document, multiMode, controller, this.nodeFilter);
        await this.pickAsync(handler, prompt, controller, multiMode);
        return handler.nodes();
    }

    async pickAsync(
        handler: IEventHandler,
        prompt: I18nKeys,
        controller: AsyncController,
        showControl: boolean,
        cursor: CursorType = "select.default",
    ) {
        const oldHandler = this.document.visual.eventHandler;
        this.document.visual.eventHandler = handler;
        PubSub.default.pub("viewCursor", cursor);
        PubSub.default.pub("statusBarTip", prompt);

        const shouldShow = showControl && Config.instance.showSelectionConfirm;
        if (shouldShow) PubSub.default.pub("showSelectionControl", controller);

        let autoHandler: any;
        const shouldAuto = Config.instance.autoConfirmSelection && !shouldShow;
        if (shouldAuto) {
            autoHandler = (doc: IDocument, selected: INode[]) => {
                if (selected && selected.length > 0) {
                    PubSub.default.remove("selectionChanged", autoHandler);
                    controller.success();
                }
            };
            PubSub.default.sub("selectionChanged", autoHandler);
        }

        try {
            await new Promise((resolve, reject) => {
                controller.onCompleted(resolve);
                controller.onCancelled(reject);
            });
        } catch (e) {
            Logger.debug("pick status: ", e);
        } finally {
            if (autoHandler) PubSub.default.remove("selectionChanged", autoHandler);
            this.document.visual.eventHandler = oldHandler;
            PubSub.default.pub("viewCursor", "select.default");
            PubSub.default.pub("clearStatusBarTip");
            PubSub.default.pub("clearSelectionControl");
        }
    }

    dispose(): void {
        this._selectedNodes.length = 0;
        this._unselectedNodes.length = 0;
    }

    getSelectedNodes(): INode[] {
        return this._selectedNodes;
    }

    setSelection(nodes: INode[], toggle: boolean) {
        nodes = nodes.filter(this.shapeNodeFilter);
        if (toggle) {
            this.toggleSelectPublish(nodes, true);
        } else {
            this.removeSelectedPublish(this._selectedNodes, false);
            this.addSelectPublish(nodes, true);
        }
        return this._selectedNodes.length;
    }

    private readonly shapeNodeFilter = (x: INode) => {
        if (x instanceof ShapeNode) {
            let shape = x.shape.value;
            if (!shape || !this.shapeFilter) return true;
            return this.shapeFilter.allow(shape);
        }

        if (this.nodeFilter) {
            return this.nodeFilter.allow(x);
        }

        return true;
    };

    deselect(nodes: INode[]) {
        this.removeSelectedPublish(nodes, true);
    }

    clearSelection() {
        this.removeSelectedPublish(this._selectedNodes, true);
    }

    private updateSelection() {
        this.document.visual.update();
        PubSub.default.pub("selectionChanged", this.document, this._selectedNodes, this._unselectedNodes);
    }

    private toggleSelectPublish(nodes: INode[], publish: boolean) {
        const selected = nodes.filter((m) => this._selectedNodes.includes(m));
        const unSelected = nodes.filter((m) => !this._selectedNodes.includes(m));
        this.removeSelectedPublish(selected, false);
        this.addSelectPublish(unSelected, publish);
    }

    private addSelectPublish(nodes: INode[], publish: boolean) {
        nodes.forEach((m) => {
            if (m instanceof VisualNode) {
                const visual = this.document.visual.context.getVisual(m);
                if (visual)
                    this.document.visual.highlighter.addState(
                        visual,
                        VisualState.edgeSelected,
                        ShapeType.Shape,
                    );
            }
        });
        this._selectedNodes.push(...nodes);
        if (publish) this.updateSelection();
    }

    private removeSelectedPublish(nodes: INode[], publish: boolean) {
        for (const node of nodes) {
            if (node instanceof VisualNode) {
                let visual = this.document.visual.context.getVisual(node);
                if (visual)
                    this.document.visual.highlighter.removeState(
                        visual,
                        VisualState.edgeSelected,
                        ShapeType.Shape,
                    );
            }
        }
        this._selectedNodes = this._selectedNodes.filter((m) => !nodes.includes(m));
        this._unselectedNodes = nodes;
        if (publish) this.updateSelection();
    }
}
