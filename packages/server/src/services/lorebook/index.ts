// ──────────────────────────────────────────────
// Lorebook Service: Orchestrator
// Ties together storage, scanning, and injection.
// ──────────────────────────────────────────────
import type { DB } from "../../db/connection.js";
import type { LorebookEntry } from "@marinara-engine/shared";
import { createLorebooksStorage } from "../storage/lorebooks.storage.js";
import {
  scanForActivatedEntries,
  recursiveScan,
  type ScanMessage,
  type ScanOptions,
  type GameStateForScanning,
  type ActivatedEntry,
} from "./keyword-scanner.js";
import { processActivatedEntries } from "./prompt-injector.js";

export interface LorebookScanResult {
  worldInfoBefore: string;
  worldInfoAfter: string;
  depthEntries: Array<{ content: string; role: "system" | "user" | "assistant"; depth: number; order: number }>;
  totalEntries: number;
  totalTokensEstimate: number;
  activatedEntryIds: string[];
}

/**
 * Main lorebook processing for a generation request.
 * 1. Fetch all active entries from enabled lorebooks
 * 2. Scan chat messages for keyword matches
 * 3. Process into injectable blocks
 */
export async function processLorebooks(
  db: DB,
  messages: ScanMessage[],
  gameState?: GameStateForScanning | null,
  options?: {
    chatId?: string;
    characterIds?: string[];
    activeLorebookIds?: string[];
    tokenBudget?: number;
    enableRecursive?: boolean;
    /** Pre-computed embedding of the chat context for semantic matching. */
    chatEmbedding?: number[] | null;
    /** Cosine similarity threshold for semantic matching (0-1, default 0.3). */
    semanticThreshold?: number;
  },
): Promise<LorebookScanResult> {
  const storage = createLorebooksStorage(db);

  // Build filters for scoped lorebook selection
  const filters =
    options?.chatId || options?.characterIds?.length || options?.activeLorebookIds?.length
      ? {
          chatId: options.chatId,
          characterIds: options.characterIds,
          activeLorebookIds: options.activeLorebookIds,
        }
      : undefined;

  // Fetch active entries (filtered if context provided)
  const allEntries = (await storage.listActiveEntries(filters)) as unknown as LorebookEntry[];

  if (allEntries.length === 0) {
    return {
      worldInfoBefore: "",
      worldInfoAfter: "",
      depthEntries: [],
      totalEntries: 0,
      totalTokensEstimate: 0,
      activatedEntryIds: [],
    };
  }

  // No global token budget — include all activated entries.
  // Each lorebook's own tokenBudget only serves as a hint for the UI;
  // prompt-level truncation is handled upstream by the assembler / context window.
  const tokenBudget = options?.tokenBudget ?? 0;

  // Scan for activated entries
  const scanOpts: ScanOptions = {
    scanDepth: 0, // Scan all messages
    gameState: gameState ?? null,
    chatEmbedding: options?.chatEmbedding ?? null,
    semanticThreshold: options?.semanticThreshold,
  };

  // Determine recursion settings from enabled lorebooks
  const enabledBooks = await storage.list();
  const activeBooks = enabledBooks.filter((b: { enabled: boolean }) => b.enabled);
  const anyRecursive =
    options?.enableRecursive || activeBooks.some((b: { recursiveScanning: boolean }) => b.recursiveScanning);
  const maxRecursionDepth = activeBooks.reduce(
    (max: number, b: { recursiveScanning: boolean; maxRecursionDepth?: number }) => {
      if (!b.recursiveScanning) return max;
      return Math.max(max, b.maxRecursionDepth ?? 3);
    },
    3,
  );

  let activated: ActivatedEntry[];
  if (anyRecursive) {
    activated = recursiveScan(messages, allEntries, scanOpts, maxRecursionDepth);
  } else {
    activated = scanForActivatedEntries(messages, allEntries, scanOpts);
  }

  // Decrement ephemeral counters for activated entries and auto-disable when exhausted
  const ephemeralUpdates: Array<{ id: string; ephemeral: number | null; disable: boolean }> = [];
  for (const a of activated) {
    if (a.entry.ephemeral !== null && a.entry.ephemeral > 0) {
      const remaining = a.entry.ephemeral - 1;
      ephemeralUpdates.push({ id: a.entry.id, ephemeral: remaining, disable: remaining <= 0 });
    }
  }
  if (ephemeralUpdates.length > 0) {
    for (const u of ephemeralUpdates) {
      try {
        const patch: Record<string, unknown> = { ephemeral: u.ephemeral };
        if (u.disable) patch.enabled = false;
        await storage.updateEntry(u.id, patch as any);
      } catch {
        // Non-fatal — don't crash generation if the DB write fails (e.g. SQLITE_READONLY)
      }
    }
  }

  // Process into injectable content
  const result = processActivatedEntries(activated, tokenBudget);

  return {
    ...result,
    activatedEntryIds: activated.map((a) => a.entry.id),
  };
}
