// See CHANGELOG.md for modifications (updated 2025-08-26)
import { div, form, input, label } from "chili-controls";
import { command, DialogResult, I18n, I18nKeys, IApplication, PubSub, Transaction } from "chili-core";
import { BoxNode } from "../../bodys/box";
import { fitViewAfterSpawn, placeNodeAvoidingOverlap } from "../../utils";

@command({
    key: "create.popupbox",
    icon: "icon-box",
})
export class PopupBoxCommand {
    async execute(application: IApplication): Promise<void> {
        const formEl = form(
            {},
            div(
                {},
                label({ textContent: I18n.translate("popupbox.width") }),
                input({ type: "number", id: "width", value: "10", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupbox.length") }),
                input({ type: "number", id: "length", value: "10", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupbox.height") }),
                input({ type: "number", id: "height", value: "10", min: "0", step: "0.1" })
            )
        );

        PubSub.default.pub(
            "showDialog",
            "dialog.title.createBox" as I18nKeys,
            formEl,
            (result: DialogResult) => {
                if (result !== DialogResult.ok) return;
                const w = parseFloat((formEl.querySelector("#width") as HTMLInputElement).value);
                const l = parseFloat((formEl.querySelector("#length") as HTMLInputElement).value);
                const h = parseFloat((formEl.querySelector("#height") as HTMLInputElement).value);
                if (isNaN(w) || isNaN(l) || isNaN(h)) return;
                const view = application.activeView!;
                const doc = view.document;
                const plane = view.workplane;
                Transaction.execute(doc, "create popup box", () => {
                    const node = new BoxNode(doc, plane, w, l, h);
                    doc.addNode(node);
                    placeNodeAvoidingOverlap(doc, node);
                    doc.visual.update();
                    fitViewAfterSpawn(application);
                });
            }
        );
    }
}