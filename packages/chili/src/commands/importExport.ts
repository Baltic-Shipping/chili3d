// See CHANGELOG.md for modifications (updated 2025-08-25)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    CancelableCommand,
    Combobox,
    command,
    download,
    I18n,
    IApplication,
    ICommand,
    Property,
    PubSub,
    readFilesAsync,
    VisualNode
} from "chili-core";
import { importFiles } from "../utils";

@command({
    key: "file.import",
    icon: "icon-import",
})
export class Import implements ICommand {
    async execute(application: IApplication): Promise<void> {
        const extenstions = application.dataExchange.importFormats().join(",");
        const files = await readFilesAsync(extenstions, true);
        if (!files.isOk || files.value.length === 0) {
            alert(files.error);
            return;
        }
        importFiles(application, files.value);
    }
}

@command({
    key: "file.export",
    icon: "icon-export",
})
export class Export extends CancelableCommand {
    @Property.define("file.format")
    public get formats() {
        return this.getPrivateValue("formats", this.initCombobox());
    }
    public set formats(value: Combobox<string>) {
        this.setProperty("formats", value);
    }

    private initCombobox() {
        const box = new Combobox<string>();
        box.items.push(...this.application.dataExchange.exportFormats());
        return box;
    }

    protected async executeAsync() {
        const nodes = await this.selectNodesAsync();
        const format = this.formats.selectedItem ?? this.application.dataExchange.exportFormats()[0];
        PubSub.default.pub(
            "showPermanent",
            async () => {
                await new Promise(requestAnimationFrame);
                await new Promise(r => setTimeout(r, 0));
                const data = await this.application.dataExchange.export(format, nodes);
                if (!data) return;

                let suffix = format;

                if (suffix == ".stl binary") {
                    suffix = ".stl";
                } else if (suffix == ".ply binary") {
                    suffix = ".ply";
                }

                PubSub.default.pub("showToast", "toast.downloading");
                download(data, `${nodes[0].name}${suffix}`);
            },
            "toast.excuting{0}",
            I18n.translate("command.file.export"),
        );
    }

    private async selectNodesAsync(): Promise<VisualNode[]> {
        const doc = this.application.activeView?.document;
        if (!doc) return [];
        const sel = doc.selection.getSelectedNodes().filter(n => n instanceof VisualNode) as VisualNode[];
        if (sel.length) return sel;

        const result: VisualNode[] = [];
        const stack: any[] = [doc.rootNode];
        while (stack.length) {
            const n = stack.pop();
            if (!n) continue;
            if (n instanceof VisualNode) result.push(n as VisualNode);
            let c = (n as any).firstChild as any;
            while (c) { stack.push(c); c = c.nextSibling as any; }
        }
        return result;
    }
}
