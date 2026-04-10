// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore, WOS } from "@/app/store/global";
import { modalsModel } from "@/app/store/modalmodel";

function getBlockTabCount(blockId: string): number {
    const blockAtom = WOS.getWaveObjectAtom<Block>(WOS.makeORef("block", blockId));
    const blockData = globalStore.get(blockAtom);
    const childTabIds = blockData?.meta?.["blocktabs:ids"];
    return 1 + (Array.isArray(childTabIds) ? childTabIds.length : 0);
}

function blockNeedsMultiTabCloseConfirm(blockId: string): boolean {
    return getBlockTabCount(blockId) > 1;
}

function confirmCloseForMultiTabBlock(blockId: string): Promise<boolean> {
    const tabCount = getBlockTabCount(blockId);
    if (tabCount <= 1) {
        return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
        modalsModel.pushModal("BlockMultiTabCloseConfirm", {
            blockId,
            tabCount,
            onConfirm: () => resolve(true),
            onCancel: () => resolve(false),
        });
    });
}

export { blockNeedsMultiTabCloseConfirm, confirmCloseForMultiTabBlock, getBlockTabCount };
