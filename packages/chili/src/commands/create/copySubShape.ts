// See CHANGELOG.md for modifications (updated 2025-08-26)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { command, Config, EditableShapeNode, PubSub, ShapeType, Transaction } from "chili-core";
import { SelectShapeStep } from "../../step/selectStep";
import { MultistepCommand } from "../multistepCommand";

@command({
    key: "create.copyShape",
    icon: "icon-subShape",
})
export class CopySubShapeCommand extends MultistepCommand {
    protected override executeMainTask() {
        Transaction.execute(this.document, `excute ${Object.getPrototypeOf(this).data.name}`, () => {
            this.stepDatas[0].shapes.forEach((x) => {
                const subShape = x.shape.clone();
                const model = new EditableShapeNode(
                    this.document,
                    ShapeType.stringValue(subShape.shapeType),
                    subShape,
                );

                const node = x.owner.node;
                model.transform = node.transform;
                node.parent!.insertAfter(node, model);
            });
            this.document.visual.update();
            PubSub.default.pub("showToast", "toast.success");
        });
    }

    protected override getSteps() {
        return [
            new SelectShapeStep(ShapeType.Edge | ShapeType.Face, "prompt.select.shape", { multiple: true }),
        ];
    }

    protected override async executeAsync(): Promise<void> {
        const prevShow = Config.instance.showSelectionConfirm;
        const prevAuto = Config.instance.autoConfirmSelection;
        try {
            Config.instance.showSelectionConfirm = true;
            Config.instance.autoConfirmSelection = false;
            await super.executeAsync();
        } finally {
            Config.instance.showSelectionConfirm = prevShow;
            Config.instance.autoConfirmSelection = prevAuto;
        }
    }
}
