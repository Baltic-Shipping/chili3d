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
                label({ textContent: I18n.translate("popupTeeSection.width") }),
                input({ type: "number", id: "width", value: "20", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupTeeSection.height") }),
                input({ type: "number", id: "height", value: "20", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupTeeSection.thickness") }),
                input({ type: "number", id: "thickness", value: "1.5", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupTeeSection.length") }),
                input({ type: "number", id: "length", value: "1000", min: "0", step: "0.1" })
            ),
        );

        PubSub.default.pub(
            "showDialog",
            "dialog.title.createTeeSection" as I18nKeys,
            formEl,
            (result: DialogResult) => {
                if (result !== DialogResult.ok) return;
                const w = parseFloat((formEl.querySelector("#width") as HTMLInputElement).value);
                const h = parseFloat((formEl.querySelector("#height") as HTMLInputElement).value);
                const t = parseFloat((formEl.querySelector("#thickness") as HTMLInputElement).value);
                const L = parseFloat((formEl.querySelector("#length") as HTMLInputElement).value);
                if ([w,h,t,L].some(isNaN) || t > Math.min(w, h)) return;
                const view = application.activeView!;
                const doc = view.document;
                const plane = view.workplane;
                Transaction.execute(doc, "create tee section", () => {
                    const halfWebHeight = (h - t) / 2;
                    const halfFlangeThick = t / 2;
                    const halfWidthOffset = (w - t) / 2;
                    const flangeOffset = plane.origin.add(plane.xvec.multiply(-halfWidthOffset)).add(plane.yvec.multiply(halfWebHeight + halfFlangeThick));
                    const flangePlane = plane.translateTo(flangeOffset);
                    const webOffset = plane.origin.add(plane.xvec.multiply(halfWidthOffset)).add(plane.yvec.multiply(-halfFlangeThick));
                    const webPlane = plane.translateTo(webOffset);
                    const flangeRes = application.shapeFactory.box(
                        flangePlane,
                        w,
                        t,
                        L,
                    );
                    const webRes = application.shapeFactory.box(
                        webPlane,
                        t,
                        h - t,
                        L
                    );
                    if (!flangeRes.isOk || !webRes.isOk) return;
                    const fuseRes = application.shapeFactory.booleanFuse(
                        [flangeRes.value],
                        [webRes.value]
                    );
                    if (!fuseRes.isOk) return;
                    
                    const node = new BooleanNode(doc, fuseRes.value);
                    doc.addNode(node);
                    doc.visual.update();
                });
            }
        );
    }
}