// See CHANGELOG.md for modifications (updated 2025-08-22)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { MeshUtils } from "chili-geo";
import { VisualConfig } from "../config";
import { IDocument } from "../document";
import { Id, IEqualityComparer, PubSub, Result } from "../foundation";
import { I18n, I18nKeys } from "../i18n";
import { Matrix4, XYZ } from "../math";
import { Property } from "../property";
import { Serializer } from "../serialize";
import { EdgeMeshData, FaceMeshData, IShape, IShapeMeshData, LineType } from "../shape";
import { GeometryNode } from "./geometryNode";

export abstract class ShapeNode extends GeometryNode {
    protected _shape: Result<IShape> = Result.err(SHAPE_UNDEFINED);
    get shape(): Result<IShape> {
        return this._shape;
    }

    protected setShape(shape: Result<IShape>) {
        if (this._shape.isOk && this._shape.value.isEqual(shape.value)) {
            return;
        }

        if (!shape.isOk) {
            PubSub.default.pub("displayError", shape.error);
            return;
        }

        let oldShape = this._shape;
        this._shape = shape;
        this._mesh = undefined;

        this.emitPropertyChanged("shape", oldShape);

        oldShape.unchecked()?.dispose();
    }

    protected override createMesh(): IShapeMeshData {
        if (!this.shape.isOk) {
            throw new Error(this.shape.error);
        }
        const mesh = this.shape.value.mesh;
        this._originFaceMesh = mesh.faces;
        if (mesh.faces)
            mesh.faces = MeshUtils.mergeFaceMesh(
                mesh.faces,
                this.faceMaterialPair.map((x) => [x.faceIndex, x.materialIndex]),
            );
        return mesh;
    }

    override disposeInternal(): void {
        super.disposeInternal();
        this._shape.unchecked()?.dispose();
        this._shape = null as any;
    }
}

export class MultiShapeMesh implements IShapeMeshData {
    private readonly _edges: EdgeMeshData;
    private readonly _faces: FaceMeshData;

    get edges() {
        return this._edges.position.length > 0 ? this._edges : undefined;
    }

    get faces() {
        return this._faces.position.length > 0 ? this._faces : undefined;
    }

    constructor() {
        this._edges = {
            lineType: LineType.Solid,
            position: new Float32Array(),
            range: [],
            color: VisualConfig.defaultEdgeColor,
        };

        this._faces = {
            index: new Uint32Array(),
            normal: new Float32Array(),
            position: new Float32Array(),
            uv: new Float32Array(),
            range: [],
            groups: [],
            color: VisualConfig.defaultFaceColor,
        };
    }

    public addShape(shape: IShape, matrix: Matrix4) {
        const mesh = shape.mesh;
        const totleMatrix = shape.matrix.multiply(matrix);
        if (mesh.faces) {
            MeshUtils.combineFaceMeshData(this._faces, mesh.faces, totleMatrix);
        }
        if (mesh.edges) {
            MeshUtils.combineEdgeMeshData(this._edges, mesh.edges, totleMatrix);
        }
    }
}

@Serializer.register(["document", "name", "shapes", "materialId", "id"])
export class MultiShapeNode extends GeometryNode {
    private readonly _shapes: IShape[];
    @Serializer.serialze()
    get shapes(): ReadonlyArray<IShape> {
        return this._shapes;
    }

    constructor(
        document: IDocument,
        name: string,
        shapes: IShape[],
        materialId?: string,
        id: string = Id.generate(),
    ) {
        super(document, name, materialId, id);
        this._shapes = shapes;
    }

    protected override createMesh(): IShapeMeshData {
        const meshes = new MultiShapeMesh();

        this._shapes.forEach((shape) => {
            meshes.addShape(shape, Matrix4.identity());
        });

        return meshes;
    }

    override display(): I18nKeys {
        return "body.multiShape";
    }
}

const SHAPE_UNDEFINED = "Shape not initialized";
export abstract class ParameterShapeNode extends ShapeNode {
    override get shape(): Result<IShape> {
        if (!this._shape.isOk && this._shape.error === SHAPE_UNDEFINED) {
            this._shape = this.generateShape();
        }
        return this._shape;
    }

    protected setPropertyEmitShapeChanged<K extends keyof this>(
        property: K,
        newValue: this[K],
        onPropertyChanged?: (property: K, oldValue: this[K]) => void,
        equals?: IEqualityComparer<this[K]> | undefined,
    ): boolean {
        if (this.setProperty(property, newValue, onPropertyChanged, equals)) {
            this.setShape(this.generateShape());
            return true;
        }

        return false;
    }

    constructor(document: IDocument, materialId?: string, id?: string) {
        super(document, undefined as any, materialId, id);
        this.setPrivateValue("name", I18n.translate(this.display()));
    }

    protected abstract generateShape(): Result<IShape>;
}

@Serializer.register(["document", "name", "shape", "materialId", "id"])
export class EditableShapeNode extends ShapeNode {
    override display(): I18nKeys {
        return "body.editableShape";
    }

    @Serializer.serialze()
    override get shape() {
        return this._shape;
    }

    override set shape(shape: Result<IShape>) {
        this.setShape(shape);
    }

    constructor(
        document: IDocument,
        name: string,
        shape: IShape | Result<IShape>,
        materialId?: string | string[],
        id?: string,
    ) {
        super(document, name, materialId, id);
        this._shape = shape instanceof Result ? shape : Result.ok(shape);
        this.onPropertyChanged((p) => {
            if (p === "transform" || p === "shape") {
                this.emitPropertyChanged("importLength", undefined as any);
                this.emitPropertyChanged("importWidth", undefined as any);
                this.emitPropertyChanged("importHeight", undefined as any);
            }
        });
    }

    @Serializer.serialze()
    @Property.define("import.keepProportions")
    get keepProportions() {
        return this.getPrivateValue("keepProportions", false);
    }
    set keepProportions(v: boolean) {
        this.setProperty("keepProportions", v);
    }

    @Property.define("import.length")
    get importLength() {
        const bb = this.boundingBox();
        return Math.max(0, (bb?.max.x ?? 0) - (bb?.min.x ?? 0));
    }
    set importLength(v: number) {
        this.resizeAlong(0, v);
    }

    @Property.define("import.width")
    get importWidth() {
        const bb = this.boundingBox();
        return Math.max(0, (bb?.max.y ?? 0) - (bb?.min.y ?? 0));
    }
    set importWidth(v: number) {
        this.resizeAlong(1, v);
    }

    @Property.define("import.height")
    get importHeight() {
        const bb = this.boundingBox();
        return Math.max(0, (bb?.max.z ?? 0) - (bb?.min.z ?? 0));
    }
    set importHeight(v: number) {
        this.resizeAlong(2, v);
    }

    private resizeAlong(axis: 0 | 1 | 2, target: number) {
        const bb = this.boundingBox();
        if (!bb) return;

        const dims = [
            Math.max(0, (bb.max.x ?? 0) - (bb.min.x ?? 0)),
            Math.max(0, (bb.max.y ?? 0) - (bb.min.y ?? 0)),
            Math.max(0, (bb.max.z ?? 0) - (bb.min.z ?? 0)),
        ];
        const curr = dims[axis];
        if (curr <= 0 || !isFinite(target) || target <= 0) return;

        const s = target / curr;
        let sx = 1, sy = 1, sz = 1;
        if (this.keepProportions) { sx = s; sy = s; sz = s; }
        else { if (axis === 0) sx = s; if (axis === 1) sy = s; if (axis === 2) sz = s; }

        const vis = this.document.visual.context.getVisual(this);
        const wbb = vis?.boundingBox();
        const cxw = wbb ? (wbb.min.x + wbb.max.x) * 0.5 : 0;
        const cyw = wbb ? (wbb.min.y + wbb.max.y) * 0.5 : 0;
        const czw = wbb ? (wbb.min.z + wbb.max.z) * 0.5 : 0;

        const W = this.worldTransform();
        const invW = W.invert() || Matrix4.identity();
        const anchorLocal = invW.ofPoint(new XYZ(cxw, cyw, czw));

        const Tneg = Matrix4.fromTranslation(-anchorLocal.x, -anchorLocal.y, -anchorLocal.z);
        const S = Matrix4.fromScale(sx, sy, sz);
        const Tpos = Matrix4.fromTranslation(anchorLocal.x, anchorLocal.y, anchorLocal.z);
        const A = Tneg.multiply(S).multiply(Tpos);

        this.transform = this.transform.multiply(A);

        const vis2 = this.document.visual.context.getVisual(this);
        const wbb2 = vis2?.boundingBox();
        if (wbb && wbb2) {
            const nx = (wbb2.min.x + wbb2.max.x) * 0.5;
            const ny = (wbb2.min.y + wbb2.max.y) * 0.5;
            const nz = (wbb2.min.z + wbb2.max.z) * 0.5;
            const dx = cxw - nx, dy = cyw - ny, dz = czw - nz;
            if (Math.abs(dx) > 1e-6 || Math.abs(dy) > 1e-6 || Math.abs(dz) > 1e-6) {
                const T = Matrix4.fromTranslation(dx, dy, dz);
                const W2 = this.worldTransform();
                const invW2 = W2.invert() || Matrix4.identity();
                const D = invW2.multiply(T).multiply(W2);
                this.transform = this.transform.multiply(D);
            }
        }
    }
}
