// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { getBlockMetaKeyAtom, globalStore, refocusNode, useBlockAtom, WOS } from "@/app/store/global";
import { TabRpcClient } from "@/app/store/wshrpcutil";
import { RpcApi } from "@/app/store/wshclientapi";
import { atom, Atom, PrimitiveAtom } from "jotai";

const BLOCK_CLOSE_CONFIRM_WINDOW_MS = 780;
const BLOCK_CLOSE_LOCK_METAKEY = "frame:closelocked";

function getBlockCloseLockedOverrideAtom(blockId: string): PrimitiveAtom<boolean | null> {
    return useBlockAtom(blockId, "blockCloseLockedOverride", () => atom<boolean | null>(null)) as PrimitiveAtom<boolean | null>;
}

function getBlockCloseLockedAtom(blockId: string): Atom<boolean> {
    return useBlockAtom(blockId, "blockCloseLocked", () => {
        const closeLockedOverrideAtom = getBlockCloseLockedOverrideAtom(blockId);
        const closeLockedMetaAtom = getBlockMetaKeyAtom(blockId, BLOCK_CLOSE_LOCK_METAKEY);
        return atom((get) => get(closeLockedOverrideAtom) ?? get(closeLockedMetaAtom) ?? false);
    }) as Atom<boolean>;
}

function getBlockCloseBlockedFlashSeqAtom(blockId: string): PrimitiveAtom<number> {
    return useBlockAtom(blockId, "blockCloseBlockedFlashSeq", () => atom(0)) as PrimitiveAtom<number>;
}

function getBlockCloseConfirmUntilAtom(blockId: string): PrimitiveAtom<number> {
    return useBlockAtom(blockId, "blockCloseConfirmUntil", () => atom(0)) as PrimitiveAtom<number>;
}

function isBlockCloseLocked(blockId: string): boolean {
    return globalStore.get(getBlockCloseLockedAtom(blockId));
}

function setBlockCloseLocked(blockId: string, locked: boolean): void {
    globalStore.set(getBlockCloseLockedOverrideAtom(blockId), locked);
    void RpcApi.SetMetaCommand(TabRpcClient, {
        oref: WOS.makeORef("block", blockId),
        meta: { [BLOCK_CLOSE_LOCK_METAKEY]: locked || null },
    });
}

function toggleBlockCloseLocked(blockId: string): void {
    setBlockCloseLocked(blockId, !globalStore.get(getBlockCloseLockedAtom(blockId)));
}

function triggerBlockCloseBlockedFlash(blockId: string): void {
    refocusNode(blockId);
    const closeBlockedFlashSeqAtom = getBlockCloseBlockedFlashSeqAtom(blockId);
    globalStore.set(closeBlockedFlashSeqAtom, globalStore.get(closeBlockedFlashSeqAtom) + 1);
}

function hasPendingBlockCloseConfirmation(blockId: string): boolean {
    return globalStore.get(getBlockCloseConfirmUntilAtom(blockId)) > Date.now();
}

function armBlockCloseConfirmation(blockId: string): void {
    globalStore.set(getBlockCloseConfirmUntilAtom(blockId), Date.now() + BLOCK_CLOSE_CONFIRM_WINDOW_MS);
}

function guardCloseForLockedBlock(blockId: string): boolean {
    if (!isBlockCloseLocked(blockId)) {
        return false;
    }
    if (hasPendingBlockCloseConfirmation(blockId)) {
        return false;
    }
    armBlockCloseConfirmation(blockId);
    triggerBlockCloseBlockedFlash(blockId);
    return true;
}

export {
    BLOCK_CLOSE_CONFIRM_WINDOW_MS,
    BLOCK_CLOSE_LOCK_METAKEY,
    getBlockCloseBlockedFlashSeqAtom,
    getBlockCloseLockedAtom,
    guardCloseForLockedBlock,
    hasPendingBlockCloseConfirmation,
    isBlockCloseLocked,
    setBlockCloseLocked,
    toggleBlockCloseLocked,
    triggerBlockCloseBlockedFlash,
};
