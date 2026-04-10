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
import { BlockEnv } from "./blockenv";
import { BlockNodeModel } from "./blocktypes";

const ROOT_TAB_ID = "__root__";
const BLOCK_TABS_IDS_METAKEY = "blocktabs:ids";
const BLOCK_TABS_ACTIVE_METAKEY = "blocktabs:activeid";
const SUPPORTED_BLOCK_TAB_VIEWS = new Set(["term", "web", "preview"]);
const MAX_TAB_NAME_LENGTH = 24;

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
    onSelect: () => void;
    onClose?: () => void;
    onRename: (newName: string) => void;
};

const BlockHeaderTab = React.memo(
    ({ targetBlockId, active, canClose, onSelect, onClose, onRename }: BlockHeaderTabProps) => {
        const waveEnv = useWaveEnv<BlockEnv>();
        const [blockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", targetBlockId));
        const { title, icon } = getTabDisplayInfo(blockData);
        const [originalName, setOriginalName] = React.useState(title);
        const [isEditable, setIsEditable] = React.useState(false);
        const editableRef = React.useRef<HTMLDivElement>(null);
        const renameTimeoutRef = React.useRef<NodeJS.Timeout>(null);
        const selectedOnMouseDownRef = React.useRef(false);

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
                e.stopPropagation();
                if (e.button !== 0) {
                    return;
                }
                if (!active) {
                    onSelect();
                    selectedOnMouseDownRef.current = true;
                    return;
                }
                clearPanelFocus();
            },
            [active, onSelect]
        );

        const handleClick = React.useCallback(
            (e: React.MouseEvent<HTMLDivElement>) => {
                e.stopPropagation();
                if (selectedOnMouseDownRef.current) {
                    selectedOnMouseDownRef.current = false;
                    return;
                }
                onSelect();
            },
            [onSelect]
        );

        return (
            <div
                className={`block-frame-tab ${active ? "active" : ""} ${canClose ? "closable" : "fixed-tab"}`}
                data-clear-panel-focus="true"
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
                        data-clear-panel-focus="true"
                        title="Close Tab"
                        onClick={(e) => {
                            e.stopPropagation();
                            onClose?.();
                        }}
                        onMouseDown={(e) => {
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
    parentBlockId: string;
    childTabIds: string[];
    activeTabId: string;
    onSelectTab: (tabId: string) => void;
    onCloseTab: (tabId: string) => void;
    onRenameTab: (tabId: string, newName: string) => void;
};

const BlockHeaderTabs = React.memo(
    ({ parentBlockId, childTabIds, activeTabId, onSelectTab, onCloseTab, onRenameTab }: BlockHeaderTabsProps) => {
        return (
            <div className="block-frame-tabs">
                <BlockHeaderTab
                    targetBlockId={parentBlockId}
                    active={activeTabId === ROOT_TAB_ID}
                    canClose={childTabIds.length > 0}
                    onSelect={() => onSelectTab(ROOT_TAB_ID)}
                    onClose={() => onCloseTab(ROOT_TAB_ID)}
                    onRename={(newName) => onRenameTab(ROOT_TAB_ID, newName)}
                />
                {childTabIds.map((childId) => (
                    <BlockHeaderTab
                        key={childId}
                        targetBlockId={childId}
                        active={activeTabId === childId}
                        canClose={true}
                        onSelect={() => onSelectTab(childId)}
                        onClose={() => onCloseTab(childId)}
                        onRename={(newName) => onRenameTab(childId, newName)}
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
    activeContent: React.ReactNode;
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
    const hasTabs = childTabIds.length > 0;
    const allTabIds = React.useMemo(() => [ROOT_TAB_ID, ...childTabIds], [childTabIds]);
    const activeTabId =
        hasTabs && rawActiveTabId != null && allTabIds.includes(rawActiveTabId) ? rawActiveTabId : ROOT_TAB_ID;
    const activeBlockId = activeTabId === ROOT_TAB_ID ? blockId : activeTabId;
    const [activeBlockData] = WOS.useWaveObjectValue<Block>(WOS.makeORef("block", activeBlockId));
    const showAddTabButton = supportsBlockTabs(rootBlockData?.meta?.view) || hasTabs;
    const childTabIdsRef = React.useRef<string[]>(childTabIds);
    const activeTabIdRef = React.useRef(activeTabId);
    const [childViewModelRefreshSeq, setChildViewModelRefreshSeq] = React.useState(0);

    React.useEffect(() => {
        childTabIdsRef.current = childTabIds;
        activeTabIdRef.current = activeTabId;
    }, [activeTabId, childTabIds]);

    React.useEffect(() => {
        if (activeTabId === ROOT_TAB_ID) {
            return;
        }
        const raf = requestAnimationFrame(() => {
            setChildViewModelRefreshSeq((v) => v + 1);
        });
        return () => cancelAnimationFrame(raf);
    }, [activeTabId]);

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
        if (currentChildIds.length === 0) {
            return;
        }
        const promoteId =
            activeTabIdRef.current !== ROOT_TAB_ID && currentChildIds.includes(activeTabIdRef.current)
                ? activeTabIdRef.current
                : currentChildIds[0];
        const remainingChildIds = currentChildIds.filter((id) => id !== promoteId);
        const rootBlock = (await ObjectService.GetObject(WOS.makeORef("block", blockId))) as Block;
        const promotedBlock = (await ObjectService.GetObject(WOS.makeORef("block", promoteId))) as Block;
        const [parentType, parentId] = WOS.splitORef(rootBlock.parentoref);
        if (parentType !== "tab") {
            throw new Error(`cannot promote subtab for non-tab parent: ${rootBlock.parentoref}`);
        }
        const parentTab = (await ObjectService.GetObject(WOS.makeORef("tab", parentId))) as Tab;

        await Promise.all(
            remainingChildIds.map(async (childId) => {
                const childBlock = (await ObjectService.GetObject(WOS.makeORef("block", childId))) as Block;
                await ObjectService.UpdateObject(
                    {
                        ...childBlock,
                        parentoref: WOS.makeORef("block", promoteId),
                    } as Block,
                    false
                );
            })
        );

        const nextActiveTabId =
            activeTabIdRef.current !== ROOT_TAB_ID && activeTabIdRef.current !== promoteId
                ? activeTabIdRef.current
                : null;
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
            false
        );
        await ObjectService.UpdateObject(
            {
                ...parentTab,
                blockids: (parentTab.blockids ?? []).map((id) => (id === blockId ? promoteId : id)),
            } as Tab,
            false
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
            false
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

    const selectTab = React.useCallback(
        (nextTabId: string) => {
            const nextActive = nextTabId === ROOT_TAB_ID ? ROOT_TAB_ID : nextTabId;
            if (nextActive === activeTabIdRef.current) {
                setTimeout(() => refocusNode(blockId), 10);
                return;
            }
            void persistTabs(childTabIdsRef.current, nextActive).then(() => {
                setTimeout(() => refocusNode(blockId), 10);
            });
        },
        [blockId, persistTabs]
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
            await persistTabs([...childTabIdsRef.current, newBlockId], newBlockId);
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

    const activeViewModel = React.useMemo(() => {
        if (activeTabId === ROOT_TAB_ID) {
            return rootViewModel;
        }
        void childViewModelRefreshSeq;
        const bcm = getBlockComponentModel(activeTabId);
        return bcm?.getActiveViewModel?.() ?? bcm?.viewModel ?? rootViewModel;
    }, [activeTabId, childViewModelRefreshSeq, rootViewModel]);

    const activeChildNodeModel = React.useMemo<BlockNodeModel | null>(() => {
        if (activeTabId === ROOT_TAB_ID) {
            return null;
        }
        return {
            blockId: activeTabId,
            isFocused: nodeModel.isFocused,
            isMagnified: nodeModel.isMagnified,
            onClose: () => {
                void closeTab(activeTabId);
            },
            focusNode: nodeModel.focusNode,
            toggleMagnify: nodeModel.toggleMagnify,
        };
    }, [activeTabId, closeTab, nodeModel]);

    const activeContent =
        activeTabId === ROOT_TAB_ID || activeChildNodeModel == null ? (
            rootContent
        ) : (
            <SubBlock nodeModel={activeChildNodeModel} />
        );

    const headerTabs = hasTabs ? (
        <BlockHeaderTabs
            parentBlockId={blockId}
            childTabIds={childTabIds}
            activeTabId={activeTabId}
            onSelectTab={selectTab}
            onCloseTab={(tabId) => {
                void closeTab(tabId);
            }}
            onRenameTab={(tabId, newName) => {
                void renameTab(tabId, newName);
            }}
        />
    ) : null;

    const getActiveViewModel = React.useCallback(() => activeViewModel, [activeViewModel]);

    return {
        hasTabs,
        headerTabs,
        showAddTabButton,
        activeViewModel,
        activeContent,
        addTab,
        cycleToNextTab,
        cleanupAllTabs,
        getActiveViewModel,
    };
}

export { ROOT_TAB_ID, useBlockTabs };
