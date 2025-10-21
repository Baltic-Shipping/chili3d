// See CHANGELOG.md for modifications (updated 2025-10-21)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { I18n, IApplication, IDocument, Matrix4, PubSub, Transaction, VisualNode, XYZ } from "chili-core";

export async function importFiles(application: IApplication, files: File[] | FileList) {
    let document = application.activeView?.document ?? (await application.newDocument("Untitled"));
    PubSub.default.pub(
        "showPermanent",
        async () => {
            await Transaction.executeAsync(document, "import model", async () => {
                await document.application.dataExchange.import(document, files);
            });
            document.application.activeView?.cameraController.fitContent();
            await document.save();
        },
        "toast.excuting{0}",
        I18n.translate("command.file.import"),
    );
}

export function placeNodeAvoidingOverlap(document: IDocument, node: VisualNode) {
    const ctx = document.visual.context as any;
    const vis = ctx.getVisual(node);
    const bbox = vis?.boundingBox() || node.boundingBox();
    if (!bbox) return;
    const w = Math.max(1, bbox.max.x - bbox.min.x);
    const h = Math.max(1, bbox.max.y - bbox.min.y);
    const d = Math.max(1, bbox.max.z - bbox.min.z);
    const step = Math.max(w, h, d) * 1.1;
    function intersectsAt(dx: number, dy: number, dz: number): boolean {
        const testBox = {
            min: new XYZ(bbox.min.x + dx, bbox.min.y + dy, bbox.min.z + dz),
            max: new XYZ(bbox.max.x + dx, bbox.max.y + dy, bbox.max.z + dz),
        };
        const hits = ctx.boundingBoxIntersectFilter(testBox);
        return hits.some((v: any) => ctx.getNode(v) !== node);
    }
    if (!intersectsAt(0, 0, 0)) return;
    let dx = 0,
        dy = 0,
        leg = 0,
        run = 0,
        limit = 256;
    while (limit-- > 0) {
        switch (leg & 3) {
            case 0:
                dx += step;
                break;
            case 1:
                dy += step;
                break;
            case 2:
                dx -= step;
                break;
            default:
                dy -= step;
        }
        run++;
        if (run === (leg >> 1) + 1) {
            leg++;
            run = 0;
        }
        if (!intersectsAt(dx, dy, 0)) {
            node.transform = node.transform.multiply(Matrix4.fromTranslation(dx, dy, 0));
            return;
        }
    }
}

export function fitViewAfterSpawn(app: IApplication) {
    app.activeView?.cameraController.fitContent();
}
