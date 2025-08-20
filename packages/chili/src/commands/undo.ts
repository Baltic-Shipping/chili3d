// See CHANGELOG.md for modifications (updated 2025-08-20)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IApplication, ICommand, INode, command } from "chili-core";

@command({
    key: "edit.undo",
    icon: "icon-undo",
})
export class Undo implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const document = application.activeView?.document;
        if (!document) return;

        document.history.undo();

        const ctx = document.visual.context;
        const orphans: INode[] = [];
        ctx.visuals().forEach((v) => {
            const n = ctx.getNode(v);
            if (!n || !n.parent) orphans.push(n as INode);
        });
        if (orphans.length) ctx.removeNode(orphans);

        document.visual.update();
    }
}
