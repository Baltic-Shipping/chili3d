import { command, IApplication, Transaction } from "chili-core";
import { BoxNode } from "../../bodys/box";

@command({
    key: "create.popupbox",
    icon: "icon-box",
})
export class PopupBoxCommand {
    async execute(application: IApplication): Promise<void> {
        const dx = parseFloat(prompt("Width", "10") || "0");
        const dy = parseFloat(prompt("Length", "10") || "0");
        const dz = parseFloat(prompt("Height", "10") || "0");
        if (isNaN(dx) || isNaN(dy) || isNaN(dz)) return;

        const view  = application.activeView!;
        const doc   = view.document;
        const plane = view.workplane;

        Transaction.execute(doc, "create popup box", () => {
            const node = new BoxNode(doc, plane, dx, dy, dz);
            doc.addNode(node);
            doc.visual.update();
        });
    }
}
