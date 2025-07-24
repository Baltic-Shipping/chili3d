// See CHANGELOG.md for modifications (updated 2025-07-23)
import { command, IApplication, Transaction } from "chili-core";
import { BooleanNode } from "../../bodys/boolean";

@command({
    key: "create.popupcylinder",
    icon: "icon-cylinder",
})
export class PopupCylinderCommand {
    async execute(application: IApplication): Promise<void> {
        const radius = parseFloat(prompt("Radius", "10") || "0");
        const height = parseFloat(prompt("Height", "20") || "0");
        if (isNaN(radius) || isNaN(height)) return;

        const view  = application.activeView!;
        const doc   = view.document;
        const plane = view.workplane;

        Transaction.execute(doc, "create popup cylinder", () => {
            const cylinderRes = application.shapeFactory.cylinder(
                plane.normal,
                plane.origin,
                radius,
                height
            );
            if (!cylinderRes.isOk) return;

            const node = new BooleanNode(doc, cylinderRes.value);
            doc.addNode(node);
            doc.visual.update();
        });
    }
}