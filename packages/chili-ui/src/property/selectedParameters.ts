// See CHANGELOG.md for modifications (updated 2025-08-19)
import { div, Expander } from "chili-controls";
import { EditableShapeNode, IDocument, INode, IView, ParameterShapeNode, Property, PubSub, VisualNode } from "chili-core";
import style from "./propertyView.module.css";
import { findPropertyControl } from "./utils";

export class SelectedParameters extends HTMLElement {
    private readonly panel = div({ className: style.panel });

    constructor() {
        super();
        this.append(this.panel);
        PubSub.default.sub("showProperties", this.handleShowProperties);
        PubSub.default.sub("activeViewChanged", this.handleActiveViewChanged);
    }

    private readonly handleActiveViewChanged = (view: IView | undefined) => {
        if (view) {
            const nodes = view.document.selection.getSelectedNodes();
            this.handleShowProperties(view.document, nodes);
        } else {
            this.clear();
        }
    };

    private readonly handleShowProperties = (document: IDocument, nodes: INode[]) => {
        this.clear();
        if (nodes.length !== 1) return;
        const n = nodes[0];
        if (!(n instanceof VisualNode)) return;
        if (!(n instanceof ParameterShapeNode) && !(n instanceof EditableShapeNode)) return;
        const exp = new Expander(n.display());
        exp.contenxtPanel.append(
            ...Property.getOwnProperties(Object.getPrototypeOf(n)).map(p => findPropertyControl(document, [n], p)),
        );
        this.panel.append(exp);
    };

    private clear() {
        while (this.panel.lastElementChild) this.panel.removeChild(this.panel.lastElementChild);
    }
}

customElements.define("chili-selected-parameters", SelectedParameters);
