// See CHANGELOG.md for modifications (updated 2025-09-30)
import {
    IApplication,
    ICommand,
    INode,
    Id,
    Matrix4,
    Serialized,
    Serializer,
    Transaction,
    command,
} from "chili-core";
import { getClipboard, hasClipboard } from "../clipboard";

function regenIds(data: Serialized): Serialized {
    const stack: any[] = [data];
    while (stack.length) {
        const cur = stack.pop();
        if (!cur || typeof cur !== "object") continue;
        if (cur.properties && typeof cur.properties === "object") {
            if (typeof cur.properties["id"] === "string") {
                cur.properties["id"] = Id.generate();
            }
            Object.values(cur.properties).forEach((v) => {
                if (v && typeof v === "object") stack.push(v);
            });
        }
    }
    return data;
}

@command({ key: "edit.paste", icon: "icon-paste" })
export class Paste implements ICommand {
    private static count = 0;

    async execute(app: IApplication): Promise<void> {
        const view = app.activeView;
        if (!view || !hasClipboard()) return;

        const doc = view.document;
        const clip = getClipboard();
        if (!clip) return;

        const idx = ++Paste.count;
        const base = clip.widthX > 0 ? clip.widthX : 200;
        const step = Math.max(base + Math.max(base * 0.1, 200), 200);
        const dx = step * idx;

        Transaction.execute(doc, "paste", () => {
            const created: INode[] = [];
            clip.items.forEach((it) => {
                const cloned = regenIds(JSON.parse(JSON.stringify(it)) as Serialized);
                const node = Serializer.deserializeObject(doc, cloned) as INode;
                const anyNode = node as any;
                if (anyNode.transform instanceof Matrix4) {
                    anyNode.transform = anyNode.transform.multiply(Matrix4.fromTranslation(dx, 0, 0));
                }
                doc.addNode(node);
                created.push(node);
            });
            doc.selection.setSelection(created, false);
        });

        doc.visual.update();
    }
}
