// See CHANGELOG.md for modifications (updated 2025-08-08)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "./config";

export namespace Navigation3D {
    export enum Nav3DType {
        Simple = 0,
        Chili3d,
        Revit,
        Blender,
        Creo,
        Solidworks,
    }
    export const types: string[] = [Nav3DType[0], Nav3DType[1], Nav3DType[2], Nav3DType[3], Nav3DType[4], Nav3DType[5]];

    export function getKey(event: MouseEvent) {
        const simple = Config.instance.navigation3DIndex === Nav3DType.Simple;
        const buttons = (event as any).buttons ?? 0;

        let btn = "Middle";
        if (simple) {
            if ((buttons & 1) === 1) btn = "Left";
            else if ((buttons & 2) === 2) btn = "Right";
            else if ((buttons & 4) === 4) btn = "Middle";
        }

        let key = btn;
        if (event.shiftKey) key = "Shift+" + key;
        if (event.ctrlKey) key = "Ctrl+" + key;
        if (event.altKey) key = "Alt+" + key;

        if (simple && key.indexOf("Right") >= 0) key = key.replace("Right", "Left");
        return key;
    }


    export function navigationKeyMap(): {
        pan: string;
        rotate: string;
    } {
        const functionKey = {
            [Nav3DType.Simple]: {
                pan: "Left",
                rotate: "Shift+Left",
            },
            [Nav3DType.Chili3d]: {
                pan: "Middle",
                rotate: "Shift+Middle",
            },
            [Nav3DType.Revit]: {
                pan: "Middle",
                rotate: "Shift+Middle",
            },
            [Nav3DType.Blender]: {
                pan: "Shift+Middle",
                rotate: "Middle",
            },
            [Nav3DType.Creo]: {
                pan: "Shift+Middle",
                rotate: "Middle",
            },
            [Nav3DType.Solidworks]: {
                pan: "Ctrl+Middle",
                rotate: "Middle",
            },
        };
        const idx = (Config.instance.navigation3DIndex as Nav3DType) ?? Nav3DType.Simple;
        return functionKey[idx];
    }
}
