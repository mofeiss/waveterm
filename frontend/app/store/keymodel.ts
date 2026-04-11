// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { WaveAIModel } from "@/app/aipanel/waveai-model";
import { confirmCloseForMultiTabBlock } from "@/app/block/block-close-confirm";
import { guardCloseForLockedBlock } from "@/app/block/block-close-guard";
import { logBlockTabExtra } from "@/app/debug/block-tab-trace";
import { FocusManager } from "@/app/store/focusManager";
import {
    atoms,
    createBlock,
    createBlockSplitHorizontally,
    createBlockSplitVertically,
    createTab,
    getAllBlockComponentModels,
    getApi,
    getBlockComponentModel,
    getFocusedBlockId,
    getSettingsKeyAtom,
    globalStore,
    recordTEvent,
    refocusNode,
    replaceBlock,
    WOS,
} from "@/app/store/global";
import { getActiveTabModel } from "@/app/store/tab-model";
import { WorkspaceLayoutModel } from "@/app/workspace/workspace-layout-model";
import { deleteLayoutModelForTab, getLayoutModelForStaticTab, NavigateDirection } from "@/layout/index";
import { findBlockId, focusedBlockId } from "@/util/focusutil";
import * as keyutil from "@/util/keyutil";
import { isWindows } from "@/util/platformutil";
import { CHORD_TIMEOUT } from "@/util/sharedconst";
import { fireAndForget } from "@/util/util";
import * as jotai from "jotai";
import { modalsModel } from "./modalmodel";
import { isBuilderWindow, isTabWindow } from "./windowtype";

type KeyHandler = (event: WaveKeyboardEvent) => boolean;

const simpleControlShiftAtom = jotai.atom(false);
const activeZoomBlockIdAtom = jotai.atom<string | null>(null) as jotai.PrimitiveAtom<string | null>;
const globalKeyMap = new Map<string, (waveEvent: WaveKeyboardEvent) => boolean>();
const globalChordMap = new Map<string, Map<string, KeyHandler>>();
let globalKeybindingsDisabled = false;
let zoomFocusTrackingRegistered = false;

// track current chord state and timeout (for resetting)
let activeChord: string | null = null;
let chordTimeout: NodeJS.Timeout = null;

function resetChord() {
    activeChord = null;
    if (chordTimeout) {
        clearTimeout(chordTimeout);
        chordTimeout = null;
    }
}

function setActiveChord(activeChordArg: string) {
    getApi().setKeyboardChordMode();
    if (chordTimeout) {
        clearTimeout(chordTimeout);
    }
    activeChord = activeChordArg;
    chordTimeout = setTimeout(() => resetChord(), CHORD_TIMEOUT);
}

export function keyboardMouseDownHandler(e: MouseEvent) {
    if (!e.ctrlKey || !e.shiftKey) {
        unsetControlShift();
    }
}

function clearPanelFocus() {
    logBlockTabExtra("clearPanelFocus", {
        activeElementTag: document.activeElement?.tagName ?? null,
        activeElementId: document.activeElement instanceof HTMLElement ? document.activeElement.id || null : null,
        focusedBlockId: focusedBlockId(),
    });
    FocusManager.getInstance().setAppFocus();
    clearActiveZoomBlockId();
    getApi().setWebviewFocus(null, null);
    if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
    }
    document.getSelection()?.removeAllRanges();
}

function getFocusedBlockInStaticTab(): string {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    return focusedNode.data?.blockId;
}

function getSimpleControlShiftAtom() {
    return simpleControlShiftAtom;
}

function setControlShift() {
    globalStore.set(simpleControlShiftAtom, true);
    const disableDisplay = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftdisplay"));
    if (!disableDisplay) {
        setTimeout(() => {
            const simpleState = globalStore.get(simpleControlShiftAtom);
            if (simpleState) {
                globalStore.set(atoms.controlShiftDelayAtom, true);
            }
        }, 400);
    }
}

function unsetControlShift() {
    globalStore.set(simpleControlShiftAtom, false);
    globalStore.set(atoms.controlShiftDelayAtom, false);
}

function disableGlobalKeybindings() {
    globalKeybindingsDisabled = true;
}

function enableGlobalKeybindings() {
    globalKeybindingsDisabled = false;
}

function shouldDispatchToBlock(e: WaveKeyboardEvent): boolean {
    if (globalStore.get(atoms.modalOpen)) {
        return false;
    }
    const activeElem = document.activeElement;
    if (activeElem != null && activeElem instanceof HTMLElement) {
        if (activeElem.tagName == "INPUT" || activeElem.tagName == "TEXTAREA" || activeElem.contentEditable == "true") {
            if (activeElem.classList.contains("dummy-focus") || activeElem.classList.contains("dummy")) {
                return true;
            }
            if (keyutil.isInputEvent(e)) {
                return false;
            }
            return true;
        }
    }
    return true;
}

function getStaticTabBlockCount(): number {
    const tabId = globalStore.get(atoms.staticTabId);
    const tabORef = WOS.makeORef("tab", tabId);
    const tabAtom = WOS.getWaveObjectAtom<Tab>(tabORef);
    const tabData = globalStore.get(tabAtom);
    return tabData?.blockids?.length ?? 0;
}

function simpleCloseStaticTab() {
    const workspaceId = globalStore.get(atoms.workspaceId);
    const tabId = globalStore.get(atoms.staticTabId);
    const confirmClose = globalStore.get(getSettingsKeyAtom("tab:confirmclose")) ?? false;
    getApi()
        .closeTab(workspaceId, tabId, confirmClose)
        .then((didClose) => {
            if (didClose) {
                deleteLayoutModelForTab(tabId);
            }
        })
        .catch((e) => {
            console.log("error closing tab", e);
        });
}

function closeBlockIgnoringLock(blockId: string) {
    const bcm = getBlockComponentModel(blockId);
    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const isAIPanelOpen = workspaceLayoutModel.getAIPanelVisible();
    fireAndForget(async () => {
        const confirmed = await confirmCloseForMultiTabBlock(blockId);
        if (!confirmed) {
            return;
        }

        if (isAIPanelOpen && getStaticTabBlockCount() === 1) {
            const aiModel = WaveAIModel.getInstance();
            const shouldSwitchToAI = !globalStore.get(aiModel.isChatEmptyAtom) || aiModel.hasNonEmptyInput();
            if (shouldSwitchToAI) {
                await bcm?.cleanupSubTabs?.();
                await replaceBlock(blockId, { meta: { view: "launcher" } }, false);
                setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
                return;
            }
        }

        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
        const blockData = globalStore.get(blockAtom);
        const isAIFileDiff = blockData?.meta?.view === "aifilediff";

        // If this is the last block, closing it will close the tab — route through simpleCloseStaticTab
        // so the tab:confirmclose setting is respected.
        if (getStaticTabBlockCount() === 1) {
            await bcm?.cleanupSubTabs?.();
            simpleCloseStaticTab();
            return;
        }

        const layoutModel = getLayoutModelForStaticTab();
        const node = layoutModel.getNodeByBlockId(blockId);
        if (node) {
            await bcm?.cleanupSubTabs?.();
            await layoutModel.closeNode(node.id);

            if (isAIFileDiff && isAIPanelOpen) {
                setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
            }
        }
    });
}

function uxCloseBlock(blockId: string) {
    if (guardCloseForLockedBlock(blockId)) {
        return;
    }
    closeBlockIgnoringLock(blockId);
}

function genericClose() {
    const focusType = FocusManager.getInstance().getFocusType();
    if (focusType === "waveai") {
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(false);
        return;
    }

    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    const focusedBlockId = focusedNode?.data?.blockId;
    if (focusedBlockId != null && guardCloseForLockedBlock(focusedBlockId)) {
        return;
    }

    const workspaceLayoutModel = WorkspaceLayoutModel.getInstance();
    const isAIPanelOpen = workspaceLayoutModel.getAIPanelVisible();
    if (isAIPanelOpen && getStaticTabBlockCount() === 1) {
        const aiModel = WaveAIModel.getInstance();
        const shouldSwitchToAI = !globalStore.get(aiModel.isChatEmptyAtom) || aiModel.hasNonEmptyInput();
        if (shouldSwitchToAI) {
            if (focusedNode) {
                const bcm = getBlockComponentModel(focusedNode.data.blockId);
                fireAndForget(async () => {
                    const confirmed = await confirmCloseForMultiTabBlock(focusedNode.data.blockId);
                    if (!confirmed) {
                        return;
                    }
                    await bcm?.cleanupSubTabs?.();
                    await replaceBlock(focusedNode.data.blockId, { meta: { view: "launcher" } }, false);
                    setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
                });
                return;
            }
        }
    }
    const blockCount = getStaticTabBlockCount();
    if (blockCount === 0) {
        simpleCloseStaticTab();
        return;
    }

    // If this is the last block, closing it will close the tab — route through simpleCloseStaticTab
    // so the tab:confirmclose setting is respected.
    if (blockCount === 1) {
        const bcm = focusedBlockId != null ? getBlockComponentModel(focusedBlockId) : null;
        fireAndForget(async () => {
            if (focusedBlockId != null) {
                const confirmed = await confirmCloseForMultiTabBlock(focusedBlockId);
                if (!confirmed) {
                    return;
                }
            }
            await bcm?.cleanupSubTabs?.();
            simpleCloseStaticTab();
        });
        return;
    }

    const blockId = focusedNode?.data?.blockId;
    const blockAtom = blockId ? WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId)) : null;
    const blockData = blockAtom ? globalStore.get(blockAtom) : null;
    const isAIFileDiff = blockData?.meta?.view === "aifilediff";

    fireAndForget(async () => {
        if (blockId != null) {
            const confirmed = await confirmCloseForMultiTabBlock(blockId);
            if (!confirmed) {
                return;
            }
            const bcm = getBlockComponentModel(blockId);
            await bcm?.cleanupSubTabs?.();
        }
        await layoutModel.closeFocusedNode.bind(layoutModel)();
    });

    if (isAIFileDiff && isAIPanelOpen) {
        setTimeout(() => WaveAIModel.getInstance().focusInput(), 50);
    }
}

function switchBlockByBlockNum(index: number) {
    const layoutModel = getLayoutModelForStaticTab();
    if (!layoutModel) {
        return;
    }
    layoutModel.switchNodeFocusByBlockNum(index);
    setTimeout(() => {
        globalRefocus();
    }, 10);
}

function switchBlockInDirection(direction: NavigateDirection) {
    const layoutModel = getLayoutModelForStaticTab();
    const focusType = FocusManager.getInstance().getFocusType();

    if (direction === NavigateDirection.Left) {
        const numBlocks = globalStore.get(layoutModel.numLeafs);
        if (focusType === "waveai") {
            return;
        }
        if (numBlocks === 1) {
            FocusManager.getInstance().requestWaveAIFocus();
            setTimeout(() => {
                FocusManager.getInstance().refocusNode();
            }, 10);
            return;
        }
    }

    if (direction === NavigateDirection.Right && focusType === "waveai") {
        FocusManager.getInstance().requestNodeFocus();
        return;
    }

    const inWaveAI = focusType === "waveai";
    const navResult = layoutModel.switchNodeFocusInDirection(direction, inWaveAI);
    if (navResult.atLeft) {
        FocusManager.getInstance().requestWaveAIFocus();
        setTimeout(() => {
            FocusManager.getInstance().refocusNode();
        }, 10);
        return;
    }
    setTimeout(() => {
        globalRefocus();
    }, 10);
}

function getAllTabs(ws: Workspace): string[] {
    return ws.tabids ?? [];
}

function switchTabAbs(index: number) {
    console.log("switchTabAbs", index);
    const ws = globalStore.get(atoms.workspace);
    const newTabIdx = index - 1;
    const tabids = getAllTabs(ws);
    if (newTabIdx < 0 || newTabIdx >= tabids.length) {
        return;
    }
    const newActiveTabId = tabids[newTabIdx];
    getApi().setActiveTab(newActiveTabId);
}

function switchTab(offset: number) {
    console.log("switchTab", offset);
    const ws = globalStore.get(atoms.workspace);
    const curTabId = globalStore.get(atoms.staticTabId);
    let tabIdx = -1;
    const tabids = getAllTabs(ws);
    for (let i = 0; i < tabids.length; i++) {
        if (tabids[i] == curTabId) {
            tabIdx = i;
            break;
        }
    }
    if (tabIdx == -1) {
        return;
    }
    const newTabIdx = (tabIdx + offset + tabids.length) % tabids.length;
    const newActiveTabId = tabids[newTabIdx];
    getApi().setActiveTab(newActiveTabId);
}

function handleCmdI() {
    globalRefocus();
}

function globalRefocusWithTimeout(timeoutVal: number) {
    setTimeout(() => {
        globalRefocus();
    }, timeoutVal);
}

function globalRefocus() {
    if (isBuilderWindow()) {
        return;
    }

    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        // focus a node
        layoutModel.focusFirstNode();
        return;
    }
    const blockId = focusedNode?.data?.blockId;
    if (blockId == null) {
        return;
    }
    refocusNode(blockId);
}

function getDefaultNewBlockDef(): BlockDef {
    const adnbAtom = getSettingsKeyAtom("app:defaultnewblock");
    const adnb = globalStore.get(adnbAtom) ?? "term";
    if (adnb == "launcher") {
        return {
            meta: {
                view: "launcher",
            },
        };
    }
    // "term", blank, anything else, fall back to terminal
    const termBlockDef: BlockDef = {
        meta: {
            view: "term",
            controller: "shell",
        },
    };
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode != null) {
        const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", focusedNode.data?.blockId));
        const blockData = globalStore.get(blockAtom);
        if (blockData?.meta?.view == "term") {
            if (blockData?.meta?.["cmd:cwd"] != null) {
                termBlockDef.meta["cmd:cwd"] = blockData.meta["cmd:cwd"];
            }
        }
        if (blockData?.meta?.connection != null) {
            termBlockDef.meta.connection = blockData.meta.connection;
        }
    }
    return termBlockDef;
}

async function handleCmdN() {
    const blockDef = getDefaultNewBlockDef();
    await createBlock(blockDef);
}

async function handleSplitHorizontal(position: "before" | "after") {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        return;
    }
    const blockDef = getDefaultNewBlockDef();
    await createBlockSplitHorizontally(blockDef, focusedNode.data.blockId, position);
}

async function handleSplitVertical(position: "before" | "after") {
    const layoutModel = getLayoutModelForStaticTab();
    const focusedNode = globalStore.get(layoutModel.focusedNode);
    if (focusedNode == null) {
        return;
    }
    const blockDef = getDefaultNewBlockDef();
    await createBlockSplitVertically(blockDef, focusedNode.data.blockId, position);
}

let lastHandledEvent: KeyboardEvent | null = null;

// returns [keymatch, T]
function checkKeyMap<T>(waveEvent: WaveKeyboardEvent, keyMap: Map<string, T>): [string, T] {
    for (const key of keyMap.keys()) {
        if (keyutil.checkKeyPressed(waveEvent, key)) {
            const val = keyMap.get(key);
            return [key, val];
        }
    }
    return [null, null];
}

function appHandleKeyDown(waveEvent: WaveKeyboardEvent): boolean {
    if (globalKeybindingsDisabled) {
        return false;
    }
    const nativeEvent = (waveEvent as any).nativeEvent;
    if (lastHandledEvent != null && nativeEvent != null && lastHandledEvent === nativeEvent) {
        return false;
    }
    lastHandledEvent = nativeEvent;
    if (isTabWindow()) {
        const focusedBlockId = getFocusedBlockId();
        const focusedBcm = focusedBlockId != null ? getBlockComponentModel(focusedBlockId) : null;
        if (focusedBcm?.cycleSubTab != null && keyutil.checkKeyPressed(waveEvent, "Ctrl:Tab")) {
            return focusedBcm.cycleSubTab();
        }
    }
    if (activeChord) {
        console.log("handle activeChord", activeChord);
        // If we're in chord mode, look for the second key.
        const chordBindings = globalChordMap.get(activeChord);
        const [, handler] = checkKeyMap(waveEvent, chordBindings);
        if (handler) {
            resetChord();
            return handler(waveEvent);
        } else {
            // invalid chord; reset state and consume key
            resetChord();
            return true;
        }
    }
    const [chordKeyMatch] = checkKeyMap(waveEvent, globalChordMap);
    if (chordKeyMatch) {
        setActiveChord(chordKeyMatch);
        return true;
    }

    const [, globalHandler] = checkKeyMap(waveEvent, globalKeyMap);
    if (globalHandler) {
        const handled = globalHandler(waveEvent);
        if (handled) {
            return true;
        }
    }
    if (isTabWindow()) {
        const layoutModel = getLayoutModelForStaticTab();
        const focusedNode = globalStore.get(layoutModel.focusedNode);
        const blockId = focusedNode?.data?.blockId;
        if (blockId != null && shouldDispatchToBlock(waveEvent)) {
            const bcm = getBlockComponentModel(blockId);
            const viewModel = bcm?.getActiveViewModel?.() ?? bcm?.viewModel;
            if (viewModel?.keyDownHandler) {
                const handledByBlock = viewModel.keyDownHandler(waveEvent);
                if (handledByBlock) {
                    return true;
                }
            }
        }
    }
    return false;
}

function registerControlShiftStateUpdateHandler() {
    getApi().onControlShiftStateUpdate((state: boolean) => {
        if (state) {
            setControlShift();
        } else {
            unsetControlShift();
        }
    });
}

function registerElectronReinjectKeyHandler() {
    getApi().onReinjectKey((event: WaveKeyboardEvent) => {
        appHandleKeyDown(event);
    });
}

function tryReinjectKey(event: WaveKeyboardEvent): boolean {
    return appHandleKeyDown(event);
}

function getZoomTargetBlockId(explicitBlockId?: string | null): string | null {
    if (explicitBlockId != null) {
        return explicitBlockId;
    }
    const activeZoomBlockId = globalStore.get(activeZoomBlockIdAtom);
    if (activeZoomBlockId != null) {
        return activeZoomBlockId;
    }
    const domFocusedBlockId = focusedBlockId();
    if (domFocusedBlockId != null) {
        return domFocusedBlockId;
    }
    return null;
}

async function handleZoomCommand(direction: ZoomCommandDirection, explicitBlockId?: string | null): Promise<void> {
    const blockId = getZoomTargetBlockId(explicitBlockId);
    if (blockId != null) {
        const bcm = getBlockComponentModel(blockId);
        const handled = bcm?.viewModel?.applyZoomCommand?.(direction);
        if (handled) {
            return;
        }
    }
    await getApi().applyWindowZoomCommand(direction);
}

function registerZoomCommandHandler() {
    registerZoomFocusTracking();
    getApi().onZoomCommand((direction: ZoomCommandDirection, blockId?: string | null) => {
        fireAndForget(() => handleZoomCommand(direction, blockId));
    });
}

function updateActiveZoomBlockIdFromTarget(target: EventTarget | null) {
    let elem: HTMLElement = null;
    if (target instanceof HTMLElement) {
        elem = target;
    } else if (target instanceof Text) {
        elem = target.parentElement;
    }
    setActiveZoomBlockId(elem != null ? findBlockId(elem) : null);
}

function registerZoomFocusTracking() {
    if (zoomFocusTrackingRegistered) {
        return;
    }
    zoomFocusTrackingRegistered = true;
    document.addEventListener(
        "focusin",
        (event) => {
            updateActiveZoomBlockIdFromTarget(event.target);
        },
        true
    );
    document.addEventListener(
        "pointerdown",
        (event) => {
            updateActiveZoomBlockIdFromTarget(event.target);
        },
        true
    );
}

function setActiveZoomBlockId(blockId: string | null) {
    globalStore.set(activeZoomBlockIdAtom, blockId);
}

function clearActiveZoomBlockId(blockId?: string) {
    if (blockId == null || globalStore.get(activeZoomBlockIdAtom) === blockId) {
        globalStore.set(activeZoomBlockIdAtom, null);
    }
}

function countTermBlocks(): number {
    const allBCMs = getAllBlockComponentModels();
    let count = 0;
    const gsGetBound = globalStore.get.bind(globalStore);
    for (const bcm of allBCMs) {
        const viewModel = bcm.viewModel;
        if (viewModel.viewType == "term" && viewModel.isBasicTerm?.(gsGetBound)) {
            count++;
        }
    }
    return count;
}

function registerGlobalKeys() {
    globalKeyMap.set("Cmd:]", () => {
        switchTab(1);
        return true;
    });
    globalKeyMap.set("Shift:Cmd:]", () => {
        switchTab(1);
        return true;
    });
    globalKeyMap.set("Cmd:[", () => {
        switchTab(-1);
        return true;
    });
    globalKeyMap.set("Shift:Cmd:[", () => {
        switchTab(-1);
        return true;
    });
    globalKeyMap.set("Cmd:n", () => {
        handleCmdN();
        return true;
    });
    globalKeyMap.set("Cmd:d", () => {
        handleSplitHorizontal("after");
        return true;
    });
    globalKeyMap.set("Shift:Cmd:d", () => {
        handleSplitVertical("after");
        return true;
    });
    globalKeyMap.set("Cmd:i", () => {
        handleCmdI();
        return true;
    });
    globalKeyMap.set("Cmd:t", () => {
        createTab();
        return true;
    });
    globalKeyMap.set("Cmd:w", () => {
        genericClose();
        return true;
    });
    globalKeyMap.set("Cmd:Shift:w", () => {
        simpleCloseStaticTab();
        return true;
    });
    globalKeyMap.set("Cmd:m", () => {
        const layoutModel = getLayoutModelForStaticTab();
        const focusedNode = globalStore.get(layoutModel.focusedNode);
        if (focusedNode != null) {
            layoutModel.magnifyNodeToggle(focusedNode.id);
        }
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowUp", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Up);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowDown", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Down);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowLeft", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Left);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:ArrowRight", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Right);
        return true;
    });
    // Vim-style aliases for block focus navigation.
    globalKeyMap.set("Ctrl:Shift:h", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Left);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:j", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Down);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:k", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Up);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:l", () => {
        const disableCtrlShiftArrows = globalStore.get(getSettingsKeyAtom("app:disablectrlshiftarrows"));
        if (disableCtrlShiftArrows) {
            return false;
        }
        switchBlockInDirection(NavigateDirection.Right);
        return true;
    });
    globalKeyMap.set("Ctrl:Shift:x", () => {
        const blockId = getFocusedBlockId();
        if (blockId == null) {
            return true;
        }
        replaceBlock(
            blockId,
            {
                meta: {
                    view: "launcher",
                },
            },
            true
        );
        return true;
    });
    globalKeyMap.set("F2", () => {
        const tabModel = getActiveTabModel();
        if (tabModel?.startRenameCallback != null) {
            tabModel.startRenameCallback();
            return true;
        }
        return false;
    });
    globalKeyMap.set("Cmd:g", () => {
        const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
        if (bcm.openSwitchConnection != null) {
            recordTEvent("action:other", { "action:type": "conndropdown", "action:initiator": "keyboard" });
            bcm.openSwitchConnection();
            return true;
        }
    });
    globalKeyMap.set("Ctrl:Shift:i", () => {
        const tabModel = getActiveTabModel();
        if (tabModel == null) {
            return true;
        }
        const curMI = globalStore.get(tabModel.isTermMultiInput);
        if (!curMI && countTermBlocks() <= 1) {
            // don't turn on multi-input unless there are 2 or more basic term blocks
            return true;
        }
        globalStore.set(tabModel.isTermMultiInput, !curMI);
        return true;
    });
    for (let idx = 1; idx <= 9; idx++) {
        globalKeyMap.set(`Cmd:${idx}`, () => {
            switchTabAbs(idx);
            return true;
        });
        globalKeyMap.set(`Ctrl:Shift:c{Digit${idx}}`, () => {
            switchBlockByBlockNum(idx);
            return true;
        });
        globalKeyMap.set(`Ctrl:Shift:c{Numpad${idx}}`, () => {
            switchBlockByBlockNum(idx);
            return true;
        });
    }
    if (isWindows()) {
        globalKeyMap.set("Alt:c{Digit0}", () => {
            WaveAIModel.getInstance().focusInput();
            return true;
        });
        globalKeyMap.set("Alt:c{Numpad0}", () => {
            WaveAIModel.getInstance().focusInput();
            return true;
        });
    } else {
        globalKeyMap.set("Ctrl:Shift:c{Digit0}", () => {
            WaveAIModel.getInstance().focusInput();
            return true;
        });
        globalKeyMap.set("Ctrl:Shift:c{Numpad0}", () => {
            WaveAIModel.getInstance().focusInput();
            return true;
        });
    }
    function activateSearch(event: WaveKeyboardEvent): boolean {
        const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
        const viewModel = bcm?.getActiveViewModel?.() ?? bcm?.viewModel;
        // Ctrl+f is reserved in most shells
        if (event.control && viewModel?.viewType == "term") {
            return false;
        }
        if (viewModel?.searchAtoms) {
            if (globalStore.get(viewModel.searchAtoms.isOpen)) {
                // Already open — increment the focusInput counter so this block's
                // SearchComponent focuses its own input (avoids a global DOM query
                // that could target the wrong block when multiple searches are open).
                const cur = globalStore.get(viewModel.searchAtoms.focusInput) as number;
                globalStore.set(viewModel.searchAtoms.focusInput, cur + 1);
            } else {
                globalStore.set(viewModel.searchAtoms.isOpen, true);
            }
            return true;
        }
        return false;
    }
    function deactivateSearch(): boolean {
        const bcm = getBlockComponentModel(getFocusedBlockInStaticTab());
        const viewModel = bcm?.getActiveViewModel?.() ?? bcm?.viewModel;
        if (viewModel?.searchAtoms && globalStore.get(viewModel.searchAtoms.isOpen)) {
            globalStore.set(viewModel.searchAtoms.isOpen, false);
            return true;
        }
        return false;
    }
    globalKeyMap.set("Cmd:f", activateSearch);
    globalKeyMap.set("Escape", () => {
        if (modalsModel.hasOpenModals()) {
            modalsModel.popModal();
            return true;
        }
        if (deactivateSearch()) {
            return true;
        }
        return false;
    });
    globalKeyMap.set("Cmd:Shift:a", () => {
        const currentVisible = WorkspaceLayoutModel.getInstance().getAIPanelVisible();
        WorkspaceLayoutModel.getInstance().setAIPanelVisible(!currentVisible);
        return true;
    });
    const allKeys = Array.from(globalKeyMap.keys());
    // special case keys, handled by web view
    allKeys.push("Cmd:l", "Cmd:r", "Cmd:ArrowRight", "Cmd:ArrowLeft", "Cmd:o", "Ctrl:Tab");
    getApi().registerGlobalWebviewKeys(allKeys);

    const splitBlockKeys = new Map<string, KeyHandler>();
    splitBlockKeys.set("ArrowUp", () => {
        handleSplitVertical("before");
        return true;
    });
    splitBlockKeys.set("ArrowDown", () => {
        handleSplitVertical("after");
        return true;
    });
    splitBlockKeys.set("ArrowLeft", () => {
        handleSplitHorizontal("before");
        return true;
    });
    splitBlockKeys.set("ArrowRight", () => {
        handleSplitHorizontal("after");
        return true;
    });
    globalChordMap.set("Ctrl:Shift:s", splitBlockKeys);
}

function registerBuilderGlobalKeys() {
    globalKeyMap.set("Cmd:w", () => {
        getApi().closeBuilderWindow();
        return true;
    });
    const allKeys = Array.from(globalKeyMap.keys());
    getApi().registerGlobalWebviewKeys(allKeys);
}

function getAllGlobalKeyBindings(): string[] {
    const allKeys = Array.from(globalKeyMap.keys());
    return allKeys;
}

export {
    appHandleKeyDown,
    clearActiveZoomBlockId,
    clearPanelFocus,
    closeBlockIgnoringLock,
    disableGlobalKeybindings,
    enableGlobalKeybindings,
    getSimpleControlShiftAtom,
    globalRefocus,
    globalRefocusWithTimeout,
    registerBuilderGlobalKeys,
    registerControlShiftStateUpdateHandler,
    registerElectronReinjectKeyHandler,
    registerGlobalKeys,
    registerZoomCommandHandler,
    setActiveZoomBlockId,
    tryReinjectKey,
    unsetControlShift,
    uxCloseBlock,
};
