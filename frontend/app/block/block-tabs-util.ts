// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

const ROOT_TAB_ID = "__root__";

function getMountedBlockTabIds(prevMountedIds: string[], activeTabId: string, childTabIds: string[]): string[] {
    const validTabIds = new Set([ROOT_TAB_ID, ...childTabIds]);
    const nextMountedIds = prevMountedIds.filter((id) => validTabIds.has(id));
    if (!nextMountedIds.includes(ROOT_TAB_ID)) {
        nextMountedIds.unshift(ROOT_TAB_ID);
    }
    if (activeTabId !== ROOT_TAB_ID && validTabIds.has(activeTabId) && !nextMountedIds.includes(activeTabId)) {
        nextMountedIds.push(activeTabId);
    }
    return nextMountedIds;
}

function resolveBlockTabViewModel<T>(
    activeTabId: string,
    rootViewModel: T,
    getChildViewModel: (tabId: string) => T | null | undefined
): { viewModel: T; isPending: boolean } {
    if (activeTabId === ROOT_TAB_ID) {
        return { viewModel: rootViewModel, isPending: false };
    }
    const childViewModel = getChildViewModel(activeTabId);
    if (childViewModel == null) {
        return { viewModel: rootViewModel, isPending: true };
    }
    return { viewModel: childViewModel, isPending: false };
}

function moveBlockTabId(tabIds: string[], draggedTabId: string, targetIndex: number): string[] {
    const fromIndex = tabIds.indexOf(draggedTabId);
    if (fromIndex === -1) {
        return tabIds;
    }
    const boundedTargetIndex = Math.max(0, Math.min(targetIndex, tabIds.length - 1));
    if (fromIndex === boundedTargetIndex) {
        return tabIds;
    }
    const nextTabIds = [...tabIds];
    nextTabIds.splice(fromIndex, 1);
    nextTabIds.splice(boundedTargetIndex, 0, draggedTabId);
    return nextTabIds;
}

type BlockTabReorderState = {
    nextRootBlockId: string;
    nextChildTabIds: string[];
    nextPersistedActiveTabId: string | null;
};

function deriveBlockTabReorderState(
    rootBlockId: string,
    childTabIds: string[],
    activeTabId: string,
    nextOrderedBlockIds: string[]
): BlockTabReorderState | null {
    const currentOrderedBlockIds = [rootBlockId, ...childTabIds];
    if (nextOrderedBlockIds.length !== currentOrderedBlockIds.length) {
        return null;
    }
    const validTabIds = new Set(currentOrderedBlockIds);
    const normalizedOrderedBlockIds: string[] = [];
    for (const blockId of nextOrderedBlockIds) {
        if (!validTabIds.has(blockId) || normalizedOrderedBlockIds.includes(blockId)) {
            return null;
        }
        normalizedOrderedBlockIds.push(blockId);
    }
    const isSameOrder = normalizedOrderedBlockIds.every((blockId, index) => blockId === currentOrderedBlockIds[index]);
    if (isSameOrder) {
        return null;
    }
    const actualActiveBlockId = activeTabId === ROOT_TAB_ID ? rootBlockId : activeTabId;
    const nextRootBlockId = normalizedOrderedBlockIds[0];
    return {
        nextRootBlockId,
        nextChildTabIds: normalizedOrderedBlockIds.slice(1),
        nextPersistedActiveTabId: actualActiveBlockId === nextRootBlockId ? null : actualActiveBlockId,
    };
}

export { ROOT_TAB_ID, deriveBlockTabReorderState, getMountedBlockTabIds, moveBlockTabId, resolveBlockTabViewModel };
