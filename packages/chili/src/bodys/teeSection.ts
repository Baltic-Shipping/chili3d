// See CHANGELOG.md for modifications (updated 2025-08-08)
import { I18nKeys, IDocument, IShape, ParameterShapeNode, Plane, Property, Result, Serializer } from "chili-core";

@Serializer.register(["document", "plane", "width", "height", "thickness", "length"])
export class TeeSectionNode extends ParameterShapeNode {
    override display(): I18nKeys { return "body.editableShape"; }

    @Serializer.serialze() get plane(): Plane { return this.getPrivateValue("plane"); }

    @Serializer.serialze() @Property.define("popupTeeSection.width")
    get width(): number { return this.getPrivateValue("width", 10); }
    set width(v: number) { this.setPropertyEmitShapeChanged("width", v); }

    @Serializer.serialze() @Property.define("popupTeeSection.height")
    get height(): number { return this.getPrivateValue("height", 10); }
    set height(v: number) { this.setPropertyEmitShapeChanged("height", v); }

    @Serializer.serialze() @Property.define("popupTeeSection.thickness")
    get thickness(): number { return this.getPrivateValue("thickness", 1); }
    set thickness(v: number) { this.setPropertyEmitShapeChanged("thickness", v); }

    @Serializer.serialze() @Property.define("popupTeeSection.length")
    get length(): number { return this.getPrivateValue("length", 10); }
    set length(v: number) { this.setPropertyEmitShapeChanged("length", v); }

    constructor(document: IDocument, plane: Plane, width: number, height: number, thickness: number, length: number) {
        super(document);
        this.setPrivateValue("plane", plane);
        this.setPrivateValue("width", width);
        this.setPrivateValue("height", height);
        this.setPrivateValue("thickness", thickness);
        this.setPrivateValue("length", length);
    }

    generateShape(): Result<IShape> {
        const sf = this.document.application.shapeFactory;
        const p = this.plane;
        const w = this.width, h = this.height, t = this.thickness, L = this.length;

        const flangePlane = new Plane(p.origin.add(p.yvec.multiply(h - t)), p.normal, p.xvec);
        const flange = sf.box(flangePlane, w, t, L);
        if (!flange.isOk) return flange as any;

        const webPlane = new Plane(p.origin.add(p.xvec.multiply((w - t) / 2)), p.normal, p.xvec);
        const web = sf.box(webPlane, t, Math.max(0, h - t), L);
        if (!web.isOk) return web as any;

        return sf.booleanFuse([flange.value], [web.value]);
    }
}
