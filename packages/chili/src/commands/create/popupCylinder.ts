// See CHANGELOG.md for modifications (updated 2025-08-08)
import { command, IApplication, Transaction, PubSub, DialogResult, I18nKeys, I18n } from "chili-core";
import { form, div, label, input } from "chili-controls";
import { CylinderNode } from "../../bodys";

@command({
    key: "create.popupcylinder",
    icon: "icon-cylinder",
})
export class PopupCylinderCommand {
    async execute(application: IApplication): Promise<void> {
        const formEl = form(
            {},
            div(
                {},
                label({ textContent: I18n.translate("popupcylinder.radius") }),
                input({ type: "number", id: "radius", value: "10", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupcylinder.height") }),
                input({ type: "number", id: "height", value: "20", min: "0", step: "0.1" })
            )
        );

        PubSub.default.pub(
            "showDialog",
            "dialog.title.createCylinder" as I18nKeys,
            formEl,
            (result: DialogResult) => {
                if (result !== DialogResult.ok) return;
                const r = parseFloat((formEl.querySelector("#radius") as HTMLInputElement).value);
                const h = parseFloat((formEl.querySelector("#height") as HTMLInputElement).value);
                if (isNaN(r) || isNaN(h)) return;
                const view = application.activeView!;
                const doc = view.document;
                const plane = view.workplane;
                Transaction.execute(doc, "create popup cylinder", () => {
                    const node = new CylinderNode(doc, plane.normal, plane.origin, r, h);
                    doc.addNode(node);
                    doc.visual.update();
                });
            }
        );
    }
}