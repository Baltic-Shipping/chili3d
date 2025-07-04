import { command, IApplication, Transaction } from "chili-core";
import { BooleanNode } from "../../bodys/boolean";

@command({
  key: "create.popuptube",
  icon: "icon-cylinder",
})
export class PopupTubeCommand {
  async execute(application: IApplication): Promise<void> {
    const outerR = parseFloat(prompt("Outer Radius", "10") || "0");
    const innerR = parseFloat(prompt("Inner Radius", "5")  || "0");
    const height = parseFloat(prompt("Height",       "20") || "0");
    if (
      isNaN(outerR) ||
      isNaN(innerR) ||
      isNaN(height) ||
      innerR >= outerR
    ) return;

    const view  = application.activeView!;
    const doc   = view.document;
    const plane = view.workplane;

    Transaction.execute(doc, "create popup tube", () => {
      const outerRes = application.shapeFactory.cylinder(
        plane.normal,
        plane.origin,
        outerR,
        height
      );
      const innerRes = application.shapeFactory.cylinder(
        plane.normal,
        plane.origin,
        innerR,
        height
      );
      if (!outerRes.isOk || !innerRes.isOk) return;

      const cutRes = application.shapeFactory.booleanCut(
        [outerRes.value],
        [innerRes.value]
      );
      if (!cutRes.isOk) return;

      const node = new BooleanNode(doc, cutRes.value);
      doc.addNode(node);
      doc.visual.update();
    });
  }
}
