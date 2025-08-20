// See CHANGELOG.md for modifications (updated 2025-08-20)
import { IApplication, ICommand, PubSub, command } from "chili-core";
import { setClipboard } from "../clipboard";

@command({ key: "edit.copy", icon: "icon-copy" })
export class Copy implements ICommand {
    async execute(app: IApplication): Promise<void> {
        const doc = app.activeView?.document;
        if (!doc) return;
        const nodes = doc.selection.getSelectedNodes();
        if (!nodes?.length) {
            PubSub.default.pub("showToast", "toast.select.noSelected");
            return;
        }
        setClipboard(nodes);
        PubSub.default.pub("showToast", "toast.success");
    }
}
