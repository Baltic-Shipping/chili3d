// See CHANGELOG.md for modifications (updated 2025-08-08)
import { command, IApplication, Transaction, PubSub, DialogResult, I18nKeys, I18n } from "chili-core";
import { form, div, label, input } from "chili-controls";
import { RecSectionNode } from "../../bodys";

@command({
    key: "create.popupRecSection",
    icon: "icon-rhs-wire",
})
export class PopupRecSectionCommand {
    async execute(application: IApplication): Promise<void> {
        const formEl = form(
            {},
            div(
                {},
                label({ textContent: I18n.translate("popupRecSection.height") }),
                input({ type: "number", id: "height", value: "40", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupRecSection.width") }),
                input({ type: "number", id: "width", value: "20", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupRecSection.thickness") }),
                input({ type: "number", id: "thickness", value: "5", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupRecSection.length") }),
                input({ type: "number", id: "length", value: "1000", min: "0", step: "0.1" })
            )
        );

        PubSub.default.pub(
            "showDialog",
            "dialog.title.createRecSection" as I18nKeys,
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
                Transaction.execute(doc, "create rectangle tube", () => {
                    const innerW = w - 2 * t;
                    const innerH = h - 2 * t;
                    if (innerW <= 0 || innerH <= 0) return;
                    const outerRes = application.shapeFactory.box(plane, w, h, L);
                    if (!outerRes.isOk) return;
                    const innerPlane = plane.translateTo(plane.origin.add(plane.xvec.multiply(t)).add(plane.yvec.multiply(t)));
                    const innerRes = application.shapeFactory.box(innerPlane, innerW, innerH, L);
                    if (!innerRes.isOk) return;
                    const cutRes = application.shapeFactory.booleanCut(
                        [outerRes.value],
                        [innerRes.value]
                    );
                    if (!cutRes.isOk) return;
                    const node = new RecSectionNode(doc, plane, w, h, t, L);
                    doc.addNode(node);
                    doc.visual.update();
                });
            }
        );
    }
}