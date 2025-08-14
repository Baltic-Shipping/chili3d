// See CHANGELOG.md for modifications (updated 2025-08-14)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import {
    BoundingBox,
    EdgeMeshData,
    FaceMeshData,
    GeometryNode,
    getCurrentApplication,
    IEdge,
    IShape,
    ISubEdgeShape,
    ISubShape,
    IVisualGeometry,
    Matrix4,
    ShapeMeshRange,
    ShapeNode,
    ShapeType,
    VisualConfig,
    XYZ
} from "chili-core";
import { MeshUtils } from "chili-geo";
import { Material, Mesh, MeshLambertMaterial, Object3D, Raycaster, Vector3 } from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer";
import { defaultEdgeMaterial } from "./common";
import { Constants } from "./constants";
import { ThreeGeometryFactory } from "./threeGeometryFactory";
import { ThreeHelper } from "./threeHelper";
import style from "./threeView.module.css";
import { ThreeVisualContext } from "./threeVisualContext";
import { ThreeVisualObject } from "./threeVisualObject";

export class ThreeGeometry extends ThreeVisualObject implements IVisualGeometry {
    private _edgeLabels: { startLocal: XYZ; endLocal: XYZ; midLocal: XYZ; text: string; obj?: CSS2DObject }[] = [];
    private _edgeLabelRaf?: number;
    private _raycaster = new Raycaster();
    private _occluders: Object3D[] = [];
    private _lastRefreshTs = 0;
    private _faceMaterial: Material | Material[];
    private _edges?: LineSegments2;
    private _faces?: Mesh;

    constructor(
        readonly geometryNode: GeometryNode,
        readonly context: ThreeVisualContext,
    ) {
        super(geometryNode);
        this._faceMaterial = context.getMaterial(geometryNode.materialId);
        this.generateShape();
        geometryNode.onPropertyChanged(this.handleGeometryPropertyChanged);
    }

    changeFaceMaterial(material: Material | Material[]) {
        if (this._faces) {
            this._faceMaterial = material;
            this._faces.material = material;
        }
    }

    box() {
        return this._faces?.geometry.boundingBox ?? this._edges?.geometry.boundingBox;
    }

    override boundingBox(): BoundingBox | undefined {
        const box = this._faces?.geometry.boundingBox ?? this._edges?.geometry.boundingBox;
        if (!box) return undefined;

        return {
            min: ThreeHelper.toXYZ(box.min),
            max: ThreeHelper.toXYZ(box.max),
        };
    }

    private readonly handleGeometryPropertyChanged = (property: keyof GeometryNode) => {
        if (property === "materialId") {
            this.changeFaceMaterial(this.context.getMaterial(this.geometryNode.materialId));
        } else if ((property as keyof ShapeNode) === "shape") {
            this.removeMeshes();
            this.generateShape();
        }
    };

    private createEdgeLabels() {
        if (!VisualConfig.showEdgeDimensions) return;
        const mesh = this.geometryNode.mesh;
        const edges = mesh?.edges;
        if (!edges || !edges.range?.length) return;

        for (const l of this._edgeLabels) {
            if (l.obj) {
                this.context.cssObjects.remove(l.obj);
                (l.obj.element as HTMLElement).remove();
                l.obj = undefined;
            }
        }
        this._edgeLabels.length = 0;

        const view = getCurrentApplication()?.activeView;
        if (!view) return;

        for (let i = 0; i < edges.range.length; i++) {
            const r = edges.range[i];
            if (r.shape.shapeType !== ShapeType.Edge) continue;

            const tr = r.transform ?? Matrix4.identity();
            const se = r.shape as ISubEdgeShape;
            const e = se.transformedMul(tr) as IEdge;

            const s = e.curve.startPoint();
            const t = e.curve.endPoint();
            const midLocal = s.add(t).multiply(0.5);
            const text = e.length().toFixed(2) + " mm";

            this._edgeLabels.push({ startLocal: s, endLocal: t, midLocal, text });
            e.dispose();
        }

        this.updateOccluders();
        this.refreshEdgeLabels();
        this.ensureLabelVisLoop();
    }

    private updateOccluders() {
        this._raycaster.layers.disableAll();
        this._raycaster.layers.enable(Constants.Layers.Solid);
        const arr: Object3D[] = [];
        this.context.visuals().forEach(v => {
            const objs = (v as any).wholeVisual?.() as Object3D[] | undefined;
            if (!objs) return;
            for (const o of objs) {
                if ((o as any).layers?.test && (o as any).layers.test(this._raycaster.layers)) arr.push(o);
            }
        });
        this._occluders = arr;
    }

    private refreshEdgeLabels() {
        const view = getCurrentApplication()?.activeView;
        if (!view) return;

        const selfObjs = (this as any).wholeVisual?.() as Object3D[] | undefined;
        const root = selfObjs && selfObjs[0];
        if (!root || !root.matrixWorld) return;

        const MIN_EDGE_PX = 36;
        const MAX_VISIBLE = 15;

        const candidates: {
            idx: number;
            lenPx: number;
            midWorld: XYZ;
        }[] = [];

        for (let i = 0; i < this._edgeLabels.length; i++) {
            const lbl = this._edgeLabels[i];
            const v0 = new Vector3(lbl.startLocal.x, lbl.startLocal.y, lbl.startLocal.z).applyMatrix4(root.matrixWorld);
            const v1 = new Vector3(lbl.endLocal.x, lbl.endLocal.y, lbl.endLocal.z).applyMatrix4(root.matrixWorld);
            const vm = new Vector3(lbl.midLocal.x, lbl.midLocal.y, lbl.midLocal.z).applyMatrix4(root.matrixWorld);

            const lenPx = this.edgePixelLength(v0, v1);
            if (lenPx < MIN_EDGE_PX) {
                if (lbl.obj) lbl.obj.visible = false;
                continue;
            }

            candidates.push({ idx: i, lenPx, midWorld: new XYZ(vm.x, vm.y, vm.z) });
        }

        candidates.sort((a, b) => b.lenPx - a.lenPx);

        const seen = new Set<string>();
        let shown = 0;

        for (const c of candidates) {
            if (shown >= MAX_VISIBLE) break;
            const lbl = this._edgeLabels[c.idx];
            if (seen.has(lbl.text)) {
                if (lbl.obj) lbl.obj.visible = false;
                continue;
            }
            if (this.isOccluded(c.midWorld)) {
                if (lbl.obj) lbl.obj.visible = false;
                continue;
            }

            if (!lbl.obj) {
                const el = document.createElement("div");
                el.className = `${style.htmlText} ${style.noEvent}`;
                const sp = document.createElement("span");
                sp.textContent = lbl.text;
                el.appendChild(sp);
                lbl.obj = new CSS2DObject(el);
                this.context.cssObjects.add(lbl.obj);
            }
            lbl.obj.position.set(c.midWorld.x, c.midWorld.y, c.midWorld.z);
            lbl.obj.visible = true;

            seen.add(lbl.text);
            shown++;
        }

        for (const lbl of this._edgeLabels) {
            if (!lbl.obj) continue;
            if (!lbl.obj.visible) continue;
            if (!seen.has(lbl.text)) lbl.obj.visible = false;
        }
    }

    private edgePixelLength(a: Vector3, b: Vector3) {
        const view = getCurrentApplication()?.activeView;
        if (!view) return Infinity;

        const cam: any =
            (view as any).three?.camera ||
            (view.cameraController as any).camera ||
            (view.cameraController as any).three ||
            (view as any).camera;

        const w = (view as any).width || (view as any).size?.width || (view as any).dom?.clientWidth || 1920;
        const h = (view as any).height || (view as any).size?.height || (view as any).dom?.clientHeight || 1080;

        if (!cam || !w || !h) return Infinity;

        const pa = a.clone().project(cam);
        const pb = b.clone().project(cam);

        const sx0 = (pa.x * 0.5 + 0.5) * w;
        const sy0 = (-pa.y * 0.5 + 0.5) * h;
        const sx1 = (pb.x * 0.5 + 0.5) * w;
        const sy1 = (-pb.y * 0.5 + 0.5) * h;

        const dx = sx1 - sx0;
        const dy = sy1 - sy0;
        return Math.hypot(dx, dy);
    }

    private ensureLabelVisLoop() {
        if (this._edgeLabelRaf) return;
        const view = getCurrentApplication()?.activeView;
        if (!view) return;

        let lastKey = "";

        const tick = () => {
            if (view.isClosed) {
                this._edgeLabelRaf = undefined;
                return;
            }

            const p = view.cameraController.cameraPosition;
            const t = view.cameraController.cameraTarget;
            const camKey = `${p.x.toFixed(2)},${p.y.toFixed(2)},${p.z.toFixed(2)}|${t.x.toFixed(2)},${t.y.toFixed(2)},${t.z.toFixed(2)}|${view.mode}`;

            const selfObjs = (this as any).wholeVisual?.() as Object3D[] | undefined;
            const root = selfObjs && selfObjs[0];
            const mw = root?.matrixWorld?.elements as number[] | undefined;
            const objKey = mw ? mw.map(n => n.toFixed(3)).join(",") : "";

            const key = camKey + "#" + objKey;

            const now = performance.now();
            if (key !== lastKey && now - this._lastRefreshTs > 50) {
                lastKey = key;
                this._lastRefreshTs = now;
                this.refreshEdgeLabels();
            }

            this._edgeLabelRaf = requestAnimationFrame(tick) as any;
        };

        this._edgeLabelRaf = requestAnimationFrame(tick) as any;
    }

    private isOccluded(mid: XYZ) {
        const view = getCurrentApplication()?.activeView;
        if (!view) return false;

        const origin = new Vector3(
            view.cameraController.cameraPosition.x,
            view.cameraController.cameraPosition.y,
            view.cameraController.cameraPosition.z
        );
        const target = new Vector3(mid.x, mid.y, mid.z);
        const dir = target.clone().sub(origin).normalize();
        const dist = origin.distanceTo(target);

        this._raycaster.layers.disableAll();
        this._raycaster.layers.enable(Constants.Layers.Solid);
        (this._raycaster as any).near = 0.001;
        (this._raycaster as any).far = Math.max(0, dist - 0.5);
        this._raycaster.set(origin, dir);

        if (!this._occluders.length) this.updateOccluders();

        const hits = this._raycaster.intersectObjects(this._occluders, false);
        return hits.length > 0;
    }

    private generateShape() {
        const mesh = this.geometryNode.mesh;
        if (mesh?.faces?.position.length) this.initFaces(mesh.faces);
        if (mesh?.edges?.position.length) this.initEdges(mesh.edges);
        this.createEdgeLabels();
    }

    private disposeEdgeLabels() {
        for (const l of this._edgeLabels) {
            if (l.obj) {
                this.context.cssObjects.remove(l.obj);
                (l.obj.element as HTMLElement).remove();
                l.obj = undefined;
            }
        }
        this._edgeLabels.length = 0;
        if (this._edgeLabelRaf) cancelAnimationFrame(this._edgeLabelRaf);
        this._edgeLabelRaf = undefined;
        this._occluders = [];
    }

    override dispose() {
        super.dispose();
        this.geometryNode.removePropertyChanged(this.handleGeometryPropertyChanged);
        this.removeMeshes();
    }

    private removeMeshes() {
        this.disposeEdgeLabels();
        if (this._edges) {
            this.remove(this._edges);
            this._edges.geometry.dispose();
            this._edges = null as any;
        }
        if (this._faces) {
            this.remove(this._faces);
            this._faces.geometry.dispose();
            this._faces = null as any;
        }
    }

    private initEdges(data: EdgeMeshData) {
        const buff = ThreeGeometryFactory.createEdgeBufferGeometry(data);
        this._edges = new LineSegments2(buff, defaultEdgeMaterial);
        this._edges.layers.set(Constants.Layers.Wireframe);
        this.add(this._edges);
    }

    private initFaces(data: FaceMeshData) {
        const buff = ThreeGeometryFactory.createFaceBufferGeometry(data);
        if (data.groups.length > 1) buff.groups = data.groups;
        this._faces = new Mesh(buff, this._faceMaterial);
        this._faces.layers.set(Constants.Layers.Solid);
        this.add(this._faces);
    }

    setFacesMateiralTemperary(material: MeshLambertMaterial) {
        if (this._faces) this._faces.material = material;
    }

    setEdgesMateiralTemperary(material: LineMaterial) {
        if (this._edges) this._edges.material = material;
    }

    removeTemperaryMaterial(): void {
        if (this._edges) this._edges.material = defaultEdgeMaterial;
        if (this._faces) this._faces.material = this._faceMaterial;
    }

    cloneSubEdge(index: number) {
        const positions = MeshUtils.subEdge(this.geometryNode.mesh.edges!, index);
        if (!positions) return undefined;

        const buff = new LineSegmentsGeometry();
        buff.setPositions(positions);
        buff.applyMatrix4(this.matrixWorld);

        return new LineSegments2(buff, defaultEdgeMaterial);
    }

    cloneSubFace(index: number) {
        const mesh = MeshUtils.subFace(this.geometryNode.mesh.faces!, index);
        if (!mesh) return undefined;

        const buff = ThreeGeometryFactory.createFaceBufferGeometry(mesh);
        buff.applyMatrix4(this.matrixWorld);

        return new Mesh(buff, this._faceMaterial);
    }

    faces() {
        return this._faces;
    }

    edges() {
        return this._edges;
    }

    override getSubShapeAndIndex(shapeType: "face" | "edge", subVisualIndex: number) {
        let subShape: ISubShape | undefined = undefined;
        let transform: Matrix4 | undefined = undefined;
        let index: number = -1;
        let groups: ShapeMeshRange[] | undefined = undefined;
        if (shapeType === "edge") {
            groups = this.geometryNode.mesh.edges?.range;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, subVisualIndex)!;
                subShape = groups[index].shape;
                transform = groups[index].transform;
            }
        } else {
            groups = this.geometryNode.mesh.faces?.range;
            if (groups) {
                index = ThreeHelper.findGroupIndex(groups, subVisualIndex)!;
                subShape = groups[index].shape;
                transform = groups[index].transform;
            }
        }

        let shape: IShape | undefined = subShape;
        if (this.geometryNode instanceof ShapeNode) {
            shape = this.geometryNode.shape.value;
        }
        return { transform, shape, subShape, index, groups: groups ?? [] };
    }

    override subShapeVisual(shapeType: ShapeType): (Mesh | LineSegments2)[] {
        const shapes: (Mesh | LineSegments2 | undefined)[] = [];

        const isWhole =
            shapeType === ShapeType.Shape ||
            ShapeType.hasCompound(shapeType) ||
            ShapeType.hasCompoundSolid(shapeType) ||
            ShapeType.hasSolid(shapeType);

        if (isWhole || ShapeType.hasEdge(shapeType) || ShapeType.hasWire(shapeType)) {
            shapes.push(this.edges());
        }

        if (isWhole || ShapeType.hasFace(shapeType) || ShapeType.hasShell(shapeType)) {
            shapes.push(this.faces());
        }

        return shapes.filter((x) => x !== undefined);
    }

    override wholeVisual(): (Mesh | LineSegments2)[] {
        return [this.edges(), this.faces()].filter((x) => x !== undefined);
    }
}
