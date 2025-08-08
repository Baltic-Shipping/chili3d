// See CHANGELOG.md for modifications (updated 2025-08-08)
import { I18nKeys, IDocument, IShape, ParameterShapeNode, Plane, Property, Result, Serializer } from "chili-core";

@Serializer.register(["document", "plane", "width", "height", "flangeThickness", "webThickness", "length"])
export class HSectionNode extends ParameterShapeNode {
    override display(): I18nKeys { return "body.editableShape"; }

    @Serializer.serialze() get plane(): Plane { return this.getPrivateValue("plane"); }

    @Serializer.serialze() @Property.define("popupHSection.width")
    get width(): number { return this.getPrivateValue("width", 10); }
    set width(v: number) { this.setPropertyEmitShapeChanged("width", v); }

    @Serializer.serialze() @Property.define("popupHSection.height")
    get height(): number { return this.getPrivateValue("height", 10); }
    set height(v: number) { this.setPropertyEmitShapeChanged("height", v); }

    @Serializer.serialze() @Property.define("popupHSection.flangeThickness")
    get flangeThickness(): number { return this.getPrivateValue("flangeThickness", 1); }
    set flangeThickness(v: number) { this.setPropertyEmitShapeChanged("flangeThickness", v); }

    @Serializer.serialze() @Property.define("popupHSection.webThickness")
    get webThickness(): number { return this.getPrivateValue("webThickness", 1); }
    set webThickness(v: number) { this.setPropertyEmitShapeChanged("webThickness", v); }

    @Serializer.serialze() @Property.define("popupHSection.length")
    get length(): number { return this.getPrivateValue("length", 10); }
    set length(v: number) { this.setPropertyEmitShapeChanged("length", v); }

    constructor(document: IDocument, plane: Plane, width: number, height: number, flangeThickness: number, webThickness: number, length: number) {
        super(document);
        this.setPrivateValue("plane", plane);
        this.setPrivateValue("width", width);
        this.setPrivateValue("height", height);
        this.setPrivateValue("flangeThickness", flangeThickness);
        this.setPrivateValue("webThickness", webThickness);
        this.setPrivateValue("length", length);
    }

    generateShape(): Result<IShape> {
        const sf = this.document.application.shapeFactory;
        const p = this.plane;
        const w = this.width, h = this.height, tf = this.flangeThickness, tw = this.webThickness, L = this.length;

        const bottom = sf.box(new Plane(p.origin, p.normal, p.xvec), w, tf, L);
        if (!bottom.isOk) return bottom as any;

        const top = sf.box(new Plane(p.origin.add(p.yvec.multiply(h - tf)), p.normal, p.xvec), w, tf, L);
        if (!top.isOk) return top as any;

        const web = sf.box(new Plane(p.origin.add(p.xvec.multiply((w - tw) / 2)), p.normal, p.xvec), tw, h, L);
        if (!web.isOk) return web as any;

        const fuse1 = sf.booleanFuse([bottom.value], [web.value]);
        if (!fuse1.isOk) return fuse1 as any;
        return sf.booleanFuse([fuse1.value], [top.value]);
    }
}
