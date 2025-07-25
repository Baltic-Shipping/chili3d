// See CHANGELOG.md for modifications (updated 2025-07-24)
// Part of the Chili3d Project, under the AGPL-3.0 License.
// See LICENSE file in the project root for full license information.

import { Config } from "../config";
import en from "./en";
import { I18nKeys } from "./keys";
import lt from "./lt";

const I18nId = "chili18n";
const I18nArgs = new WeakMap<HTMLElement, any[]>();

export type LanguageCode = "en" | "lt";

export type Locale = {
    display: string;
    code: LanguageCode;
    translation: {
        [key in I18nKeys]: string;
    } & {
        [key: string]: string;
    };
};

export type I18nPath = "textContent" | "title";

export class Localize {
    constructor(readonly key: I18nKeys) {}

    set(e: HTMLElement, path: I18nPath) {
        I18n.set(e, path, this.key);
    }
}

export type Translation = Record<I18nKeys, string>;

export namespace I18n {
    export const languages = new Map<LanguageCode, Locale>([
        ["en", en],
        ["lt", lt],
    ]);

    let _currentLanguage: LanguageCode | undefined = undefined;
    export function currentLanguage() {
        _currentLanguage ??= Array.from(languages.keys())[Config.instance.languageIndex];
        return _currentLanguage;
    }

    export function defaultLanguageIndex() {
        const lang = navigator.language.toLowerCase().split(/[-_]/)[0];
        return lang === "lt" ? 1 : 0;
    }

    export function combineTranslation(language: LanguageCode, translations: Record<string, string>) {
        let local = languages.get(language);
        if (local) {
            local.translation = {
                ...local.translation,
                ...translations,
            };
        }
    }

    export function translate(key: I18nKeys, ...args: any[]) {
        let language = languages.get(currentLanguage())!;
        let text = language.translation[key] ?? languages.get("en")!.translation[key];
        if (args.length > 0) {
            text = text.replace(/\{(\d+)\}/g, (_, index) => args[index]);
        }
        return text;
    }

    export function isI18nKey(key: string): key is I18nKeys {
        return key in languages.get("en")!.translation;
    }

    const LINK_KEY = "_:_";

    export function set(dom: HTMLElement, path: I18nPath, key: I18nKeys, ...args: any[]) {
        dom[path] = translate(key, ...args);
        dom.dataset[I18nId] = `${key}${LINK_KEY}${path}`;
        if (args.length > 0) {
            I18nArgs.set(dom, args);
        }
    }

    export function changeLanguage(index: number) {
        if (index < 0 || index >= languages.size) return;

        let newLanguage = Array.from(languages.keys())[index];
        if (newLanguage === _currentLanguage) return;
        _currentLanguage = newLanguage;

        document.querySelectorAll(`[data-${I18nId}]`).forEach((e) => {
            let html = e as HTMLElement;
            let data = html?.dataset[I18nId]?.split(LINK_KEY);
            if (data?.length !== 2) return;
            let args = I18nArgs.get(html) ?? [];
            html[data[1] as I18nPath] = translate(data[0] as I18nKeys, ...args);
        });

        Config.instance.languageIndex = index;
    }
}
