// See CHANGELOG.md for modifications (updated 2025-08-08)
import { I18nKeys, IDocument, IShape, ParameterShapeNode, Plane, Property, Result, Serializer } from "chili-core";

@Serializer.register(["document", "plane", "outerRadius", "innerRadius", "height"])
export class TubeNode extends ParameterShapeNode {
    override display(): I18nKeys { return "body.editableShape"; }

    @Serializer.serialze() get plane(): Plane { return this.getPrivateValue("plane"); }

    @Serializer.serialze() @Property.define("popuptube.outerRadius")
    get outerRadius(): number { return this.getPrivateValue("outerRadius", 5); }
    set outerRadius(v: number) { this.setPropertyEmitShapeChanged("outerRadius", v); }

    @Serializer.serialze() @Property.define("popuptube.innerRadius")
    get innerRadius(): number { return this.getPrivateValue("innerRadius", 2); }
    set innerRadius(v: number) { this.setPropertyEmitShapeChanged("innerRadius", v); }

    @Serializer.serialze() @Property.define("popuptube.height")
    get height(): number { return this.getPrivateValue("height", 10); }
    set height(v: number) { this.setPropertyEmitShapeChanged("height", v); }

    constructor(document: IDocument, plane: Plane, outerRadius: number, innerRadius: number, height: number) {
        super(document);
        this.setPrivateValue("plane", plane);
        this.setPrivateValue("outerRadius", outerRadius);
        this.setPrivateValue("innerRadius", innerRadius);
        this.setPrivateValue("height", height);
    }

    generateShape(): Result<IShape> {
        const sf = this.document.application.shapeFactory;
        const p = this.plane;
        const R = this.outerRadius, r = Math.max(0, Math.min(this.innerRadius, this.outerRadius - 1e-6)), h = this.height;

        const outer = sf.cylinder(p.normal, p.origin, R, h);
        if (!outer.isOk) return outer as any;

        const inner = sf.cylinder(p.normal, p.origin, r, h);
        if (!inner.isOk) return inner as any;

        return sf.booleanCut([outer.value], [inner.value]);
    }
}
