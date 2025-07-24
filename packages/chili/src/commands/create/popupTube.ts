// See CHANGELOG.md for modifications (updated 2025-07-24)
import { command, IApplication, Transaction, PubSub, DialogResult, I18nKeys, I18n } from "chili-core";
import { form, div, label, input } from "chili-controls";
import { BooleanNode } from "../../bodys/boolean";

@command({
    key: "create.popuptube",
    icon: "icon-cylinder",
})
export class PopupTubeCommand {
    async execute(application: IApplication): Promise<void> {
        const formEl = form(
            {},
            div(
                {},
                label({ textContent: I18n.translate("popuptube.outerRadius") }),
                input({ type: "number", id: "outerRadius", value: "10", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popuptube.innerRadius") }),
                input({ type: "number", id: "innerRadius", value: "5", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popuptube.height") }),
                input({ type: "number", id: "height", value: "20", min: "0", step: "0.1" })
            ),
        );

        PubSub.default.pub(
            "showDialog",
            "dialog.title.createTube" as I18nKeys,
            formEl,
            (result: DialogResult) => {
                if (result !== DialogResult.ok) return;
                const outerR = parseFloat((formEl.querySelector("#outerRadius") as HTMLInputElement).value);
                const innerR = parseFloat((formEl.querySelector("#innerRadius") as HTMLInputElement).value);
                const h = parseFloat((formEl.querySelector("#height") as HTMLInputElement).value);
                if (isNaN(outerR) || isNaN(innerR) || isNaN(h) || innerR >= outerR) return;
                const view = application.activeView!;
                const doc = view.document;
                const plane = view.workplane;
                Transaction.execute(doc, "create popup tube", () => {
                    const outerRes = application.shapeFactory.cylinder(
                        plane.normal,
                        plane.origin,
                        outerR,
                        h
                    );
                    const innerRes = application.shapeFactory.cylinder(
                        plane.normal,
                        plane.origin,
                        innerR,
                        h
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
        );
    }
}