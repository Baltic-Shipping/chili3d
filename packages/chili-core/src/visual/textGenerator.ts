// See CHANGELOG.md for modifications (updated 2025-07-24)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { IVisualObject } from "./visualObject";

export interface ITextGenerator {
    generate(text: string, size: number, color: number, font?: string): Promise<IVisualObject>;
}
