// Copyright 2026, Command Line Inc.
// SPDX-License-Identifier: Apache-2.0

export type BlockTabTrace = {
    id: number;
    label: string;
    nextStep: number;
    startedAt: number;
};

let nextBlockTabTraceId = 1;
let nextBlockTabExtraId = 1;
let latestBlockTabTraceId: number | null = null;

function emitBlockTabTraceLog(message: string) {
    console.log(message);
    try {
        window.api?.sendLog?.(message);
    } catch (_) {}
}

function formatTraceDetails(details?: Record<string, unknown>): string {
    if (details == null) {
        return "";
    }
    const entries = Object.entries(details).filter(([, value]) => value !== undefined);
    if (entries.length === 0) {
        return "";
    }
    return entries
        .map(([key, value]) => {
            if (typeof value === "string") {
                return `${key}=${JSON.stringify(value)}`;
            }
            return `${key}=${JSON.stringify(value)}`;
        })
        .join(" ");
}

export function startBlockTabTrace(label: string, details?: Record<string, unknown>): BlockTabTrace {
    const trace: BlockTabTrace = {
        id: nextBlockTabTraceId++,
        label,
        nextStep: 2,
        startedAt: Date.now(),
    };
    latestBlockTabTraceId = trace.id;
    const detailsStr = formatTraceDetails(details);
    emitBlockTabTraceLog(`[blocktab-trace#${trace.id}] [1] START ${label}${detailsStr ? ` ${detailsStr}` : ""}`);
    return trace;
}

export function logBlockTabTrace(trace: BlockTabTrace | null | undefined, message: string, details?: Record<string, unknown>) {
    if (trace == null) {
        return;
    }
    latestBlockTabTraceId = trace.id;
    const step = trace.nextStep++;
    const detailsStr = formatTraceDetails(details);
    emitBlockTabTraceLog(`[blocktab-trace#${trace.id}] [${step}] ${message}${detailsStr ? ` ${detailsStr}` : ""}`);
}

export function endBlockTabTrace(trace: BlockTabTrace | null | undefined, outcome: string, details?: Record<string, unknown>) {
    if (trace == null) {
        return;
    }
    latestBlockTabTraceId = trace.id;
    const step = trace.nextStep++;
    const detailsStr = formatTraceDetails({
        ...details,
        durationMs: Date.now() - trace.startedAt,
    });
    emitBlockTabTraceLog(`[blocktab-trace#${trace.id}] [${step}] END ${outcome}${detailsStr ? ` ${detailsStr}` : ""}`);
}

export function getLatestBlockTabTraceId(): number | null {
    return latestBlockTabTraceId;
}

export function logBlockTabExtra(message: string, details?: Record<string, unknown>) {
    const extraId = nextBlockTabExtraId++;
    const detailsStr = formatTraceDetails({
        latestTraceId: latestBlockTabTraceId,
        ...details,
    });
    emitBlockTabTraceLog(`[blocktab-extra#${extraId}] [1] ${message}${detailsStr ? ` ${detailsStr}` : ""}`);
}
