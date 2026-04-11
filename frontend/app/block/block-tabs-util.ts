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

export { ROOT_TAB_ID, getMountedBlockTabIds, resolveBlockTabViewModel };
