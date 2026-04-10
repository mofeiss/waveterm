// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

import { describe, expect, it } from "vitest";
import { getMountedBlockTabIds, ROOT_TAB_ID } from "./block-tabs-util";

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
