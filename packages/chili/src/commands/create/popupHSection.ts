// See CHANGELOG.md for modifications (updated 2025-08-08)
import { command, IApplication, Transaction, PubSub, DialogResult, I18nKeys, I18n } from "chili-core";
import { form, div, label, input } from "chili-controls";
import { HSectionNode } from "../../bodys";

@command({
    key: "create.popupHSection",
    icon: "icon-hbeam-wire",
})
export class PopupHSectionCommand {
    async execute(application: IApplication): Promise<void> {
        const formEl = form(
            {},
            div(
                {},
                label({ textContent: I18n.translate("popupHSection.width") }),
                input({ type: "number", id: "width", value: "100", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupHSection.height") }),
                input({ type: "number", id: "height", value: "50", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupHSection.flangeThickness") }),
                input({ type: "number", id: "flangeT", value: "10", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupHSection.webThickness") }),
                input({ type: "number", id: "webT", value: "6", min: "0", step: "0.1" })
            ),
            div(
                {},
                label({ textContent: I18n.translate("popupHSection.length") }),
                input({ type: "number", id: "length", value: "1000", min: "0", step: "0.1" })
            )
        );

        PubSub.default.pub(
            "showDialog",
            "dialog.title.createHSection" as I18nKeys,
            formEl,
            (result: DialogResult) => {
                if (result !== DialogResult.ok) return;
                const w = parseFloat((formEl.querySelector("#width") as HTMLInputElement).value);
                const h = parseFloat((formEl.querySelector("#height") as HTMLInputElement).value);
                const flangeT = parseFloat((formEl.querySelector("#flangeT") as HTMLInputElement).value);
                const webT = parseFloat((formEl.querySelector("#webT") as HTMLInputElement).value);
                const L = parseFloat((formEl.querySelector("#length") as HTMLInputElement).value);
                if ([w,h,flangeT, webT, L].some(isNaN) || flangeT*2 >= h || webT > w ) return;
                const view = application.activeView!;
                const doc = view.document;
                const plane = view.workplane;
                Transaction.execute(doc, "create H section", () => {
                    const webH = h - 2 * flangeT;
                    const midOffset = (w - webT) / 2;
                    const topPlane = plane.translateTo(plane.origin.add(plane.yvec.multiply(webH + flangeT)));
                    const bottomPlane = plane;
                    const webPlane = plane.translateTo(plane.origin.add(plane.xvec.multiply(midOffset)).add(plane.yvec.multiply(flangeT)));

                    const topRes = application.shapeFactory.box(topPlane, w, flangeT, L);
                    const botRes = application.shapeFactory.box(bottomPlane, w, flangeT, L);
                    const webRes = application.shapeFactory.box(webPlane, webT, webH, L);
                    if (!topRes.isOk || !botRes.isOk || !webRes.isOk) return;

                    const fuse1 = application.shapeFactory.booleanFuse(
                        [topRes.value, botRes.value],
                        [webRes.value]
                    );
                    if (!fuse1.isOk) return;

                    const node = new HSectionNode(doc, plane, w, h, flangeT, webT, L);
                    doc.addNode(node);
                    doc.visual.update();
                });
            }
        );
    }
}