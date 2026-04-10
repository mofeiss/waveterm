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

export { ROOT_TAB_ID, getMountedBlockTabIds };
