import { createStore } from "jotai";
import { describe, expect, it, vi } from "vitest";

describe("block-close-guard", () => {
    it("allows a second close attempt during the flash confirmation window", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-04-10T12:00:00.000Z"));

        const store = createStore();
        const blockAtoms = new Map<string, any>();
        const refocusNode = vi.fn();

        vi.resetModules();
        vi.doMock("@/app/store/global", async () => {
            const jotai = await import("jotai");
            return {
                globalStore: store,
                refocusNode,
                useBlockAtom: (blockId: string, key: string, createAtom: () => any) => {
                    const atomKey = `${blockId}:${key}`;
                    if (!blockAtoms.has(atomKey)) {
                        blockAtoms.set(atomKey, createAtom());
                    }
                    return blockAtoms.get(atomKey);
                },
                atom: jotai.atom,
            };
        });

        const {
            BLOCK_CLOSE_CONFIRM_WINDOW_MS,
            getBlockCloseBlockedFlashSeqAtom,
            guardCloseForLockedBlock,
            setBlockCloseLocked,
        } = await import("./block-close-guard");

        const blockId = "block-1";
        setBlockCloseLocked(blockId, true);

        expect(guardCloseForLockedBlock(blockId)).toBe(true);
        expect(refocusNode).toHaveBeenCalledWith(blockId);
        expect(store.get(getBlockCloseBlockedFlashSeqAtom(blockId))).toBe(1);

        vi.advanceTimersByTime(BLOCK_CLOSE_CONFIRM_WINDOW_MS - 1);
        expect(guardCloseForLockedBlock(blockId)).toBe(false);
        expect(store.get(getBlockCloseBlockedFlashSeqAtom(blockId))).toBe(1);

        vi.advanceTimersByTime(1);
        expect(guardCloseForLockedBlock(blockId)).toBe(true);
        expect(store.get(getBlockCloseBlockedFlashSeqAtom(blockId))).toBe(2);

        vi.useRealTimers();
    });
});
