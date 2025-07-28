// See CHANGELOG.md for modifications (updated 2025-07-28)
import { command, IApplication, Transaction, PubSub, DialogResult, I18nKeys, I18n } from "chili-core";
import { form, div, label, input } from "chili-controls";
import { BooleanNode } from "../../bodys/boolean";

@command({
    key: "create.popupUSection",
    icon: "icon-cylinder",
})
export class PopupUSectionCommand {
    async execute(application: IApplication): Promise<void> {
        const formEl = form(
            {},
            div(
                {},
                label({ textContent: I18n.translate("popupUSection.height") }),
                input({ type: "number", id: "height", value: "40", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupUSection.width") }),
                input({ type: "number", id: "width", value: "20", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupUSection.thickness") }),
                input({ type: "number", id: "thickness", value: "5", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupUSection.length") }),
                input({ type: "number", id: "length", value: "1000", min: "0", step: "0.1" })
            )
        );

        PubSub.default.pub(
            "showDialog",
            "dialog.title.createUSection" as I18nKeys,
            formEl,
            (result: DialogResult) => {
                if (result !== DialogResult.ok) return;
                const h = parseFloat((formEl.querySelector("#height") as HTMLInputElement).value);
                const w = parseFloat((formEl.querySelector("#width") as HTMLInputElement).value);
                const t = parseFloat((formEl.querySelector("#thickness") as HTMLInputElement).value);
                const L = parseFloat((formEl.querySelector("#length") as HTMLInputElement).value);
                if ([h,w,t,L].some(isNaN)) return;
                const view = application.activeView!;
                const doc = view.document;
                const plane = view.workplane;
                Transaction.execute(doc, "create U section", () => {
                    const webPlane = plane.translateTo(plane.origin.add(plane.yvec.multiply(t)));
                    const webRes = application.shapeFactory.box(webPlane, t, h - 2 * t, L);
                    if (!webRes.isOk) return;
                    const botRes = application.shapeFactory.box(plane, w, t, L);
                    if (!botRes.isOk) return;
                    const topPlane = plane.translateTo(plane.origin.add(plane.yvec.multiply(h - t)));
                    const topRes = application.shapeFactory.box(topPlane, w, t, L);
                    if (!topRes.isOk) return;
                    const fuse1 = application.shapeFactory.booleanFuse(
                        [botRes.value],
                        [webRes.value]
                    );
                    if (!fuse1.isOk) return;
                    const fuse2 = application.shapeFactory.booleanFuse(
                        [fuse1.value],
                        [topRes.value]
                    );
                    if (!fuse2.isOk) return;

                    const node = new BooleanNode(doc, fuse2.value);
                    doc.addNode(node);
                    doc.visual.update();
                });
            }
        );
    }
}