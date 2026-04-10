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
                WOS: {
                    makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
                },
                atom: jotai.atom,
            };
        });
        vi.doMock("@/app/store/wshrpcutil", () => ({
            TabRpcClient: {},
        }));
        vi.doMock("@/app/store/wshclientapi", () => ({
            RpcApi: {
                SetMetaCommand: vi.fn().mockResolvedValue(undefined),
            },
        }));

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

    it("hydrates the lock state from block meta and persists updates back to meta", async () => {
        const store = createStore();
        const blockAtoms = new Map<string, any>();
        const setMetaMock = vi.fn().mockResolvedValue(undefined);

        vi.resetModules();
        vi.doMock("@/app/store/global", async () => {
            const jotai = await import("jotai");
            return {
                globalStore: store,
                refocusNode: vi.fn(),
                useBlockAtom: (blockId: string, key: string, createAtom: () => any) => {
                    const atomKey = `${blockId}:${key}`;
                    if (!blockAtoms.has(atomKey)) {
                        blockAtoms.set(atomKey, createAtom());
                    }
                    return blockAtoms.get(atomKey);
                },
                getBlockMetaKeyAtom: (blockId: string, key: keyof MetaType) => {
                    const atomKey = `${blockId}:meta:${String(key)}`;
                    if (!blockAtoms.has(atomKey)) {
                        blockAtoms.set(atomKey, jotai.atom<boolean | undefined>(undefined));
                    }
                    return blockAtoms.get(atomKey);
                },
                WOS: {
                    makeORef: (otype: string, oid: string) => `${otype}:${oid}`,
                },
            };
        });
        vi.doMock("@/app/store/wshrpcutil", () => ({
            TabRpcClient: {},
        }));
        vi.doMock("@/app/store/wshclientapi", () => ({
            RpcApi: {
                SetMetaCommand: setMetaMock,
            },
        }));

        const { BLOCK_CLOSE_LOCK_METAKEY, getBlockCloseLockedAtom, setBlockCloseLocked } = await import("./block-close-guard");

        const blockId = "block-2";
        const closeLockedAtom = getBlockCloseLockedAtom(blockId);
        const metaAtom = blockAtoms.get(`${blockId}:meta:${BLOCK_CLOSE_LOCK_METAKEY}`);
        store.set(metaAtom, true);

        expect(store.get(closeLockedAtom)).toBe(true);

        setBlockCloseLocked(blockId, false);

        expect(store.get(closeLockedAtom)).toBe(false);
        expect(setMetaMock).toHaveBeenCalledWith(
            {},
            {
                oref: "block:block-2",
                meta: { [BLOCK_CLOSE_LOCK_METAKEY]: null },
            }
        );
    });
});
