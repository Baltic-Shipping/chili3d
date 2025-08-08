// See CHANGELOG.md for modifications (updated 2025-08-08)
import { I18nKeys, IDocument, IShape, ParameterShapeNode, Plane, Property, Result, Serializer } from "chili-core";

@Serializer.register(["document", "plane", "width", "widthTwo", "thickness", "length"])
export class LSectionNode extends ParameterShapeNode {
    override display(): I18nKeys { return "body.editableShape"; }

    @Serializer.serialze() get plane(): Plane { return this.getPrivateValue("plane"); }

    @Serializer.serialze() @Property.define("popupLSection.width")
    get width(): number { return this.getPrivateValue("width", 10); }
    set width(v: number) { this.setPropertyEmitShapeChanged("width", v); }

    @Serializer.serialze() @Property.define("popupLSection.widthTwo")
    get widthTwo(): number { return this.getPrivateValue("widthTwo", 10); }
    set widthTwo(v: number) { this.setPropertyEmitShapeChanged("widthTwo", v); }

    @Serializer.serialze() @Property.define("popupLSection.thickness")
    get thickness(): number { return this.getPrivateValue("thickness", 1); }
    set thickness(v: number) { this.setPropertyEmitShapeChanged("thickness", v); }

    @Serializer.serialze() @Property.define("popupLSection.length")
    get length(): number { return this.getPrivateValue("length", 10); }
    set length(v: number) { this.setPropertyEmitShapeChanged("length", v); }

    constructor(document: IDocument, plane: Plane, width: number, widthTwo: number, thickness: number, length: number) {
        super(document);
        this.setPrivateValue("plane", plane);
        this.setPrivateValue("width", width);
        this.setPrivateValue("widthTwo", widthTwo);
        this.setPrivateValue("thickness", thickness);
        this.setPrivateValue("length", length);
    }

    generateShape(): Result<IShape> {
        const sf = this.document.application.shapeFactory;
        const p = this.plane;
        const w1 = this.width, w2 = this.widthTwo, t = this.thickness, L = this.length;

        const horiz = sf.box(new Plane(p.origin, p.normal, p.xvec), w2, t, L);
        if (!horiz.isOk) return horiz as any;

        const vert = sf.box(new Plane(p.origin, p.normal, p.xvec), t, w1, L);
        if (!vert.isOk) return vert as any;

        return sf.booleanFuse([horiz.value], [vert.value]);
    }
}
