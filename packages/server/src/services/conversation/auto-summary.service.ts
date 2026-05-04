// ──────────────────────────────────────────────
// Conversation Auto-Summaries
// ──────────────────────────────────────────────
// Shared daily/weekly summary generation for conversation mode.

import type { DaySummaryEntry, WeekSummaryEntry } from "@marinara-engine/shared";
import type { BaseLLMProvider } from "../llm/base-provider.js";
import { stripConversationPromptTimestamps } from "./transcript-sanitize.js";

export interface ConversationSummaryMessage {
  id?: string;
  role: string;
  content: string | null;
  characterId?: string | null;
  createdAt?: string | null;
}

export interface ConversationSummaryRunResult {
  daySummaries: Record<string, DaySummaryEntry>;
  weekSummaries: Record<string, WeekSummaryEntry>;
  newlyGeneratedDays: Record<string, DaySummaryEntry>;
  newlyConsolidatedWeeks: Record<string, WeekSummaryEntry>;
  failedDays: Array<{ date: string; error: string }>;
  failedWeeks: Array<{ weekKey: string; error: string }>;
  missingDayCount: number;
  processedDayCount: number;
  remainingMissingDayCount: number;
}

interface ConversationSummaryDayBucket {
  date: string;
  msgs: Array<{ role: string; content: string; author: string; ts: Date }>;
}

interface GenerateMissingConversationSummariesOptions {
  messages: ConversationSummaryMessage[];
  metadata: Record<string, unknown>;
  provider: BaseLLMProvider;
  model: string;
  personaName: string;
  charIdToName: Map<string, string>;
  now?: Date;
  rolloverHour?: number;
  timeoutMs?: number;
  maxMissingDays?: number;
}

const DEFAULT_SUMMARY_TIMEOUT_MS = 300_000;
const DAILY_TRANSCRIPT_CHUNK_CHARS = 32_000;
const MAX_SUMMARY_CHUNKS_PER_DAY = 12;

function coerceSummaryEntry(value: unknown): DaySummaryEntry | null {
  if (typeof value === "string") {
    const summary = value.trim();
    return summary ? { summary, keyDetails: [] } : null;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const summary = typeof record.summary === "string" ? record.summary.trim() : "";
  const keyDetails = Array.isArray(record.keyDetails)
    ? record.keyDetails.filter((detail): detail is string => typeof detail === "string" && detail.trim().length > 0)
    : [];
  return summary || keyDetails.length > 0 ? { summary, keyDetails } : null;
}

export function normalizeDaySummaries(raw: unknown): Record<string, DaySummaryEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, DaySummaryEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = coerceSummaryEntry(value);
    if (entry) out[key] = entry;
  }
  return out;
}

export function normalizeWeekSummaries(raw: unknown): Record<string, WeekSummaryEntry> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: Record<string, WeekSummaryEntry> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = coerceSummaryEntry(value);
    if (entry) out[key] = entry;
  }
  return out;
}

export function parseConversationDateKey(dateKey: string): Date {
  const [dd, mm, yyyy] = dateKey.split(".");
  return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
}

export function formatConversationDateKey(date: Date): string {
  return `${String(date.getDate()).padStart(2, "0")}.${String(date.getMonth() + 1).padStart(2, "0")}.${date.getFullYear()}`;
}

export function getConversationWeekMonday(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + diff);
}

function logicalDate(date: Date, rolloverHour: number): Date {
  return new Date(date.getTime() - rolloverHour * 3_600_000);
}

function logicalDateKey(date: Date, rolloverHour: number): string {
  return formatConversationDateKey(logicalDate(date, rolloverHour));
}

function getMessageAuthor(
  message: ConversationSummaryMessage,
  personaName: string,
  charIdToName: Map<string, string>,
): string {
  if (message.role === "user") return personaName;
  if (message.characterId && charIdToName.has(message.characterId)) return charIdToName.get(message.characterId)!;
  if (message.role === "assistant") return "Character";
  if (message.role === "narrator") return "Narrator";
  return "System";
}

function buildDayBuckets(
  messages: ConversationSummaryMessage[],
  personaName: string,
  charIdToName: Map<string, string>,
  rolloverHour: number,
): ConversationSummaryDayBucket[] {
  const buckets = new Map<string, ConversationSummaryDayBucket>();
  for (const message of messages) {
    if (!message.createdAt) continue;
    const createdAt = new Date(message.createdAt);
    if (!Number.isFinite(createdAt.getTime())) continue;
    const content = stripConversationPromptTimestamps((message.content ?? "").trim());
    if (!content) continue;

    const date = logicalDateKey(createdAt, rolloverHour);
    const bucket = buckets.get(date) ?? { date, msgs: [] };
    bucket.msgs.push({
      role: message.role,
      content,
      author: getMessageAuthor(message, personaName, charIdToName),
      ts: createdAt,
    });
    buckets.set(date, bucket);
  }

  return [...buckets.values()].sort(
    (a, b) => parseConversationDateKey(a.date).getTime() - parseConversationDateKey(b.date).getTime(),
  );
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("Summary timeout")), ms)),
  ]);
}

function cleanJsonishResponse(raw: string): string {
  const trimmed = raw.trim();
  const fenceMatch = trimmed.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (fenceMatch) return fenceMatch[1]!.trim();
  const first = trimmed.indexOf("{");
  const last = trimmed.lastIndexOf("}");
  if (first >= 0 && last > first) return trimmed.slice(first, last + 1);
  return trimmed;
}

function parseSummaryResponse(raw: string): DaySummaryEntry {
  const trimmed = raw.trim();
  try {
    const parsed = JSON.parse(cleanJsonishResponse(trimmed)) as Record<string, unknown>;
    return {
      summary: (typeof parsed.summary === "string" ? parsed.summary : trimmed).trim(),
      keyDetails: Array.isArray(parsed.keyDetails)
        ? parsed.keyDetails.filter((detail): detail is string => typeof detail === "string" && detail.trim().length > 0)
        : [],
    };
  } catch {
    return { summary: trimmed, keyDetails: [] };
  }
}

function dailySummarySystemPrompt(date: string, scope: string): string {
  return [
    `You are a conversation memory assistant. You will receive ${scope} DM conversation from ${date}.`,
    `Produce a JSON object with two fields:`,
    ``,
    `1. "summary" — A brief narrative paragraph (2-4 sentences, third person) covering what happened: topics discussed, key moments, emotional tone, and important exchanges.`,
    ``,
    `2. "keyDetails" — An array of short, specific strings listing things the characters MUST remember going forward. Include:`,
    `   - Promises or commitments made ("Alice promised to call Bob tomorrow morning")`,
    `   - Plans or appointments ("They agreed to watch a movie together on Friday")`,
    `   - Unresolved questions or topics left hanging ("Bob asked about Alice's job interview — she said she'd tell him later")`,
    `   - Emotional events that would affect future interactions ("Alice confided she's been feeling lonely lately")`,
    `   - New information revealed ("Bob mentioned he has a sister named Clara")`,
    `   - Requests or things someone said they'd do ("Alice said she'd send the recipe")`,
    `   If nothing important needs to be carried forward, use an empty array.`,
    ``,
    `Respond with ONLY valid JSON. No markdown fences, no extra text.`,
  ].join("\n");
}

function chunkTranscriptLines(lines: string[], maxChars: number): string[] {
  const chunks: string[] = [];
  let current = "";
  for (const line of lines) {
    const next = current ? `${current}\n${line}` : line;
    if (next.length > maxChars && current) {
      chunks.push(current);
      current = line;
    } else {
      current = next;
    }
  }
  if (current) chunks.push(current);
  return chunks.slice(0, MAX_SUMMARY_CHUNKS_PER_DAY);
}

async function summarizeTranscript(
  provider: BaseLLMProvider,
  model: string,
  systemPrompt: string,
  userContent: string,
  timeoutMs: number,
  maxTokens = 4096,
): Promise<DaySummaryEntry> {
  const result = await withTimeout(
    provider.chatComplete(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userContent },
      ],
      { model, temperature: 0.3, maxTokens },
    ),
    timeoutMs,
  );
  return parseSummaryResponse(result.content ?? "");
}

async function summarizeDayBucket(
  provider: BaseLLMProvider,
  model: string,
  bucket: ConversationSummaryDayBucket,
  timeoutMs: number,
): Promise<DaySummaryEntry> {
  const transcriptLines = bucket.msgs.map((message) => `${message.author}: ${message.content}`);
  const chunks = chunkTranscriptLines(transcriptLines, DAILY_TRANSCRIPT_CHUNK_CHARS);

  if (chunks.length <= 1) {
    return summarizeTranscript(
      provider,
      model,
      dailySummarySystemPrompt(bucket.date, "a full day's"),
      chunks[0] ?? "",
      timeoutMs,
    );
  }

  const partials: DaySummaryEntry[] = [];
  for (let i = 0; i < chunks.length; i++) {
    const partial = await summarizeTranscript(
      provider,
      model,
      dailySummarySystemPrompt(bucket.date, `part ${i + 1} of ${chunks.length} of a long day's`),
      chunks[i]!,
      timeoutMs,
      2048,
    );
    if (partial.summary || partial.keyDetails.length > 0) partials.push(partial);
  }

  const combinedInput = partials
    .map((entry, index) => {
      const keyDetails = entry.keyDetails.length > 0 ? `\nKey details: ${entry.keyDetails.join("; ")}` : "";
      return `[Part ${index + 1}]\n${entry.summary}${keyDetails}`;
    })
    .join("\n\n");

  return summarizeTranscript(
    provider,
    model,
    [
      `You are a conversation memory assistant. You will receive partial summaries for ${bucket.date}.`,
      `Combine them into one final JSON object with "summary" and "keyDetails".`,
      `Remove duplicates, preserve unresolved promises/plans, and keep only durable details that matter later.`,
      `Respond with ONLY valid JSON. No markdown fences, no extra text.`,
    ].join("\n"),
    combinedInput,
    timeoutMs,
  );
}

function weekSummarySystemPrompt(rangeLabel: string): string {
  return [
    `You are a conversation memory assistant. You will receive daily conversation summaries for the week of ${rangeLabel}.`,
    `Produce a JSON object with two fields:`,
    ``,
    `1. "summary" — A cohesive narrative paragraph (3-6 sentences, third person) covering the week: major topics, relationship developments, emotional arc, and significant events. Weave the days together naturally — don't just list each day separately.`,
    ``,
    `2. "keyDetails" — A consolidated array of short, specific strings listing things the characters MUST still remember going forward. Review the daily key details and:`,
    `   - KEEP details that are still relevant (upcoming plans, ongoing commitments, unresolved topics)`,
    `   - MERGE duplicates or evolving items into their latest state`,
    `   - DROP details that were already resolved during the week (e.g. "promised to send recipe" if it was sent later that week)`,
    `   - ADD any overarching patterns or relationship developments worth remembering`,
    ``,
    `Respond with ONLY valid JSON. No markdown fences, no extra text.`,
  ].join("\n");
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function generateMissingConversationSummaries(
  options: GenerateMissingConversationSummariesOptions,
): Promise<ConversationSummaryRunResult> {
  const rolloverHour = Math.max(0, Math.min(11, Math.floor(options.rolloverHour ?? 4)));
  const timeoutMs = options.timeoutMs ?? DEFAULT_SUMMARY_TIMEOUT_MS;
  const now = options.now ?? new Date();
  const todayDateKey = logicalDateKey(now, rolloverHour);
  const daySummaries = normalizeDaySummaries(options.metadata.daySummaries);
  const weekSummaries = normalizeWeekSummaries(options.metadata.weekSummaries);

  const buckets = buildDayBuckets(options.messages, options.personaName, options.charIdToName, rolloverHour);
  const pastBuckets = buckets.filter((bucket) => bucket.date !== todayDateKey);
  const missingBuckets = pastBuckets.filter((bucket) => !daySummaries[bucket.date]);
  const maxMissingDays =
    typeof options.maxMissingDays === "number" && Number.isFinite(options.maxMissingDays)
      ? Math.max(0, Math.floor(options.maxMissingDays))
      : missingBuckets.length;
  const bucketsToProcess = missingBuckets.slice(0, maxMissingDays);

  const newlyGeneratedDays: Record<string, DaySummaryEntry> = {};
  const newlyConsolidatedWeeks: Record<string, WeekSummaryEntry> = {};
  const failedDays: Array<{ date: string; error: string }> = [];
  const failedWeeks: Array<{ weekKey: string; error: string }> = [];

  for (const bucket of bucketsToProcess) {
    try {
      const entry = await summarizeDayBucket(options.provider, options.model, bucket, timeoutMs);
      if (entry.summary || entry.keyDetails.length > 0) {
        daySummaries[bucket.date] = entry;
        newlyGeneratedDays[bucket.date] = entry;
      }
    } catch (error) {
      failedDays.push({ date: bucket.date, error: errorMessage(error) });
    }
  }

  const messageDaysByWeek = new Map<string, Set<string>>();
  for (const bucket of pastBuckets) {
    const weekKey = formatConversationDateKey(getConversationWeekMonday(parseConversationDateKey(bucket.date)));
    const set = messageDaysByWeek.get(weekKey) ?? new Set<string>();
    set.add(bucket.date);
    messageDaysByWeek.set(weekKey, set);
  }

  const daysByWeek = new Map<string, Array<{ dateKey: string; entry: DaySummaryEntry }>>();
  for (const [dateKey, entry] of Object.entries(daySummaries)) {
    const weekKey = formatConversationDateKey(getConversationWeekMonday(parseConversationDateKey(dateKey)));
    const days = daysByWeek.get(weekKey) ?? [];
    days.push({ dateKey, entry });
    daysByWeek.set(weekKey, days);
  }

  for (const [weekKey, days] of daysByWeek) {
    if (weekSummaries[weekKey]) continue;
    const monday = parseConversationDateKey(weekKey);
    const nextMonday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 7);
    if (logicalDate(now, rolloverHour).getTime() < nextMonday.getTime()) continue;

    const messageDays = messageDaysByWeek.get(weekKey);
    if (messageDays && [...messageDays].some((dateKey) => !daySummaries[dateKey])) continue;

    try {
      days.sort(
        (a, b) => parseConversationDateKey(a.dateKey).getTime() - parseConversationDateKey(b.dateKey).getTime(),
      );
      const sunday = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + 6);
      const rangeLabel = `${weekKey} – ${formatConversationDateKey(sunday)}`;
      const dayBlocks = days.map((day) => {
        const keyDetails = day.entry.keyDetails.length > 0 ? `\nKey details: ${day.entry.keyDetails.join("; ")}` : "";
        return `[${day.dateKey}]\n${day.entry.summary}${keyDetails}`;
      });
      const entry = await summarizeTranscript(
        options.provider,
        options.model,
        weekSummarySystemPrompt(rangeLabel),
        dayBlocks.join("\n\n"),
        timeoutMs,
      );
      if (entry.summary || entry.keyDetails.length > 0) {
        weekSummaries[weekKey] = entry;
        newlyConsolidatedWeeks[weekKey] = entry;
      }
    } catch (error) {
      failedWeeks.push({ weekKey, error: errorMessage(error) });
    }
  }

  return {
    daySummaries,
    weekSummaries,
    newlyGeneratedDays,
    newlyConsolidatedWeeks,
    failedDays,
    failedWeeks,
    missingDayCount: missingBuckets.length,
    processedDayCount: bucketsToProcess.length,
    remainingMissingDayCount: Math.max(0, missingBuckets.length - bucketsToProcess.length),
  };
}
