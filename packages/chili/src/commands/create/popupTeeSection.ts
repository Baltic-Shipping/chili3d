// See CHANGELOG.md for modifications (updated 2025-07-25)
import { command, IApplication, Transaction, PubSub, DialogResult, I18nKeys, I18n } from "chili-core";
import { form, div, label, input } from "chili-controls";
import { BooleanNode } from "../../bodys/boolean";

@command({
    key: "create.popupTeeSection",
    icon: "icon-cylinder",
})
export class PopupTeeSectionCommand {
    async execute(application: IApplication): Promise<void> {
        const formEl = form(
            {},
            div(
                {},
                label({ textContent: I18n.translate("popupTeeSection.flange") }),
                input({ type: "number", id: "flange", value: "100", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupTeeSection.flangeThickness") }),
                input({ type: "number", id: "flangeThickness", value: "10", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupTeeSection.web") }),
                input({ type: "number", id: "web", value: "100", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupTeeSection.webThickness") }),
                input({ type: "number", id: "webThickness", value: "10", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupTeeSection.depth") }),
                input({ type: "number", id: "depth", value: "10", min: "0", step: "0.1" })
            )
        );

        PubSub.default.pub(
            "showDialog",
            "dialog.title.createTeeSection" as I18nKeys,
            formEl,
            (result: DialogResult) => {
                if (result !== DialogResult.ok) return;
                const flangeW = parseFloat((formEl.querySelector("#flange") as HTMLInputElement).value);
                const flangeT = parseFloat((formEl.querySelector("#flangeThickness") as HTMLInputElement).value);
                const webH = parseFloat((formEl.querySelector("#web") as HTMLInputElement).value);
                const webT = parseFloat((formEl.querySelector("#webThickness") as HTMLInputElement).value);
                const depth = parseFloat((formEl.querySelector("#depth") as HTMLInputElement).value);
                if ([flangeW, flangeT, webH, webT, depth].some(isNaN)) return;
                const view = application.activeView!;
                const doc = view.document;
                const plane = view.workplane;
                Transaction.execute(doc, "create tee section", () => {
                    const flangeRes = application.shapeFactory.box(
                        plane,
                        flangeW,
                        webT,
                        depth
                    );
                    const webRes = application.shapeFactory.box(
                        plane,
                        webT,
                        webH,
                        depth
                    );

                    if (!flangeRes.isOk || !webRes.isOk) return;

                    const unionRes = application.shapeFactory.booleanFuse(
                        [flangeRes.value],
                        [webRes.value]
                    );
                    if (!unionRes.isOk) return;
                    
                    const node = new BooleanNode(doc, unionRes.value);
                    doc.addNode(node);
                    doc.visual.update();
                });
            }
        );
    }
}