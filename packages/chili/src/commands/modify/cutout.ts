// See CHANGELOG.md for modifications (updated 2025-08-12)
import {
    I18n,
    I18nKeys,
    IFace,
    IShape,
    IElementarySurface,
    Plane,
    PubSub,
    Result,
    ShapeNode,
    ShapeType,
    Transaction,
    XYZ,
    command,
} from "chili-core";
import { form, div, label, input, select, option } from "chili-controls";
import { IStep, SelectShapeStep } from "../step";
import { MultistepCommand } from "../multistepCommand";
import { BooleanNode } from "../../bodys/boolean";

@command({
    key: "modify.cutout",
    icon: "icon-booleanCut",
})
export class CutoutCommand extends MultistepCommand {
    protected override getSteps(): IStep[] {
        return [
            new SelectShapeStep(ShapeType.Shape, "prompt.select.shape", {
                nodeFilter: { allow: (node) => node instanceof ShapeNode },
            }),
            new SelectShapeStep(ShapeType.Face, "prompt.select.shape", {
                nodeFilter: {
                    allow: (node) => {
                        if (!(node instanceof ShapeNode)) return false;
                        const first = this.stepDatas[0]?.nodes?.[0] as ShapeNode | undefined;
                        return !!first && node === first;
                    },
                },
            }),
        ];
    }

    protected override async executeMainTask() {
        const firstNode = this.stepDatas[0].nodes?.[0] as ShapeNode | undefined;
        const faceVs = this.stepDatas[1].shapes?.[0];
        if (!firstNode || !faceVs) return;

        const targetShape = this.transformdFirstShape(this.stepDatas[0]);
        const [faceShape] = this.transformdShapes(this.stepDatas[1]);
        const face = faceShape as IFace;

        const surf = face.surface() as IElementarySurface | undefined;
        const plane = surf?.coordinates as Plane | undefined;
        if (!plane) {
            PubSub.default.pub("showToast", "error.default:{0}", "Face not planar");
            return;
        }

        const formEl = form(
            {},
            div(
                {},
                label({ textContent: I18n.translate("cutout.type") }),
                select(
                    { id: "type" },
                    option({ value: "circle", textContent: I18n.translate("cutout.type.circle") }),
                    option({ value: "rect", textContent: I18n.translate("cutout.type.rect") }),
                ),
            ),
            div(
                {},
                label({ textContent: I18n.translate("cutout.centerX") }),
                input({ type: "number", id: "cx", value: "0", step: "0.1" }),
            ),
            div(
                {},
                label({ textContent: I18n.translate("cutout.centerY") }),
                input({ type: "number", id: "cy", value: "0", step: "0.1" }),
            ),
            div(
                { id: "row-radius" },
                label({ textContent: I18n.translate("cutout.radius") }),
                input({ type: "number", id: "radius", value: "10", min: "0", step: "0.1" }),
            ),
            div(
                { id: "row-width" },
                label({ textContent: I18n.translate("cutout.width") }),
                input({ type: "number", id: "width", value: "20", min: "0", step: "0.1" }),
            ),
            div(
                { id: "row-height" },
                label({ textContent: I18n.translate("cutout.height") }),
                input({ type: "number", id: "height", value: "20", min: "0", step: "0.1" }),
            ),
            div(
                {},
                label({ textContent: I18n.translate("cutout.depth") }),
                input({ type: "number", id: "depth", value: "10", min: "0", step: "0.1" }),
            ),
            div(
                {},
                label({ textContent: I18n.translate("cutout.through") }),
                input({ type: "checkbox", id: "through", checked: true }),
            ),
        );

        const typeSel = formEl.querySelector<HTMLSelectElement>("#type")!;
        const rowRadius = formEl.querySelector<HTMLDivElement>("#row-radius")!;
        const rowWidth = formEl.querySelector<HTMLDivElement>("#row-width")!;
        const rowHeight = formEl.querySelector<HTMLDivElement>("#row-height")!;
        const updateVisibility = () => {
            const t = typeSel.value;
            rowRadius.style.display = t === "circle" ? "" : "none";
            rowWidth.style.display = t === "rect" ? "" : "none";
            rowHeight.style.display = t === "rect" ? "" : "none";
        };
        typeSel.onchange = updateVisibility;
        updateVisibility();

        PubSub.default.pub(
            "showDialog",
            "cutout.title" as I18nKeys,
            formEl,
            (result) => {
                if (result !== 0) return;

                const t = typeSel.value;
                const cx = parseFloat((formEl.querySelector("#cx") as HTMLInputElement).value) || 0;
                const cy = parseFloat((formEl.querySelector("#cy") as HTMLInputElement).value) || 0;
                const r = parseFloat((formEl.querySelector("#radius") as HTMLInputElement).value) || 0;
                const w = parseFloat((formEl.querySelector("#width") as HTMLInputElement).value) || 0;
                const h = parseFloat((formEl.querySelector("#height") as HTMLInputElement).value) || 0;
                const d = parseFloat((formEl.querySelector("#depth") as HTMLInputElement).value) || 0;
                const through = (formEl.querySelector("#through") as HTMLInputElement).checked;

                Transaction.execute(this.document, "cutout", () => {
                    const sf = this.application.shapeFactory;
                    const n = plane.normal.normalize()!;
                    const o = plane.origin.add(plane.xvec.multiply(cx)).add(plane.yvec.multiply(cy));
                    const span = this.projectSpanAlong(firstNode, n);
                    const depth = through ? span + 2 : Math.max(0.1, d);

                    let tool: Result<IShape>;
                    if (t === "circle") {
                        const base = o.add(n.multiply(-depth * 0.5));
                        tool = sf.cylinder(n, base, Math.max(0.1, r), depth);
                    } else {
                        const origin = o
                            .add(plane.xvec.multiply(-Math.max(0.1, w) * 0.5))
                            .add(plane.yvec.multiply(-Math.max(0.1, h) * 0.5))
                            .add(n.multiply(-depth * 0.5));
                        tool = sf.box(new Plane(origin, n, plane.xvec), Math.max(0.1, w), Math.max(0.1, h), depth);
                    }
                    if (!tool.isOk) {
                        PubSub.default.pub("showToast", "error.default:{0}", "Cutout tool failed");
                        return;
                    }

                    const res = this.application.shapeFactory.booleanCut([targetShape], [tool.value]);
                    if (!res.isOk) {
                        PubSub.default.pub("showToast", "error.default:{0}", "Boolean cut failed");
                        return;
                    }

                    const node = new BooleanNode(this.document, res.value);
                    this.document.rootNode.add(node);
                    this.stepDatas.forEach((x) => {
                        x.nodes?.forEach((n) => n.parent?.remove(n));
                    });
                    this.document.visual.update();
                });
            },
        );
    }

    private projectSpanAlong(node: ShapeNode, dir: XYZ) {
        const bb = node.boundingBox();
        if (!bb) return 1000;
        const u = dir.normalize()!;
        const corners = [
            new XYZ(bb.min.x, bb.min.y, bb.min.z),
            new XYZ(bb.max.x, bb.min.y, bb.min.z),
            new XYZ(bb.min.x, bb.max.y, bb.min.z),
            new XYZ(bb.min.x, bb.min.y, bb.max.z),
            new XYZ(bb.max.x, bb.max.y, bb.min.z),
            new XYZ(bb.max.x, bb.min.y, bb.max.z),
            new XYZ(bb.min.x, bb.max.y, bb.max.z),
            new XYZ(bb.max.x, bb.max.y, bb.max.z),
        ];
        let min = Infinity, max = -Infinity;
        for (const c of corners) {
            const p = u.dot(c);
            if (p < min) min = p;
            if (p > max) max = p;
        }
        return max - min;
    }
}