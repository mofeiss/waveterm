// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { Modal } from "@/app/modals/modal";
import { modalsModel } from "@/app/store/modalmodel";
import * as keyutil from "@/util/keyutil";
import { useCallback, useEffect } from "react";

type BlockMultiTabCloseConfirmProps = {
    blockId: string;
    tabCount: number;
    onConfirm: () => void;
    onCancel?: () => void;
};

const BlockMultiTabCloseConfirm = ({ blockId, tabCount, onConfirm, onCancel }: BlockMultiTabCloseConfirmProps) => {
    const closeModal = useCallback(() => {
        modalsModel.popModal();
    }, []);

    const handleCancel = useCallback(() => {
        closeModal();
        onCancel?.();
    }, [closeModal, onCancel]);

    const handleConfirm = useCallback(() => {
        closeModal();
        onConfirm();
    }, [closeModal, onConfirm]);

    useEffect(() => {
        const keyHandler = keyutil.keydownWrapper((waveEvent: WaveKeyboardEvent) => {
            if (keyutil.checkKeyPressed(waveEvent, "Escape")) {
                handleCancel();
                return true;
            }
            if (keyutil.checkKeyPressed(waveEvent, "Enter")) {
                handleConfirm();
                return true;
            }
            return false;
        });
        document.addEventListener("keydown", keyHandler);
        return () => {
            document.removeEventListener("keydown", keyHandler);
        };
    }, [handleCancel, handleConfirm]);

    return (
        <Modal
            className="pt-6 pb-4 px-5"
            onOk={handleConfirm}
            onCancel={handleCancel}
            onClose={handleCancel}
            okLabel="Close Block"
            cancelLabel="Cancel"
        >
            <div className="mx-4 pb-2.5 text-lg font-bold text-primary">Close This Block?</div>
            <div className="mx-4 mb-4 flex max-w-[520px] flex-col gap-3 text-sm text-primary">
                <div>
                    This block contains <strong>{tabCount}</strong> tabs. Closing the block will close every tab in this
                    group.
                </div>
                <div className="opacity-70">Block: {blockId}</div>
                <div className="opacity-70">Press Enter to confirm, or Esc to cancel.</div>
            </div>
        </Modal>
    );
};

BlockMultiTabCloseConfirm.displayName = "BlockMultiTabCloseConfirm";

export { BlockMultiTabCloseConfirm };
