// See CHANGELOG.md for modifications (updated 2025-08-08)
import { I18nKeys, IDocument, IShape, ParameterShapeNode, Plane, Property, Result, Serializer } from "chili-core";

@Serializer.register(["document", "plane", "width", "height", "thickness", "length"])
export class RecSectionNode extends ParameterShapeNode {
    override display(): I18nKeys { return "body.editableShape"; }

    @Serializer.serialze() get plane(): Plane { return this.getPrivateValue("plane"); }

    @Serializer.serialze() @Property.define("popupRecSection.width")
    get width(): number { return this.getPrivateValue("width", 10); }
    set width(v: number) { this.setPropertyEmitShapeChanged("width", v); }

    @Serializer.serialze() @Property.define("popupRecSection.height")
    get height(): number { return this.getPrivateValue("height", 10); }
    set height(v: number) { this.setPropertyEmitShapeChanged("height", v); }

    @Serializer.serialze() @Property.define("popupRecSection.thickness")
    get thickness(): number { return this.getPrivateValue("thickness", 1); }
    set thickness(v: number) { this.setPropertyEmitShapeChanged("thickness", v); }

    @Serializer.serialze() @Property.define("popupRecSection.length")
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

        const outer = sf.box(new Plane(p.origin, p.normal, p.xvec), w, h, L);
        if (!outer.isOk) return outer as any;

        const inner = sf.box(new Plane(p.origin.add(p.xvec.multiply(t)).add(p.yvec.multiply(t)), p.normal, p.xvec), Math.max(0, w - 2 * t), Math.max(0, h - 2 * t), L);
        if (!inner.isOk) return inner as any;

        return sf.booleanCut([outer.value], [inner.value]);
    }
}
