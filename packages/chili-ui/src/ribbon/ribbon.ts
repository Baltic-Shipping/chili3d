// See CHANGELOG.md for modifications (updated 2025-12-04)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { a, collection, div, img, label, option, select, span, svg } from "chili-controls";
import {
    Binding,
    ButtonSize,
    Command,
    CommandKeys,
    Config,
    I18n,
    IApplication,
    ICommand,
    IConverter,
    IView,
    Localize,
    Logger,
    Observable,
    ObservableCollection,
    PubSub,
    Result,
} from "chili-core";
import logoUrl from "../home/fabbro.png";
import homeStyle from "../home/home.module.css";
import { CommandContext } from "./commandContext";
import style from "./ribbon.module.css";
import { RibbonButton } from "./ribbonButton";
import { RibbonCommandData, RibbonGroupData, RibbonTabData } from "./ribbonData";
import { RibbonStack } from "./ribbonStack";

export class RibbonDataContent extends Observable {
    readonly quickCommands = new ObservableCollection<CommandKeys>();
    readonly ribbonTabs = new ObservableCollection<RibbonTabData>();
    private _activeTab: RibbonTabData;
    private _activeView: IView | undefined;

    constructor(
        readonly app: IApplication,
        quickCommands: CommandKeys[],
        ribbonTabs: RibbonTabData[],
    ) {
        super();
        this.quickCommands.push(...quickCommands);
        this.ribbonTabs.push(...ribbonTabs);
        this._activeTab = ribbonTabs[0];
        PubSub.default.sub("activeViewChanged", (v) => (this.activeView = v));
    }

    get activeTab() {
        return this._activeTab;
    }
    set activeTab(value: RibbonTabData) {
        this.setProperty("activeTab", value);
    }

    get activeView() {
        return this._activeView;
    }
    set activeView(value: IView | undefined) {
        this.setProperty("activeView", value);
    }
}

export const QuickButton = (command: ICommand) => {
    const data = Command.getData(command);
    if (!data) {
        Logger.warn("commandData is undefined");
        return span({ textContent: "null" });
    }

    return svg({
        icon: data.icon,
        title: new Localize(`command.${data.key}`),
        onclick: () => PubSub.default.pub("executeCommand", data.key),
    });
};

class ViewActiveConverter implements IConverter<IView> {
    constructor(
        readonly target: IView,
        readonly style: string,
        readonly activeStyle: string,
    ) {}

    convert(value: IView): Result<string> {
        return Result.ok(this.target === value ? `${this.style} ${this.activeStyle}` : this.style);
    }
}

class ActivedRibbonTabConverter implements IConverter<RibbonTabData> {
    constructor(
        readonly tab: RibbonTabData,
        readonly style: string,
        readonly activeStyle: string,
    ) {}

    convert(value: RibbonTabData): Result<string> {
        return Result.ok(this.tab === value ? `${this.style} ${this.activeStyle}` : this.style);
    }
}

class DisplayConverter implements IConverter<RibbonTabData> {
    constructor(readonly tab: RibbonTabData) {}

    convert(value: RibbonTabData): Result<string> {
        return Result.ok(this.tab === value ? "" : "none");
    }
}

export class Ribbon extends HTMLElement {
    private readonly _commandContextSlot = div({ className: style.commandContextSlot });
    private readonly _orbitModeSelect: HTMLSelectElement;
    private readonly _commandContext: HTMLDivElement;
    private commandContext?: CommandContext;

    constructor(readonly dataContent: RibbonDataContent) {
        super();
        this.className = style.root;

        this._orbitModeSelect = this.createOrbitModeSelect();

        this._commandContext = div(
            { className: style.commandContextPanel },
            this._commandContextSlot,
            div(
                { className: style.orbitPanel },
                label({ className: style.contextLabel, textContent: "Orbit:" }),
                this._orbitModeSelect,
            ),
        );

        this.append(this.header(), this.ribbonTabs(), this._commandContext);
    }

    private createOrbitModeSelect(): HTMLSelectElement {
        const el = select(
            {
                className: style.contextSelect,
                onchange: (e) => {
                    const mode = (e.target as HTMLSelectElement).value as "turntable" | "trackball";
                    this.applyOrbitMode(mode);
                },
            },
            option({ value: "turntable", textContent: "Turntable" }),
            option({ value: "trackball", textContent: "Trackball" }),
        ) as HTMLSelectElement;

        el.value = Config.instance.orbitRotationMode;
        return el;
    }

    private applyOrbitMode(mode: "turntable" | "trackball") {
        Config.instance.orbitRotationMode = mode;

        for (const v of this.dataContent.app.views) {
            const cc = (v as any)?.cameraController;
            if (cc && "rotationMode" in cc) {
                cc.rotationMode = mode;
            }
        }
    }

    private readonly onConfigChanged = (prop: keyof Config, _src: Config, _old: any) => {
        if (prop !== "orbitRotationMode") return;
        this._orbitModeSelect.value = Config.instance.orbitRotationMode;
    };

    private header() {
        return div({ className: style.titleBar }, this.leftPanel(), this.centerPanel(), this.rightPanel());
    }

    private leftPanel() {
        return div(
            { className: style.left },
            div(
                { className: style.appIcon, onclick: () => PubSub.default.pub("displayHome", true) },
                img({ className: homeStyle.logo, src: logoUrl }),
            ),
            div(
                { className: style.ribbonTitlePanel },
                svg({
                    className: style.home,
                    icon: "icon-home",
                    onclick: () => PubSub.default.pub("displayHome", true),
                }),
                collection({
                    className: style.quickCommands,
                    sources: this.dataContent.quickCommands,
                    template: (command: CommandKeys) => QuickButton(command as any),
                }),
                span({ className: style.split }),
                this.createRibbonHeader(),
            ),
        );
    }

    private createRibbonHeader() {
        return collection({
            sources: this.dataContent.ribbonTabs,
            template: (tab: RibbonTabData) => {
                const converter = new ActivedRibbonTabConverter(tab, style.tabHeader, style.activedTab);
                return label({
                    className: new Binding(this.dataContent, "activeTab", converter),
                    textContent: new Localize(tab.tabName),
                    onclick: () => (this.dataContent.activeTab = tab),
                });
            },
        });
    }

    private centerPanel() {
        return div(
            { className: style.center },
            collection({
                className: style.views,
                sources: this.dataContent.app.views,
                template: (view) => this.createViewItem(view),
            }),
            svg({
                className: style.new,
                icon: "icon-plus",
                title: I18n.translate("command.doc.new"),
                onclick: () => PubSub.default.pub("executeCommand", "doc.new"),
            }),
        );
    }

    private createViewItem(view: IView) {
        return div(
            {
                className: new Binding(
                    this.dataContent,
                    "activeView",
                    new ViewActiveConverter(view, style.tab, style.active),
                ),
                onclick: () => {
                    this.dataContent.app.activeView = view;
                },
            },
            div({ className: style.name }, span({ textContent: new Binding(view.document, "name") })),
            svg({
                className: style.close,
                icon: "icon-times",
                onclick: (e) => {
                    e.stopPropagation();
                    view.close();
                },
            }),
        );
    }

    private ribbonTabs() {
        return collection({
            className: style.tabContentPanel,
            sources: this.dataContent.ribbonTabs,
            template: (tab: RibbonTabData) => this.ribbonTab(tab),
        });
    }

    private rightPanel() {
        return div(
            { className: style.right },
            a(
                {
                    href: "https://github.com/Baltic-Shipping/chili3d",
                    target: "_blank",
                    rel: "noopener",
                    className: style.sourceLink,
                    title: "View source code (AGPL-3.0)",
                },
                svg({ title: "GitHub", className: style.icon, icon: "icon-github" }),
                span({ className: style.sourceText }, "Source"),
            ),
        );
    }

    private ribbonTab(tab: RibbonTabData) {
        return collection({
            className: style.groupPanel,
            sources: tab.groups,
            style: {
                display: new Binding(this.dataContent, "activeTab", new DisplayConverter(tab)),
            },
            template: (group: RibbonGroupData) => this.ribbonGroup(group),
        });
    }

    private ribbonGroup(group: RibbonGroupData) {
        return div(
            { className: style.ribbonGroup },
            collection({
                sources: group.items,
                className: style.content,
                template: (item) => this.ribbonButton(item),
            }),
            label({ className: style.header, textContent: new Localize(group.groupName) }),
        );
    }

    private ribbonButton(item: RibbonCommandData) {
        if (typeof item === "string") {
            return RibbonButton.fromCommandName(item, ButtonSize.large)!;
        } else if (item instanceof ObservableCollection) {
            const stack = new RibbonStack();
            item.forEach((b) => {
                const button = RibbonButton.fromCommandName(b, ButtonSize.small);
                if (button) stack.append(button);
            });
            return stack;
        } else {
            return new RibbonButton(item.display, item.icon, ButtonSize.large, item.onClick);
        }
    }

    connectedCallback(): void {
        PubSub.default.sub("openCommandContext", this.openContext);
        PubSub.default.sub("closeCommandContext", this.closeContext);
        Config.instance.onPropertyChanged(this.onConfigChanged);
    }

    disconnectedCallback(): void {
        PubSub.default.remove("openCommandContext", this.openContext);
        PubSub.default.remove("closeCommandContext", this.closeContext);
        Config.instance.removePropertyChanged(this.onConfigChanged);
    }

    private readonly openContext = (command: ICommand) => {
        if (this.commandContext) {
            this.closeContext();
        }
        this.commandContext = new CommandContext(command);
        this._commandContextSlot.append(this.commandContext);
    };

    private readonly closeContext = () => {
        this.commandContext?.remove();
        this.commandContext?.dispose();
        this.commandContext = undefined;
        this._commandContextSlot.innerHTML = "";
    };
}

customElements.define("chili-ribbon", Ribbon);
