// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { SubBlock } from "@/app/block/block";
import { blockViewToName } from "@/app/block/blockutil";
import { getBlockComponentModel, refocusNode, WOS } from "@/app/store/global";
import { clearPanelFocus } from "@/app/store/keymodel";
import { ObjectService } from "@/app/store/services";
import { RpcApi } from "@/app/store/wshclientapi";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { useWaveEnv } from "@/app/waveenv/waveenv";
import { getLayoutModelForStaticTab, LayoutTreeActionType, newLayoutNode } from "@/layout/index";
import type { LayoutTreeReplaceNodeAction } from "@/layout/lib/types";
import { makeIconClass } from "@/util/util";
import * as jotai from "jotai";
import * as React from "react";
import { BlockTabTrace, endBlockTabTrace, logBlockTabTrace, startBlockTabTrace } from "../debug/block-tab-trace";
import { BlockEnv } from "./blockenv";
import {
    deriveBlockTabReorderState,
    deriveBlockTabRootCloseState,
    getMountedBlockTabIds,
    resolveBlockTabViewModel,
    ROOT_TAB_ID,
} from "./block-tabs-util";
import { BlockNodeModel } from "./blocktypes";
const BLOCK_TABS_IDS_METAKEY = "blocktabs:ids";
const BLOCK_TABS_ACTIVE_METAKEY = "blocktabs:activeid";
const SUPPORTED_BLOCK_TAB_VIEWS = new Set(["term", "web", "preview"]);
const MAX_TAB_NAME_LENGTH = 24;
const BLOCK_TAB_DRAG_THRESHOLD_PX = 8;

function supportsBlockTabs(view: string | null | undefined): boolean {
    return view != null && SUPPORTED_BLOCK_TAB_VIEWS.has(view);
}

function getBlockTabLabel(view: string | null | undefined): string {
    if (view === "preview") {
        return "Files";
    }
    return blockViewToName(view ?? "");
}

function getBlockTabIcon(view: string | null | undefined): string {
    if (view === "preview") {
        return "folder";
    }
    if (view === "web") {
        return "globe";
    }
    if (view === "term") {
        return "terminal";
    }
    return "square";
}

function getTabDisplayInfo(blockData: Block | null | undefined): { title: string; icon: string } {
    const view = blockData?.meta?.view;
    const title = blockData?.meta?.["frame:title"] ?? getBlockTabLabel(view);
    const icon = blockData?.meta?.["frame:icon"] ?? getBlockTabIcon(view);
    return { title, icon };
}

function blockTabIdsEqual(a: string[], b: string[]): boolean {
    if (a === b) {
        return true;
    }
    if (a.length !== b.length) {
        return false;
    }
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) {
            return false;
        }
    }
    return true;
}

function makeTabBlockDef(view: "term" | "web" | "preview", sourceMeta: MetaType | undefined): BlockDef {
    if (view === "term") {
        const meta: MetaType = {
            view: "term",
            controller: "shell",
        };
        if (sourceMeta?.connection != null) {
            meta.connection = sourceMeta.connection;
        }
        if (sourceMeta?.view === "term" && sourceMeta["cmd:cwd"] != null) {
            meta["cmd:cwd"] = sourceMeta["cmd:cwd"];
        }
        return { meta };
    }
    if (view === "web") {
        return { meta: { view: "web" } };
    }
    const meta: MetaType = {
        view: "preview",
        connection: sourceMeta?.connection ?? "local",
    };
    if (sourceMeta?.view === "term" && sourceMeta["cmd:cwd"] != null) {
        meta.file = sourceMeta["cmd:cwd"];
    } else if (sourceMeta?.view === "preview" && sourceMeta.file != null) {
        meta.file = sourceMeta.file;
    }
    return { meta };
}

type BlockHeaderTabProps = {
    targetBlockId: string;
    active: boolean;
    canClose: boolean;
    dragging?: boolean;
    onSelect: (trace?: BlockTabTrace) => void;
    onActivePress?: (trace?: BlockTabTrace) => void;
    onClose?: () => void;
    onRename: (newName: string) => void;
    onPressStart?: (event: React.MouseEvent<HTMLDivElement>, trace: BlockTabTrace) => void;
    tabRef?: React.RefObject<HTMLDivElement>;
};

const BlockHeaderTab = React.memo(
    ({
        targetBlockId,
        active,
        canClose,
        dragging,
        onSelect,
        onActivePress,
        onClose,
        onRename,
        onPressStart,
        tabRef,
    }: BlockHeaderTabProps) => {
        const waveEnv = useWaveEnv<BlockEnv>();
        const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", targetBlockId));
        const { title, icon } = getTabDisplayInfo(blockData);
        const [originalName, setOriginalName] = React.useState(title);
        const [isEditable, setIsEditable] = React.useState(false);
        const editableRef = React.useRef<HTMLDivElement>(null);
        const renameTimeoutRef = React.useRef<NodeJS.Timeout>(null);
        const selectedOnMouseDownRef = React.useRef(false);
        const clickTraceRef = React.useRef<BlockTabTrace | null>(null);

        React.useEffect(() => {
            setOriginalName(title);
            if (editableRef.current != null && !isEditable) {
                editableRef.current.innerText = title;
            }
        }, [title, isEditable]);

        React.useEffect(() => {
            return () => {
                if (renameTimeoutRef.current != null) {
                    clearTimeout(renameTimeoutRef.current);
                }
            };
        }, []);

        const selectEditableText = React.useCallback(() => {
            if (editableRef.current == null) {
                return;
            }
            editableRef.current.focus();
            const selection = window.getSelection();
            if (selection == null) {
                return;
            }
            const range = document.createRange();
            range.selectNodeContents(editableRef.current);
            selection.removeAllRanges();
            selection.addRange(range);
        }, []);

        const startRename = React.useCallback(() => {
            setIsEditable(true);
            renameTimeoutRef.current = setTimeout(() => {
                selectEditableText();
            }, 30);
        }, [selectEditableText]);

        const finishRename = React.useCallback(() => {
            if (editableRef.current == null) {
                return;
            }
            let nextName = editableRef.current.innerText.trim();
            if (nextName === "") {
                nextName = originalName;
            }
            editableRef.current.innerText = nextName;
            setIsEditable(false);
            onRename(nextName);
        }, [onRename, originalName]);

        const handleKeyDown = React.useCallback(
            (event: React.KeyboardEvent<HTMLDivElement>) => {
                if (event.key === "Enter") {
                    event.preventDefault();
                    event.stopPropagation();
                    finishRename();
                    editableRef.current?.blur();
                    return;
                }
                if (event.key === "Escape") {
                    event.preventDefault();
                    event.stopPropagation();
                    if (editableRef.current != null) {
                        editableRef.current.innerText = originalName;
                    }
                    setIsEditable(false);
                    editableRef.current?.blur();
                    return;
                }
                if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "a") {
                    event.preventDefault();
                    selectEditableText();
                    return;
                }
                if (editableRef.current == null) {
                    return;
                }
                const selection = window.getSelection();
                const curLen = Array.from(editableRef.current.innerText).length;
                if (
                    curLen >= MAX_TAB_NAME_LENGTH &&
                    !["Backspace", "Delete", "ArrowLeft", "ArrowRight", "Home", "End", "Tab"].includes(event.key) &&
                    (selection == null || selection.isCollapsed)
                ) {
                    event.preventDefault();
                    event.stopPropagation();
                }
            },
            [finishRename, originalName, selectEditableText]
        );

        const handleContextMenu = React.useCallback(
            (e: React.MouseEvent<HTMLDivElement>) => {
                e.preventDefault();
                const menu: ContextMenuItem[] = [{ label: "Rename Tab", click: () => startRename() }];
                if (canClose) {
                    menu.push({ type: "separator" }, { label: "Close Tab", click: () => onClose?.() });
                }
                waveEnv.showContextMenu(menu, e);
            },
            [canClose, onClose, startRename, waveEnv]
        );

        const handleMouseDown = React.useCallback(
            (e: React.MouseEvent<HTMLDivElement>) => {
                selectedOnMouseDownRef.current = false;
                if (e.button !== 0) {
                    return;
                }
                const trace = startBlockTabTrace("block-header-tab.mousedown", {
                    targetBlockId,
                    active,
                    canClose,
                    title,
                });
                clickTraceRef.current = trace;
                // Keep this interaction inside the block-tab controller instead of letting the browser
                // blur/refocus the active webview first, which can swallow the initial tab switch click.
                e.preventDefault();
                e.stopPropagation();
                logBlockTabTrace(trace, "mousedown prevented default and propagation");
                if (onPressStart != null) {
                    selectedOnMouseDownRef.current = true;
                    logBlockTabTrace(trace, "delegating mousedown to press-start handler", {
                        active,
                    });
                    onPressStart(e, trace);
                    return;
                }
                if (!active) {
                    logBlockTabTrace(trace, "inactive tab -> invoking onSelect from mousedown");
                    onSelect(trace);
                    selectedOnMouseDownRef.current = true;
                    return;
                }
                logBlockTabTrace(trace, "active tab -> clearPanelFocus");
                onActivePress?.(trace);
                selectedOnMouseDownRef.current = true;
            },
            [active, canClose, onActivePress, onPressStart, onSelect, targetBlockId, title]
        );

        const handleClick = React.useCallback(
            (e: React.MouseEvent<HTMLDivElement>) => {
                e.stopPropagation();
                const trace = clickTraceRef.current;
                logBlockTabTrace(trace, "click handler entered", {
                    selectedOnMouseDown: selectedOnMouseDownRef.current,
                });
                if (selectedOnMouseDownRef.current) {
                    selectedOnMouseDownRef.current = false;
                    logBlockTabTrace(trace, "click ignored because selection already handled on mousedown");
                    return;
                }
                logBlockTabTrace(trace, "click invoking onSelect");
                onSelect(trace ?? undefined);
            },
            [onSelect]
        );

        return (
            <div
                ref={tabRef}
                className={`block-frame-tab ${active ? "active" : ""} ${canClose ? "closable" : "fixed-tab"}`}
                data-block-tabid={targetBlockId}
                data-block-tab-dragging={dragging ? "true" : undefined}
                onMouseDown={handleMouseDown}
                onClick={handleClick}
                onContextMenu={handleContextMenu}
                title={title}
            >
                <i className={makeIconClass(icon, true, { defaultIcon: "square" })} />
                <div
                    ref={editableRef}
                    className={`block-frame-tab-title ${isEditable ? "editing" : ""}`}
                    contentEditable={isEditable}
                    suppressContentEditableWarning={true}
                    onDoubleClick={(e) => {
                        e.stopPropagation();
                        startRename();
                    }}
                    onBlur={finishRename}
                    onKeyDown={handleKeyDown}
                >
                    {title}
                </div>
                {canClose && (
                    <button
                        type="button"
                        className="block-frame-tab-close"
                        title="Close Tab"
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose?.();
                        }}
                        onMouseDown={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                        }}
                    >
                        <i className="fa fa-solid fa-xmark" />
                    </button>
                )}
            </div>
        );
    }
);
BlockHeaderTab.displayName = "BlockHeaderTab";

type BlockHeaderTabsProps = {
    rootBlockId: string;
    childTabIds: string[];
    activeTabId: string;
    onSelectTab: (tabId: string, trace?: BlockTabTrace) => void;
    onActiveTabPress: (tabId: string, trace?: BlockTabTrace) => void;
    onCloseTab: (tabId: string) => void;
    onRenameTab: (tabId: string, newName: string) => void;
    onReorderTabs: (nextOrderedBlockIds: string[]) => Promise<void> | void;
};

const BlockHeaderTabs = React.memo(
    ({
        rootBlockId,
        childTabIds,
        activeTabId,
        onSelectTab,
        onActiveTabPress,
        onCloseTab,
        onRenameTab,
        onReorderTabs,
    }: BlockHeaderTabsProps) => {
        const [previewOrderedTabIds, setPreviewOrderedTabIds] = React.useState<string[] | null>(null);
        const tabRefs = React.useRef(new Map<string, React.RefObject<HTMLDivElement>>());
        const onReorderTabsRef = React.useRef(onReorderTabs);
        const displayedOrderedTabIds = previewOrderedTabIds ?? [rootBlockId, ...childTabIds];
        const dragStateRef = React.useRef<{
            draggedTabId: string | null;
            startX: number;
            startY: number;
            dragged: boolean;
            wasActive: boolean;
            trace: BlockTabTrace | null;
            currentOrder: string[];
            initialOrder: string[];
            initialCenters: Record<string, number>;
        }>({
            draggedTabId: null,
            startX: 0,
            startY: 0,
            dragged: false,
            wasActive: false,
            trace: null,
            currentOrder: [rootBlockId, ...childTabIds],
            initialOrder: [rootBlockId, ...childTabIds],
            initialCenters: {},
        });

        React.useEffect(() => {
            onReorderTabsRef.current = onReorderTabs;
        }, [onReorderTabs]);

        const getTabRef = React.useCallback((tabId: string) => {
            let ref = tabRefs.current.get(tabId);
            if (ref == null) {
                ref = React.createRef<HTMLDivElement>();
                tabRefs.current.set(tabId, ref);
            }
            return ref;
        }, []);

        const mapToLogicalTabId = React.useCallback((tabId: string) => (tabId === rootBlockId ? ROOT_TAB_ID : tabId), [rootBlockId]);

        const handleDocumentMouseMove = React.useCallback(
            (event: MouseEvent) => {
                const dragState = dragStateRef.current;
                if (dragState.draggedTabId == null) {
                    return;
                }
                const deltaX = event.clientX - dragState.startX;
                const deltaY = event.clientY - dragState.startY;
                if (!dragState.dragged) {
                    if (Math.abs(deltaX) < BLOCK_TAB_DRAG_THRESHOLD_PX && Math.abs(deltaY) < BLOCK_TAB_DRAG_THRESHOLD_PX) {
                        return;
                    }
                    dragState.dragged = true;
                    logBlockTabTrace(dragState.trace, "block-subtab drag started", {
                        draggedTabId: dragState.draggedTabId,
                    });
                }

                const currentOrder = dragState.currentOrder;
                const otherTabIds = dragState.initialOrder.filter((tabId) => tabId !== dragState.draggedTabId);
                let targetIndex = otherTabIds.length;
                for (let index = 0; index < otherTabIds.length; index++) {
                    const tabId = otherTabIds[index];
                    const centerX = dragState.initialCenters[tabId];
                    if (centerX == null) {
                        continue;
                    }
                    if (event.clientX < centerX) {
                        targetIndex = index;
                        break;
                    }
                }

                const nextOrder = [...otherTabIds];
                nextOrder.splice(targetIndex, 0, dragState.draggedTabId);
                if (blockTabIdsEqual(nextOrder, currentOrder)) {
                    return;
                }
                dragState.currentOrder = nextOrder;
                setPreviewOrderedTabIds(nextOrder);
                logBlockTabTrace(dragState.trace, "block-subtab drag reorder preview", {
                    draggedTabId: dragState.draggedTabId,
                    targetIndex,
                    nextOrder,
                });
            },
            []
        );

        const handleDocumentMouseUp = React.useCallback(
            (_event: MouseEvent) => {
                const dragState = dragStateRef.current;
                document.removeEventListener("mousemove", handleDocumentMouseMove);
                document.removeEventListener("mouseup", handleDocumentMouseUp);
                if (dragState.draggedTabId == null) {
                    return;
                }
                const nextOrder = dragState.currentOrder;
                const currentOrderedTabIds = [rootBlockId, ...childTabIds];
                const didReorder = dragState.dragged && !blockTabIdsEqual(nextOrder, currentOrderedTabIds);
                logBlockTabTrace(dragState.trace, "block-subtab drag ended", {
                    draggedTabId: dragState.draggedTabId,
                    didReorder,
                    nextOrder,
                });
                const pressedTabId = dragState.draggedTabId;
                const wasActive = dragState.wasActive;
                const trace = dragState.trace;
                dragState.draggedTabId = null;
                dragState.startX = 0;
                dragState.startY = 0;
                dragState.currentOrder = currentOrderedTabIds;
                dragState.initialOrder = currentOrderedTabIds;
                dragState.initialCenters = {};
                dragState.wasActive = false;
                setPreviewOrderedTabIds(null);
                if (didReorder) {
                    void onReorderTabsRef.current(nextOrder);
                } else {
                    if (pressedTabId != null) {
                        const logicalTabId = mapToLogicalTabId(pressedTabId);
                        if (wasActive) {
                            logBlockTabTrace(trace, "block-subtab mouseup on active tab", {
                                draggedTabId: pressedTabId,
                            });
                            onActiveTabPress(logicalTabId, trace ?? undefined);
                        } else {
                            logBlockTabTrace(trace, "block-subtab mouseup selecting tab", {
                                draggedTabId: pressedTabId,
                            });
                            onSelectTab(logicalTabId, trace ?? undefined);
                        }
                    }
                }
                dragState.dragged = false;
                dragState.trace = null;
            },
            [childTabIds, handleDocumentMouseMove, mapToLogicalTabId, onActiveTabPress, onSelectTab, rootBlockId]
        );

        const handleTabPressStart = React.useCallback(
            (tabId: string, isActiveTab: boolean, event: React.MouseEvent<HTMLDivElement>, trace: BlockTabTrace) => {
                if (event.button !== 0) {
                    return;
                }
                document.removeEventListener("mousemove", handleDocumentMouseMove);
                document.removeEventListener("mouseup", handleDocumentMouseUp);
                const initialOrder = displayedOrderedTabIds;
                const initialCenters = initialOrder.reduce<Record<string, number>>((acc, tabId) => {
                    const rect = tabRefs.current.get(tabId)?.current?.getBoundingClientRect();
                    if (rect != null) {
                        acc[tabId] = rect.left + rect.width / 2;
                    }
                    return acc;
                }, {});
                dragStateRef.current = {
                    draggedTabId: tabId,
                    startX: event.clientX,
                    startY: event.clientY,
                    dragged: false,
                    wasActive: isActiveTab,
                    trace,
                    currentOrder: initialOrder,
                    initialOrder,
                    initialCenters,
                };
                logBlockTabTrace(trace, "block-subtab drag armed", {
                    draggedTabId: tabId,
                    wasActive: isActiveTab,
                    orderedTabIds: initialOrder,
                    initialCenters,
                });
                document.addEventListener("mousemove", handleDocumentMouseMove);
                document.addEventListener("mouseup", handleDocumentMouseUp);
            },
            [displayedOrderedTabIds, handleDocumentMouseMove, handleDocumentMouseUp]
        );

        React.useEffect(() => {
            return () => {
                document.removeEventListener("mousemove", handleDocumentMouseMove);
                document.removeEventListener("mouseup", handleDocumentMouseUp);
            };
        }, [handleDocumentMouseMove, handleDocumentMouseUp]);

        return (
            <div className="block-frame-tabs">
                {displayedOrderedTabIds.map((tabId) => (
                    <BlockHeaderTab
                        key={tabId}
                        targetBlockId={tabId}
                        active={activeTabId === mapToLogicalTabId(tabId)}
                        canClose={displayedOrderedTabIds.length > 1}
                        dragging={dragStateRef.current.draggedTabId === tabId && dragStateRef.current.dragged}
                        onSelect={(trace) => onSelectTab(mapToLogicalTabId(tabId), trace)}
                        onActivePress={(trace) => onActiveTabPress(mapToLogicalTabId(tabId), trace)}
                        onClose={() => onCloseTab(mapToLogicalTabId(tabId))}
                        onRename={(newName) => onRenameTab(mapToLogicalTabId(tabId), newName)}
                        onPressStart={(event, trace) =>
                            handleTabPressStart(tabId, activeTabId === mapToLogicalTabId(tabId), event, trace)
                        }
                        tabRef={getTabRef(tabId)}
                    />
                ))}
            </div>
        );
    }
);
BlockHeaderTabs.displayName = "BlockHeaderTabs";

type UseBlockTabsOpts = {
    blockId: string;
    nodeModel: BlockNodeModel;
    rootViewModel: ViewModel;
    rootContent: React.ReactElement;
};

type UseBlockTabsRtn = {
    hasTabs: boolean;
    headerTabs: React.ReactNode;
    showAddTabButton: boolean;
    activeViewModel: ViewModel;
    tabContents: React.ReactNode;
    addTab: (view: "term" | "web" | "preview") => Promise<void>;
    cycleToNextTab: () => boolean;
    cleanupAllTabs: () => Promise<void>;
    getActiveViewModel: () => ViewModel;
};

function useBlockTabs({ blockId, nodeModel, rootViewModel, rootContent }: UseBlockTabsOpts): UseBlockTabsRtn {
    const waveEnv = useWaveEnv<BlockEnv>();
    const [rootBlockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", blockId));
    const rawChildTabIds = jotai.useAtomValue(waveEnv.getBlockMetaKeyAtom(blockId, BLOCK_TABS_IDS_METAKEY as any)) as
        | string[]
        | null
        | undefined;
    const rawActiveTabId = jotai.useAtomValue(
        waveEnv.getBlockMetaKeyAtom(blockId, BLOCK_TABS_ACTIVE_METAKEY as any)
    ) as string | null | undefined;
    const childTabIds = React.useMemo(
        () =>
            Array.isArray(rawChildTabIds) ? rawChildTabIds.filter((id): id is string => typeof id === "string") : [],
        [rawChildTabIds]
    );
    const [optimisticChildTabIds, setOptimisticChildTabIds] = React.useState<string[] | null>(null);
    const [optimisticActiveTabId, setOptimisticActiveTabId] = React.useState<string | null>(null);
    const effectiveChildTabIds = optimisticChildTabIds ?? childTabIds;
    const hasTabs = effectiveChildTabIds.length > 0;
    const allTabIds = React.useMemo(() => [ROOT_TAB_ID, ...effectiveChildTabIds], [effectiveChildTabIds]);
    const serverActiveTabId =
        childTabIds.length > 0 && rawActiveTabId != null && [ROOT_TAB_ID, ...childTabIds].includes(rawActiveTabId)
            ? rawActiveTabId
            : ROOT_TAB_ID;
    const activeTabId =
        optimisticActiveTabId != null && allTabIds.includes(optimisticActiveTabId) ? optimisticActiveTabId : serverActiveTabId;
    const activeBlockId = activeTabId === ROOT_TAB_ID ? blockId : activeTabId;
    const [activeBlockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", activeBlockId));
    const showAddTabButton = supportsBlockTabs(rootBlockData?.meta?.view) || hasTabs;
    const childTabIdsRef = React.useRef<string[]>(effectiveChildTabIds);
    const activeTabIdRef = React.useRef(activeTabId);
    const blockComponentModelVersion = jotai.useAtomValue(waveEnv.atoms.blockComponentModelVersion);
    const [mountedTabIds, setMountedTabIds] = React.useState<string[]>(() =>
        getMountedBlockTabIds([ROOT_TAB_ID], activeTabId, effectiveChildTabIds)
    );

    childTabIdsRef.current = effectiveChildTabIds;
    activeTabIdRef.current = activeTabId;

    React.useEffect(() => {
        if (optimisticChildTabIds != null && blockTabIdsEqual(optimisticChildTabIds, childTabIds)) {
            setOptimisticChildTabIds(null);
        }
    }, [childTabIds, optimisticChildTabIds]);

    React.useEffect(() => {
        if (optimisticActiveTabId != null && optimisticActiveTabId === serverActiveTabId) {
            setOptimisticActiveTabId(null);
        }
    }, [optimisticActiveTabId, serverActiveTabId]);

    React.useEffect(() => {
        setMountedTabIds((prevMountedIds) => getMountedBlockTabIds(prevMountedIds, activeTabId, effectiveChildTabIds));
    }, [activeTabId, effectiveChildTabIds]);

    const persistTabs = React.useCallback(
        async (nextChildIds: string[], nextActiveTabId: string) => {
            const meta = {
                [BLOCK_TABS_IDS_METAKEY]: nextChildIds.length > 0 ? nextChildIds : null,
                [BLOCK_TABS_ACTIVE_METAKEY]: nextChildIds.length > 0 ? nextActiveTabId : null,
            } as MetaType;
            await RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("block", blockId),
                meta,
            });
        },
        [blockId]
    );

    const promoteChildTabToRoot = React.useCallback(async () => {
        const currentChildIds = [...childTabIdsRef.current];
        const nextRootState = deriveBlockTabRootCloseState(currentChildIds, activeTabIdRef.current);
        if (nextRootState == null) {
            return;
        }
        const { nextRootBlockId: promoteId, nextChildTabIds: remainingChildIds, nextPersistedActiveTabId: nextActiveTabId } =
            nextRootState;
        const rootBlock = (await ObjectService.GetObject(WOS.makeORef("block", blockId))) as Block;
        const promotedBlock = (await ObjectService.GetObject(WOS.makeORef("block", promoteId))) as Block;
        const [parentType, parentId] = WOS.splitORef(rootBlock.parentoref);
        if (parentType !== "tab") {
            throw new Error(`cannot promote subtab for non-tab parent: ${rootBlock.parentoref}`);
        }
        const parentTab = (await ObjectService.GetObject(WOS.makeORef("tab", parentId))) as Tab;
        // This path immediately reuses an existing child block as the new root block. We need the
        // updated objects back in the local cache right away, otherwise the promoted block can keep
        // rendering its stale pre-promotion metadata (including missing blocktabs state).

        await Promise.all(
            remainingChildIds.map(async (childId) => {
                const childBlock = (await ObjectService.GetObject(WOS.makeORef("block", childId))) as Block;
                await ObjectService.UpdateObject(
                    {
                        ...childBlock,
                        parentoref: WOS.makeORef("block", promoteId),
                    } as Block,
                    true
                );
            })
        );

        await ObjectService.UpdateObject(
            {
                ...promotedBlock,
                parentoref: rootBlock.parentoref,
                subblockids: remainingChildIds,
                meta: {
                    ...(promotedBlock.meta ?? {}),
                    "frame:closelocked": rootBlock.meta?.["frame:closelocked"] ?? null,
                    [BLOCK_TABS_IDS_METAKEY]: remainingChildIds.length > 0 ? remainingChildIds : null,
                    [BLOCK_TABS_ACTIVE_METAKEY]: nextActiveTabId,
                },
            } as Block,
            true
        );
        await ObjectService.UpdateObject(
            {
                ...parentTab,
                blockids: (parentTab.blockids ?? []).map((id) => (id === blockId ? promoteId : id)),
            } as Tab,
            true
        );
        await ObjectService.UpdateObject(
            {
                ...rootBlock,
                subblockids: [],
                meta: {
                    ...(rootBlock.meta ?? {}),
                    [BLOCK_TABS_IDS_METAKEY]: null,
                    [BLOCK_TABS_ACTIVE_METAKEY]: null,
                },
            } as Block,
            true
        );

        const layoutModel = getLayoutModelForStaticTab();
        const targetNode = layoutModel.getNodeByBlockId(blockId);
        if (targetNode != null) {
            const replaceAction: LayoutTreeReplaceNodeAction = {
                type: LayoutTreeActionType.ReplaceNode,
                targetNodeId: targetNode.id,
                newNode: newLayoutNode(undefined, undefined, undefined, { blockId: promoteId }),
                focused: true,
            };
            layoutModel.treeReducer(replaceAction);
        }
        await ObjectService.DeleteBlock(blockId);
        setTimeout(() => refocusNode(promoteId), 10);
    }, [blockId]);

    const reorderTabsWithNewRoot = React.useCallback(
        async (nextRootBlockId: string, nextChildIds: string[], nextPersistedActiveTabId: string | null) => {
            const rootBlock = (await ObjectService.GetObject(WOS.makeORef("block", blockId))) as Block;
            const nextRootBlock = (await ObjectService.GetObject(WOS.makeORef("block", nextRootBlockId))) as Block;
            const [parentType, parentId] = WOS.splitORef(rootBlock.parentoref);
            if (parentType !== "tab") {
                throw new Error(`cannot reorder subtab root for non-tab parent: ${rootBlock.parentoref}`);
            }
            const parentTab = (await ObjectService.GetObject(WOS.makeORef("tab", parentId))) as Tab;

            await Promise.all(
                nextChildIds
                    .filter((childId) => childId !== blockId)
                    .map(async (childId) => {
                        const childBlock = (await ObjectService.GetObject(WOS.makeORef("block", childId))) as Block;
                        await ObjectService.UpdateObject(
                            {
                                ...childBlock,
                                parentoref: WOS.makeORef("block", nextRootBlockId),
                            } as Block,
                            true
                        );
                    })
            );

            await ObjectService.UpdateObject(
                {
                    ...rootBlock,
                    parentoref: WOS.makeORef("block", nextRootBlockId),
                    subblockids: [],
                    meta: {
                        ...(rootBlock.meta ?? {}),
                        "frame:closelocked": null,
                        [BLOCK_TABS_IDS_METAKEY]: null,
                        [BLOCK_TABS_ACTIVE_METAKEY]: null,
                    },
                } as Block,
                true
            );
            await ObjectService.UpdateObject(
                {
                    ...nextRootBlock,
                    parentoref: rootBlock.parentoref,
                    subblockids: nextChildIds,
                    meta: {
                        ...(nextRootBlock.meta ?? {}),
                        "frame:closelocked": rootBlock.meta?.["frame:closelocked"] ?? null,
                        [BLOCK_TABS_IDS_METAKEY]: nextChildIds.length > 0 ? nextChildIds : null,
                        [BLOCK_TABS_ACTIVE_METAKEY]: nextPersistedActiveTabId,
                    },
                } as Block,
                true
            );
            await ObjectService.UpdateObject(
                {
                    ...parentTab,
                    blockids: (parentTab.blockids ?? []).map((id) => (id === blockId ? nextRootBlockId : id)),
                } as Tab,
                true
            );

            const layoutModel = getLayoutModelForStaticTab();
            const targetNode = layoutModel.getNodeByBlockId(blockId);
            if (targetNode != null) {
                const replaceAction: LayoutTreeReplaceNodeAction = {
                    type: LayoutTreeActionType.ReplaceNode,
                    targetNodeId: targetNode.id,
                    newNode: newLayoutNode(undefined, undefined, undefined, { blockId: nextRootBlockId }),
                    focused: true,
                };
                layoutModel.treeReducer(replaceAction);
            }
            setTimeout(() => refocusNode(nextRootBlockId), 10);
        },
        [blockId]
    );

    const selectTab = React.useCallback(
        (nextTabId: string, trace?: BlockTabTrace) => {
            const nextActive = nextTabId === ROOT_TAB_ID ? ROOT_TAB_ID : nextTabId;
            logBlockTabTrace(trace, "selectTab entered", {
                blockId,
                nextTabId,
                nextActive,
                currentActiveTabId: activeTabIdRef.current,
            });
            if (nextActive === activeTabIdRef.current) {
                logBlockTabTrace(trace, "selectTab no-op because target already active");
                setTimeout(() => refocusNode(blockId), 10);
                endBlockTabTrace(trace, "selectTab-noop-already-active", { refocusBlockId: blockId });
                return;
            }
            logBlockTabTrace(trace, "persistTabs begin", {
                childTabIds: childTabIdsRef.current,
            });
            setMountedTabIds((prevMountedIds) => getMountedBlockTabIds(prevMountedIds, nextActive, childTabIdsRef.current));
            setOptimisticActiveTabId(nextActive);
            void persistTabs(childTabIdsRef.current, nextActive)
                .then(() => {
                    logBlockTabTrace(trace, "persistTabs resolved", {
                        persistedActiveTabId: nextActive,
                    });
                    setTimeout(() => {
                        logBlockTabTrace(trace, "refocusNode timeout fired", { refocusBlockId: blockId });
                        refocusNode(blockId);
                        endBlockTabTrace(trace, "selectTab-success", {
                            refocusBlockId: blockId,
                            persistedActiveTabId: nextActive,
                        });
                    }, 10);
                })
                .catch((error) => {
                    setOptimisticActiveTabId(null);
                    endBlockTabTrace(trace, "selectTab-error", {
                        error: error instanceof Error ? error.message : String(error),
                    });
                    throw error;
                });
        },
        [blockId, persistTabs]
    );

    const handleActiveTabPress = React.useCallback(
        (tabId: string, trace?: BlockTabTrace) => {
            logBlockTabTrace(trace, "active tab press -> clearPanelFocus", {
                blockId,
                tabId,
            });
            clearPanelFocus();
            if (tabId === activeTabIdRef.current) {
                setTimeout(() => refocusNode(blockId), 10);
            }
            endBlockTabTrace(trace, "active-tab-clear-focus", {
                blockId,
                tabId,
            });
        },
        [blockId]
    );

    const renameTab = React.useCallback(
        async (tabId: string, newName: string) => {
            const targetBlockId = tabId === ROOT_TAB_ID ? blockId : tabId;
            await RpcApi.SetMetaCommand(TabRpcClient, {
                oref: WOS.makeORef("block", targetBlockId),
                meta: { "frame:title": newName || null },
            });
        },
        [blockId]
    );

    const reorderTabs = React.useCallback(
        async (nextOrderedBlockIds: string[]) => {
            const reorderState = deriveBlockTabReorderState(
                blockId,
                childTabIdsRef.current,
                activeTabIdRef.current,
                nextOrderedBlockIds
            );
            if (reorderState == null) {
                return;
            }
            if (reorderState.nextRootBlockId === blockId) {
                setOptimisticChildTabIds(reorderState.nextChildTabIds);
                childTabIdsRef.current = reorderState.nextChildTabIds;
                await persistTabs(reorderState.nextChildTabIds, activeTabIdRef.current);
                return;
            }
            await reorderTabsWithNewRoot(
                reorderState.nextRootBlockId,
                reorderState.nextChildTabIds,
                reorderState.nextPersistedActiveTabId
            );
        },
        [blockId, persistTabs, reorderTabsWithNewRoot]
    );

    const closeTab = React.useCallback(
        async (tabId: string) => {
            if (tabId === ROOT_TAB_ID) {
                await promoteChildTabToRoot();
                return;
            }
            const allIds = [ROOT_TAB_ID, ...childTabIdsRef.current];
            const closeIdx = allIds.indexOf(tabId);
            const nextChildIds = childTabIdsRef.current.filter((id) => id !== tabId);
            let nextActiveTabId = activeTabIdRef.current;
            if (activeTabIdRef.current === tabId) {
                const nextCandidate = allIds[closeIdx - 1] ?? allIds[closeIdx + 1] ?? ROOT_TAB_ID;
                nextActiveTabId = nextCandidate === tabId ? ROOT_TAB_ID : nextCandidate;
            }
            if (!nextChildIds.includes(nextActiveTabId) && nextActiveTabId !== ROOT_TAB_ID) {
                nextActiveTabId = ROOT_TAB_ID;
            }
            setOptimisticChildTabIds(nextChildIds);
            setOptimisticActiveTabId(nextActiveTabId);
            await persistTabs(nextChildIds, nextActiveTabId);
            await RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: tabId });
            setTimeout(() => refocusNode(blockId), 10);
        },
        [blockId, persistTabs, promoteChildTabToRoot]
    );

    const addTab = React.useCallback(
        async (view: "term" | "web" | "preview") => {
            const sourceMeta = activeBlockData?.meta ?? rootBlockData?.meta;
            const oref = await RpcApi.CreateSubBlockCommand(TabRpcClient, {
                parentblockid: blockId,
                blockdef: makeTabBlockDef(view, sourceMeta),
            });
            const [, newBlockId] = WOS.splitORef(oref);
            const nextChildIds = [...childTabIdsRef.current, newBlockId];
            setMountedTabIds((prevMountedIds) => getMountedBlockTabIds(prevMountedIds, newBlockId, nextChildIds));
            setOptimisticChildTabIds(nextChildIds);
            setOptimisticActiveTabId(newBlockId);
            await persistTabs(nextChildIds, newBlockId);
            setTimeout(() => refocusNode(blockId), 10);
        },
        [activeBlockData?.meta, blockId, persistTabs, rootBlockData?.meta]
    );

    const cycleToNextTab = React.useCallback(() => {
        if (childTabIdsRef.current.length === 0) {
            return false;
        }
        const ids = [ROOT_TAB_ID, ...childTabIdsRef.current];
        const curIdx = ids.indexOf(activeTabIdRef.current);
        const nextIdx = curIdx === -1 ? 0 : (curIdx + 1) % ids.length;
        selectTab(ids[nextIdx]);
        return true;
    }, [selectTab]);

    const cleanupAllTabs = React.useCallback(async () => {
        const ids = [...childTabIdsRef.current];
        if (ids.length === 0) {
            return;
        }
        await persistTabs([], ROOT_TAB_ID);
        await Promise.allSettled(ids.map((id) => RpcApi.DeleteSubBlockCommand(TabRpcClient, { blockid: id })));
    }, [persistTabs]);

    const activeViewModel = React.useMemo(
        () =>
            resolveBlockTabViewModel(activeTabId, rootViewModel, (tabId) => {
                const bcm = getBlockComponentModel(tabId);
                return bcm?.getActiveViewModel?.() ?? bcm?.viewModel;
            }).viewModel,
        [activeTabId, blockComponentModelVersion, rootViewModel]
    );

    const tabContents = (
        <>
            {mountedTabIds.includes(ROOT_TAB_ID) && (
                <div
                    key={ROOT_TAB_ID}
                    className={`block-tab-panel ${activeTabId === ROOT_TAB_ID ? "is-active" : "is-hidden"}`}
                    aria-hidden={activeTabId !== ROOT_TAB_ID}
                >
                    {rootContent}
                </div>
            )}
            {effectiveChildTabIds
                .filter((childId) => mountedTabIds.includes(childId))
                .map((childId) => {
                    const childNodeModel: BlockNodeModel = {
                        blockId: childId,
                        isFocused: nodeModel.isFocused,
                        isMagnified: nodeModel.isMagnified,
                        onClose: () => {
                            void closeTab(childId);
                        },
                        focusNode: nodeModel.focusNode,
                        toggleMagnify: nodeModel.toggleMagnify,
                    };
                    const isActive = activeTabId === childId;
                    return (
                        <div
                            key={childId}
                            className={`block-tab-panel ${isActive ? "is-active" : "is-hidden"}`}
                            aria-hidden={!isActive}
                        >
                            <SubBlock nodeModel={childNodeModel} />
                        </div>
                    );
                })}
        </>
    );

    const headerTabs = hasTabs ? (
        <BlockHeaderTabs
            rootBlockId={blockId}
            childTabIds={effectiveChildTabIds}
            activeTabId={activeTabId}
            onSelectTab={selectTab}
            onActiveTabPress={handleActiveTabPress}
            onCloseTab={(tabId) => {
                void closeTab(tabId);
            }}
            onRenameTab={(tabId, newName) => {
                void renameTab(tabId, newName);
            }}
            onReorderTabs={(nextOrderedBlockIds) => {
                void reorderTabs(nextOrderedBlockIds);
            }}
        />
    ) : null;

    const getActiveViewModel = React.useCallback(() => activeViewModel, [activeViewModel]);

    return {
        hasTabs,
        headerTabs,
        showAddTabButton,
        activeViewModel,
        tabContents,
        addTab,
        cycleToNextTab,
        cleanupAllTabs,
        getActiveViewModel,
    };
}

export { ROOT_TAB_ID, useBlockTabs };
