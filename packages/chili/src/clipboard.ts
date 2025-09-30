// See CHANGELOG.md for modifications (updated 2025-08-20)
import { INode, Serialized, Serializer } from "chili-core";

export type ClipboardData = { items: Serialized[]; widthX: number };

let clip: ClipboardData | null = null;

function groupWidthX(nodes: INode[]): number {
    let min = Infinity,
        max = -Infinity,
        found = false;
    nodes.forEach((n) => {
        const bb = (n as any).boundingBox?.();
        if (!bb) return;
        const minx = bb.min?.x ?? bb.minX;
        const maxx = bb.max?.x ?? bb.maxX;
        if (typeof minx === "number" && typeof maxx === "number") {
            found = true;
            if (minx < min) min = minx;
            if (maxx > max) max = maxx;
        }
    });
    return found ? Math.max(0, max - min) : 0;
}

export function setClipboard(nodes: INode[]) {
    clip = {
        items: nodes.map((n) => Serializer.serializeObject(n)),
        widthX: groupWidthX(nodes),
    };
}

export function getClipboard(): ClipboardData | null {
    return clip;
}

export function hasClipboard(): boolean {
    return !!clip && clip.items.length > 0;
}
