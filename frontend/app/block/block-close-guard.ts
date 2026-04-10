// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { globalStore, refocusNode, useBlockAtom } from "@/app/store/global";
import { atom, PrimitiveAtom } from "jotai";

function getBlockCloseLockedAtom(blockId: string): PrimitiveAtom<boolean> {
    return useBlockAtom(blockId, "blockCloseLocked", () => atom(false)) as PrimitiveAtom<boolean>;
}

function getBlockCloseBlockedFlashSeqAtom(blockId: string): PrimitiveAtom<number> {
    return useBlockAtom(blockId, "blockCloseBlockedFlashSeq", () => atom(0)) as PrimitiveAtom<number>;
}

function isBlockCloseLocked(blockId: string): boolean {
    return globalStore.get(getBlockCloseLockedAtom(blockId));
}

function setBlockCloseLocked(blockId: string, locked: boolean): void {
    globalStore.set(getBlockCloseLockedAtom(blockId), locked);
}

function toggleBlockCloseLocked(blockId: string): void {
    const closeLockedAtom = getBlockCloseLockedAtom(blockId);
    globalStore.set(closeLockedAtom, !globalStore.get(closeLockedAtom));
}

function triggerBlockCloseBlockedFlash(blockId: string): void {
    refocusNode(blockId);
    const closeBlockedFlashSeqAtom = getBlockCloseBlockedFlashSeqAtom(blockId);
    globalStore.set(closeBlockedFlashSeqAtom, globalStore.get(closeBlockedFlashSeqAtom) + 1);
}

function guardCloseForLockedBlock(blockId: string): boolean {
    if (!isBlockCloseLocked(blockId)) {
        return false;
    }
    triggerBlockCloseBlockedFlash(blockId);
    return true;
}

export {
    getBlockCloseBlockedFlashSeqAtom,
    getBlockCloseLockedAtom,
    guardCloseForLockedBlock,
    isBlockCloseLocked,
    setBlockCloseLocked,
    toggleBlockCloseLocked,
    triggerBlockCloseBlockedFlash,
};
