// See CHANGELOG.md for modifications (updated 2025-08-20)
import { INode, Serialized, Serializer } from "chili-core";

type ClipItem = { data: Serialized };
let clip: ClipItem[] = [];

export function setClipboard(nodes: INode[]) {
    clip = nodes.map(n => ({ data: Serializer.serializeObject(n) }));
}

export function getClipboard(): ClipItem[] {
    return clip;
}

export function hasClipboard(): boolean {
    return clip.length > 0;
}
