// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore } from "@/app/store/jotaiStore";
import { makeMockWaveEnv } from "@/preview/mock/mockwaveenv";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { atom } from "jotai";
import { getWebPreviewDisplayUrl, WebViewModel, WebViewPreviewFallback } from "./webview";

describe("webview preview fallback", () => {
    it("shows the requested URL", () => {
        const markup = renderToStaticMarkup(<WebViewPreviewFallback url="https://waveterm.dev/docs" />);

        expect(markup).toContain("electron webview unavailable");
        expect(markup).toContain("https://waveterm.dev/docs");
    });

    it("falls back to about:blank when no URL is available", () => {
        expect(getWebPreviewDisplayUrl("")).toBe("about:blank");
        expect(getWebPreviewDisplayUrl(null)).toBe("about:blank");
    });

    it("treats blank URLs as about:blank instead of a search query", () => {
        const env = makeMockWaveEnv();
        const model = new WebViewModel({
            blockId: "webview-blank-url",
            nodeModel: {
                isFocused: atom(true),
                focusNode: () => {},
            } as any,
            tabModel: {} as any,
            waveEnv: env,
        });

        expect(model.ensureUrlScheme("", null)).toBe("about:blank");
        expect(model.ensureUrlScheme("about:blank", null)).toBe("about:blank");
    });

    it("keeps about:blank out of the address bar state", () => {
        const blockId = "webview-addressbar-blank";
        const env = makeMockWaveEnv({
            mockWaveObjs: {
                [`block:${blockId}`]: {
                    otype: "block",
                    oid: blockId,
                    version: 1,
                    meta: {
                        view: "web",
                        url: "about:blank",
                    },
                } as Block,
            },
        });
        const model = new WebViewModel({
            blockId,
            nodeModel: {
                isFocused: atom(true),
                focusNode: () => {},
            } as any,
            tabModel: {} as any,
            waveEnv: env,
        });

        expect(model.getUrl()).toBe("");
    });

    it("uses the supplied env for homepage atoms and config updates", async () => {
        const blockId = "webview-env-block";
        const env = makeMockWaveEnv({
            settings: {
                "web:defaulturl": "https://default.example",
            },
            mockWaveObjs: {
                [`block:${blockId}`]: {
                    otype: "block",
                    oid: blockId,
                    version: 1,
                    meta: {
                        pinnedurl: "https://block.example",
                    },
                } as Block,
            },
        });
        const model = new WebViewModel({
            blockId,
            nodeModel: {
                isFocused: atom(true),
                focusNode: () => {},
            } as any,
            tabModel: {} as any,
            waveEnv: env,
        });

        expect(globalStore.get(model.homepageUrl)).toBe("https://block.example");

        await model.setHomepageUrl("https://global.example", "global");

        expect(globalStore.get(model.homepageUrl)).toBe("https://global.example");
        expect(globalStore.get(env.getSettingsKeyAtom("web:defaulturl"))).toBe("https://global.example");
        expect(globalStore.get(env.wos.getWaveObjectAtom<Block>(`block:${blockId}`))?.meta?.pinnedurl).toBeUndefined();
    });

    it("synchronizes block focus with native webview focus when giveFocus succeeds", () => {
        const blockId = "webview-focus-sync";
        const setWebviewFocus = vi.fn();
        const focusNode = vi.fn();
        const env = makeMockWaveEnv({
            electron: {
                setWebviewFocus,
            } as Partial<ElectronApi>,
        });
        const model = new WebViewModel({
            blockId,
            nodeModel: {
                isFocused: atom(false),
                focusNode,
            } as any,
            tabModel: {} as any,
            waveEnv: env,
        });
        const focusNativeWebview = vi.fn();
        (model.webviewRef as any).current = {
            focus: focusNativeWebview,
            getWebContentsId: () => 42,
        };
        model.autoFocusUrlInputPending = false;

        expect(model.giveFocus()).toBe(true);
        expect(focusNativeWebview).toHaveBeenCalledOnce();
        expect(focusNode).toHaveBeenCalledOnce();
        expect(setWebviewFocus).toHaveBeenCalledWith(42, blockId);
    });
});
