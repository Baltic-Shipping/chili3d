// See CHANGELOG.md for modifications (updated 2025-08-08)
import { command, IApplication, Transaction, PubSub, DialogResult, I18nKeys, I18n } from "chili-core";
import { form, div, label, input } from "chili-controls";
import { BooleanNode } from "../../bodys/boolean";

@command({
    key: "create.popupLSection",
    icon: "icon-lbeam-wire",
})
export class PopupLSectionCommand {
    async execute(application: IApplication): Promise<void> {
        const formEl = form(
            {},
            div(
                {},
                label({ textContent: I18n.translate("popupLSection.width") }),
                input({ type: "number", id: "width", value: "20", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupLSection.widthTwo") }),
                input({ type: "number", id: "widthTwo", value: "20", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupLSection.thickness") }),
                input({ type: "number", id: "thickness", value: "1.5", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupLSection.length") }),
                input({ type: "number", id: "length", value: "1000", min: "0", step: "0.1" })
            ),
        );

        PubSub.default.pub(
            "showDialog",
            "dialog.title.createLSection" as I18nKeys,
            formEl,
            (result: DialogResult) => {
                if (result !== DialogResult.ok) return;
                const w = parseFloat((formEl.querySelector("#width") as HTMLInputElement).value);
                const w2 = parseFloat((formEl.querySelector("#widthTwo") as HTMLInputElement).value);
                const t = parseFloat((formEl.querySelector("#thickness") as HTMLInputElement).value);
                const L = parseFloat((formEl.querySelector("#length") as HTMLInputElement).value);
                if ([w,w2,t,L].some(isNaN) || t > Math.min(w, w2)) return;
                const view = application.activeView!;
                const doc = view.document;
                const plane = view.workplane;
                Transaction.execute(doc, "create L section", () => {
                    const horz = application.shapeFactory.box(
                        plane,
                        w,
                        t,
                        L
                    );
                    const vert = application.shapeFactory.box(
                        plane,
                        t,
                        w2,
                        L
                    );
                    if (!horz.isOk || !vert.isOk) return;
                    const fuseRes = application.shapeFactory.booleanFuse(
                        [horz.value],
                        [vert.value]
                    )
                    if (!fuseRes.isOk) return;

                    const node = new BooleanNode(doc, fuseRes.value);
                    doc.addNode(node);
                    doc.visual.update();
                });
            }
        );
    }
}