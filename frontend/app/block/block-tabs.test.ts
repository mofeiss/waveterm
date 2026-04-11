// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getMountedBlockTabIds, resolveBlockTabViewModel, ROOT_TAB_ID } from "./block-tabs-util";

describe("getMountedBlockTabIds", () => {
    it("always keeps the root tab mounted", () => {
        expect(getMountedBlockTabIds([], ROOT_TAB_ID, [])).toEqual([ROOT_TAB_ID]);
    });

    it("adds the active child tab so it can stay mounted across switches", () => {
        expect(getMountedBlockTabIds([ROOT_TAB_ID], "child-1", ["child-1", "child-2"])).toEqual([
            ROOT_TAB_ID,
            "child-1",
        ]);
    });

    it("preserves previously mounted children while switching tabs", () => {
        expect(getMountedBlockTabIds([ROOT_TAB_ID, "child-1"], "child-2", ["child-1", "child-2"])).toEqual([
            ROOT_TAB_ID,
            "child-1",
            "child-2",
        ]);
    });

    it("drops removed child tabs from the mounted set", () => {
        expect(getMountedBlockTabIds([ROOT_TAB_ID, "child-1", "child-2"], "child-1", ["child-1"])).toEqual([
            ROOT_TAB_ID,
            "child-1",
        ]);
    });
});

describe("resolveBlockTabViewModel", () => {
    it("uses the root view model for the root tab without waiting", () => {
        const rootViewModel = { id: "root" };

        expect(resolveBlockTabViewModel(ROOT_TAB_ID, rootViewModel, () => null)).toEqual({
            viewModel: rootViewModel,
            isPending: false,
        });
    });

    it("temporarily falls back to the root view model while a child view model is not registered yet", () => {
        const rootViewModel = { id: "root" };

        expect(resolveBlockTabViewModel("child-1", rootViewModel, () => null)).toEqual({
            viewModel: rootViewModel,
            isPending: true,
        });
    });

    it("switches to the child view model as soon as it becomes available", () => {
        const rootViewModel = { id: "root" };
        const childViewModel = { id: "child-1" };

        expect(resolveBlockTabViewModel("child-1", rootViewModel, () => childViewModel)).toEqual({
            viewModel: childViewModel,
            isPending: false,
        });
    });
});
