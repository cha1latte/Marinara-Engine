// ──────────────────────────────────────────────
// Lorebook Editor — Full-page detail view
// Replaces the chat area when editing a lorebook.
// Tabs: Overview, Entries, Entry Editor
// ──────────────────────────────────────────────
import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
  useLorebook,
  useUpdateLorebook,
  useLorebookEntries,
  useCreateLorebookEntry,
  useUpdateLorebookEntry,
  useDeleteLorebookEntry,
  useDeleteLorebook,
} from "../../hooks/use-lorebooks";
import { useUIStore } from "../../stores/ui.store";
import {
  ArrowLeft,
  Save,
  BookOpen,
  FileText,
  Plus,
  Trash2,
  Search,
  Settings2,
  Key,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  ChevronRight,
  Copy,
  Globe,
  Users,
  UserRound,
  ScrollText,
  Download,
  Maximize2,
  X,
} from "lucide-react";
import { cn } from "../../lib/utils";
import { HelpTooltip } from "../ui/HelpTooltip";
import { api } from "../../lib/api-client";
import type { Lorebook, LorebookEntry, LorebookCategory } from "@marinara-engine/shared";

// ── Types ──
const TABS = [
  { id: "overview", label: "Overview", icon: Settings2 },
  { id: "entries", label: "Entries", icon: FileText },
] as const;
type TabId = (typeof TABS)[number]["id"];

const CATEGORY_OPTIONS: Array<{ value: LorebookCategory; label: string; icon: typeof Globe }> = [
  { value: "world", label: "World", icon: Globe },
  { value: "character", label: "Character", icon: Users },
  { value: "npc", label: "NPC", icon: UserRound },
  { value: "summary", label: "Summary", icon: ScrollText },
  { value: "uncategorized", label: "Uncategorized", icon: BookOpen },
];

export function LorebookEditor() {
  const lorebookId = useUIStore((s) => s.lorebookDetailId);
  const closeDetail = useUIStore((s) => s.closeLorebookDetail);
  const { data: rawLorebook, isLoading } = useLorebook(lorebookId);
  const { data: rawEntries } = useLorebookEntries(lorebookId);
  const updateLorebook = useUpdateLorebook();
  const deleteLorebook = useDeleteLorebook();
  const createEntry = useCreateLorebookEntry();
  const updateEntry = useUpdateLorebookEntry();
  const deleteEntry = useDeleteLorebookEntry();

  const lorebook = rawLorebook as Lorebook | undefined;
  const entries = (rawEntries ?? []) as LorebookEntry[];

  const [activeTab, setActiveTab] = useState<TabId>("overview");
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [showUnsavedWarning, setShowUnsavedWarning] = useState(false);
  const [entrySearch, setEntrySearch] = useState("");

  // ── Form state for lorebook overview ──
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState<LorebookCategory>("uncategorized");
  const [formEnabled, setFormEnabled] = useState(true);
  const [formScanDepth, setFormScanDepth] = useState(2);
  const [formTokenBudget, setFormTokenBudget] = useState(2048);
  const [formRecursive, setFormRecursive] = useState(false);

  // ── Form state for entry editor ──
  const [entryForm, setEntryForm] = useState<Partial<LorebookEntry> | null>(null);

  // Load lorebook data into form
  useEffect(() => {
    if (!lorebook) return;
    setFormName(lorebook.name);
    setFormDescription(lorebook.description);
    setFormCategory(lorebook.category);
    setFormEnabled(lorebook.enabled);
    setFormScanDepth(lorebook.scanDepth);
    setFormTokenBudget(lorebook.tokenBudget);
    setFormRecursive(lorebook.recursiveScanning);
    setDirty(false);
  }, [lorebook]);

  // Load entry data into form
  useEffect(() => {
    if (!editingEntryId) {
      setEntryForm(null);
      return;
    }
    const entry = entries.find((e) => e.id === editingEntryId);
    if (entry) {
      setEntryForm({ ...entry });
    }
  }, [editingEntryId, entries]);

  // Filtered entries
  const filteredEntries = useMemo(() => {
    if (!entrySearch) return entries;
    const q = entrySearch.toLowerCase();
    return entries.filter(
      (e) =>
        e.name.toLowerCase().includes(q) ||
        e.keys.some((k) => k.toLowerCase().includes(q)) ||
        e.content.toLowerCase().includes(q),
    );
  }, [entries, entrySearch]);

  // ── Handlers ──
  const markDirty = useCallback(() => setDirty(true), []);

  const handleSaveLorebook = useCallback(async () => {
    if (!lorebookId) return;
    setSaving(true);
    try {
      await updateLorebook.mutateAsync({
        id: lorebookId,
        name: formName,
        description: formDescription,
        category: formCategory,
        enabled: formEnabled,
        scanDepth: formScanDepth,
        tokenBudget: formTokenBudget,
        recursiveScanning: formRecursive,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [
    lorebookId,
    formName,
    formDescription,
    formCategory,
    formEnabled,
    formScanDepth,
    formTokenBudget,
    formRecursive,
    updateLorebook,
  ]);

  const handleSaveEntry = useCallback(async () => {
    if (!lorebookId || !editingEntryId || !entryForm) return;
    setSaving(true);
    try {
      await updateEntry.mutateAsync({
        lorebookId,
        entryId: editingEntryId,
        name: entryForm.name,
        content: entryForm.content,
        keys: entryForm.keys,
        secondaryKeys: entryForm.secondaryKeys,
        enabled: entryForm.enabled,
        constant: entryForm.constant,
        selective: entryForm.selective,
        selectiveLogic: entryForm.selectiveLogic,
        matchWholeWords: entryForm.matchWholeWords,
        caseSensitive: entryForm.caseSensitive,
        useRegex: entryForm.useRegex,
        position: entryForm.position,
        depth: entryForm.depth,
        order: entryForm.order,
        role: entryForm.role,
        sticky: entryForm.sticky,
        cooldown: entryForm.cooldown,
        delay: entryForm.delay,
        group: entryForm.group,
        tag: entryForm.tag,
      });
      setDirty(false);
    } finally {
      setSaving(false);
    }
  }, [lorebookId, editingEntryId, entryForm, updateEntry]);

  const handleAddEntry = useCallback(async () => {
    if (!lorebookId) return;
    const result = await createEntry.mutateAsync({
      lorebookId,
      name: "New Entry",
      content: "",
      keys: [],
    });
    if (result && typeof result === "object" && "id" in result) {
      setEditingEntryId((result as LorebookEntry).id);
    }
  }, [lorebookId, createEntry]);

  const handleDeleteEntry = useCallback(
    async (entryId: string) => {
      if (!lorebookId) return;
      if (editingEntryId === entryId) setEditingEntryId(null);
      await deleteEntry.mutateAsync({ lorebookId, entryId });
    },
    [lorebookId, editingEntryId, deleteEntry],
  );

  const handleClose = useCallback(() => {
    if (dirty) {
      setShowUnsavedWarning(true);
    } else {
      closeDetail();
    }
  }, [dirty, closeDetail]);

  const handleDelete = useCallback(async () => {
    if (!lorebookId) return;
    await deleteLorebook.mutateAsync(lorebookId);
    closeDetail();
  }, [lorebookId, deleteLorebook, closeDetail]);

  // ── Loading ──
  if (isLoading || !lorebook) {
    return (
      <div className="flex flex-1 items-center justify-center">
        <div className="shimmer h-8 w-48 rounded-xl" />
      </div>
    );
  }

  // ── Entry editor sub-view ──
  if (editingEntryId && entryForm) {
    return (
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Entry editor header */}
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
          <button
            onClick={() => setEditingEntryId(null)}
            className="rounded-lg p-1.5 transition-colors hover:bg-[var(--accent)]"
          >
            <ArrowLeft size={16} />
          </button>
          <div className="min-w-0 flex-1">
            <input
              value={entryForm.name ?? ""}
              onChange={(e) => setEntryForm((f) => (f ? { ...f, name: e.target.value } : f))}
              className="w-full bg-transparent text-base font-semibold focus:outline-none"
              placeholder="Entry name"
            />
          </div>
          <button
            onClick={handleSaveEntry}
            disabled={saving}
            className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
          >
            <Save size={13} />
            {saving ? "Saving…" : "Save Entry"}
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          <div className="mx-auto max-w-3xl space-y-6">
            {/* Keys */}
            <FieldGroup
              label="Primary Keys"
              icon={Key}
              help="Keywords that trigger this entry. When any of these words appear in the chat, this entry's content is injected into the AI's context."
            >
              <KeysEditor
                keys={entryForm.keys ?? []}
                onChange={(keys) => setEntryForm((f) => (f ? { ...f, keys } : f))}
              />
            </FieldGroup>

            {/* Secondary Keys */}
            <FieldGroup
              label="Secondary Keys"
              icon={Key}
              help="Additional keywords used with AND/OR/NOT logic. 'AND' means both primary AND secondary must match. 'NOT' means primary must match but secondary must NOT."
            >
              <KeysEditor
                keys={entryForm.secondaryKeys ?? []}
                onChange={(keys) => setEntryForm((f) => (f ? { ...f, secondaryKeys: keys } : f))}
              />
              <div className="mt-2 flex items-center gap-3">
                <label className="text-[11px] text-[var(--muted-foreground)]">Logic:</label>
                {(["and", "or", "not"] as const).map((logic) => (
                  <button
                    key={logic}
                    onClick={() => setEntryForm((f) => (f ? { ...f, selectiveLogic: logic } : f))}
                    className={cn(
                      "rounded-md px-2 py-0.5 text-[11px] font-medium transition-colors",
                      entryForm.selectiveLogic === logic
                        ? "bg-[var(--accent)] text-[var(--accent-foreground)]"
                        : "text-[var(--muted-foreground)] hover:bg-[var(--secondary)]",
                    )}
                  >
                    {logic.toUpperCase()}
                  </button>
                ))}
              </div>
            </FieldGroup>

            {/* Content */}
            <FieldGroup
              label="Content"
              icon={FileText}
              help="The text that gets injected into the AI's context when this entry activates. Write it as you'd want the AI to know it."
            >
              <ExpandableTextarea
                value={entryForm.content ?? ""}
                onChange={(v) => setEntryForm((f) => (f ? { ...f, content: v } : f))}
                rows={8}
                placeholder="The content that will be injected into the prompt when this entry activates…"
                title="Edit Content"
              />
            </FieldGroup>

            {/* Toggles row */}
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <ToggleButton
                label="Enabled"
                value={entryForm.enabled ?? true}
                onChange={(v) => setEntryForm((f) => (f ? { ...f, enabled: v } : f))}
              />
              <ToggleButton
                label="Constant"
                value={entryForm.constant ?? false}
                onChange={(v) => setEntryForm((f) => (f ? { ...f, constant: v } : f))}
              />
              <ToggleButton
                label="Selective"
                value={entryForm.selective ?? false}
                onChange={(v) => setEntryForm((f) => (f ? { ...f, selective: v } : f))}
              />
              <ToggleButton
                label="Regex"
                value={entryForm.useRegex ?? false}
                onChange={(v) => setEntryForm((f) => (f ? { ...f, useRegex: v } : f))}
              />
              <ToggleButton
                label="Whole Words"
                value={entryForm.matchWholeWords ?? false}
                onChange={(v) => setEntryForm((f) => (f ? { ...f, matchWholeWords: v } : f))}
              />
              <ToggleButton
                label="Case Sensitive"
                value={entryForm.caseSensitive ?? false}
                onChange={(v) => setEntryForm((f) => (f ? { ...f, caseSensitive: v } : f))}
              />
            </div>

            {/* Injection settings */}
            <FieldGroup
              label="Injection"
              icon={Settings2}
              help="Controls where in the prompt this entry's content is placed. Position 0 = before chat history, 1 = after. Depth = how many messages back. Order = priority among entries."
            >
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <NumberField
                  label="Position"
                  value={entryForm.position ?? 0}
                  onChange={(v) => setEntryForm((f) => (f ? { ...f, position: v } : f))}
                  min={0}
                  max={1}
                />
                <NumberField
                  label="Depth"
                  value={entryForm.depth ?? 4}
                  onChange={(v) => setEntryForm((f) => (f ? { ...f, depth: v } : f))}
                  min={0}
                />
                <NumberField
                  label="Order"
                  value={entryForm.order ?? 100}
                  onChange={(v) => setEntryForm((f) => (f ? { ...f, order: v } : f))}
                />
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--muted-foreground)]">Role</label>
                  <select
                    value={entryForm.role ?? "system"}
                    onChange={(e) =>
                      setEntryForm((f) => (f ? { ...f, role: e.target.value as "system" | "user" | "assistant" } : f))
                    }
                    className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  >
                    <option value="system">System</option>
                    <option value="user">User</option>
                    <option value="assistant">Assistant</option>
                  </select>
                </div>
              </div>
            </FieldGroup>

            {/* Timing */}
            <FieldGroup
              label="Timing"
              icon={Settings2}
              help="Sticky = stays active for N messages after triggering. Cooldown = waits N messages before it can trigger again. Delay = waits N messages before first activation."
            >
              <div className="grid grid-cols-3 gap-3">
                <NumberField
                  label="Sticky"
                  value={entryForm.sticky ?? 0}
                  onChange={(v) => setEntryForm((f) => (f ? { ...f, sticky: v || null } : f))}
                  min={0}
                />
                <NumberField
                  label="Cooldown"
                  value={entryForm.cooldown ?? 0}
                  onChange={(v) => setEntryForm((f) => (f ? { ...f, cooldown: v || null } : f))}
                  min={0}
                />
                <NumberField
                  label="Delay"
                  value={entryForm.delay ?? 0}
                  onChange={(v) => setEntryForm((f) => (f ? { ...f, delay: v || null } : f))}
                  min={0}
                />
              </div>
            </FieldGroup>

            {/* Group & Tag */}
            <FieldGroup
              label="Group & Tag"
              icon={Settings2}
              help="Group entries together so only one from the group activates at a time. Tags are for your own organization."
            >
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--muted-foreground)]">Group</label>
                  <input
                    value={entryForm.group ?? ""}
                    onChange={(e) => setEntryForm((f) => (f ? { ...f, group: e.target.value } : f))}
                    className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    placeholder="Group name"
                  />
                </div>
                <div>
                  <label className="mb-1 block text-[11px] text-[var(--muted-foreground)]">Tag</label>
                  <input
                    value={entryForm.tag ?? ""}
                    onChange={(e) => setEntryForm((f) => (f ? { ...f, tag: e.target.value } : f))}
                    className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    placeholder="e.g. location, item, lore"
                  />
                </div>
              </div>
            </FieldGroup>
          </div>
        </div>
      </div>
    );
  }

  // ── Main editor ──
  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      {/* Unsaved warning banner */}
      {showUnsavedWarning && (
        <div className="flex items-center gap-3 bg-amber-500/10 px-4 py-2.5 text-xs">
          <AlertTriangle size={14} className="text-amber-400" />
          <span className="flex-1 text-amber-200">You have unsaved changes</span>
          <button
            onClick={() => setShowUnsavedWarning(false)}
            className="rounded-lg px-3 py-1 text-[11px] font-medium text-amber-300 ring-1 ring-amber-400/30 transition-colors hover:bg-amber-400/10"
          >
            Keep editing
          </button>
          <button
            onClick={() => {
              setShowUnsavedWarning(false);
              setDirty(false);
              closeDetail();
            }}
            className="rounded-lg px-3 py-1 text-[11px] font-medium text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)]"
          >
            Discard & close
          </button>
          <button
            onClick={async () => {
              await handleSaveLorebook();
              setShowUnsavedWarning(false);
              closeDetail();
            }}
            className="rounded-lg bg-amber-500 px-3 py-1 text-[11px] font-medium text-white transition-colors hover:bg-amber-600"
          >
            Save & close
          </button>
        </div>
      )}

      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-4 py-3">
        <button onClick={handleClose} className="rounded-lg p-1.5 transition-colors hover:bg-[var(--accent)]">
          <ArrowLeft size={16} />
        </button>
        <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-amber-400 to-orange-500 text-white shadow-sm">
          <BookOpen size={18} />
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold">{lorebook.name}</h2>
          <p className="truncate text-[11px] text-[var(--muted-foreground)]">
            {entries.length} entries • {lorebook.category}
          </p>
        </div>
        <button
          onClick={handleSaveLorebook}
          disabled={!dirty || saving}
          className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98] disabled:opacity-50"
        >
          <Save size={13} />
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          onClick={() => api.download(`/lorebooks/${lorebookId}/export`)}
          className="rounded-lg p-2 text-[var(--muted-foreground)] transition-colors hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="Export lorebook"
        >
          <svg width="14" height="14" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path
              d="M10 13V3m0 0l-4 4m4-4l4 4"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <rect x="3" y="15" width="14" height="2" rx="1" fill="currentColor" />
          </svg>
        </button>
        <button
          onClick={handleDelete}
          className="rounded-lg p-2 text-[var(--destructive)] transition-colors hover:bg-[var(--destructive)]/15"
          title="Delete lorebook"
        >
          <Trash2 size={14} />
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-[var(--border)]">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "flex items-center gap-1.5 border-b-2 px-4 py-2.5 text-xs font-medium transition-colors",
                activeTab === tab.id
                  ? "border-amber-400 text-amber-400"
                  : "border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)]",
              )}
            >
              <Icon size={13} />
              {tab.label}
              {tab.id === "entries" && (
                <span className="ml-1 rounded-full bg-[var(--secondary)] px-1.5 py-0.5 text-[10px]">
                  {entries.length}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto p-4">
        <div className="mx-auto max-w-3xl">
          {activeTab === "overview" && (
            <div className="space-y-6">
              {/* Name */}
              <div>
                <label className="mb-1.5 block text-xs font-medium">Name</label>
                <input
                  value={formName}
                  onChange={(e) => {
                    setFormName(e.target.value);
                    markDirty();
                  }}
                  className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
              </div>

              {/* Description */}
              <div>
                <label className="mb-1.5 block text-xs font-medium">Description</label>
                <textarea
                  value={formDescription}
                  onChange={(e) => {
                    setFormDescription(e.target.value);
                    markDirty();
                  }}
                  rows={3}
                  className="w-full resize-y rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                />
              </div>

              {/* Category */}
              <div>
                <label className="mb-1.5 block text-xs font-medium">Category</label>
                <div className="flex gap-2">
                  {CATEGORY_OPTIONS.map((opt) => {
                    const Icon = opt.icon;
                    return (
                      <button
                        key={opt.value}
                        onClick={() => {
                          setFormCategory(opt.value);
                          markDirty();
                        }}
                        className={cn(
                          "flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium transition-all",
                          formCategory === opt.value
                            ? "bg-amber-400/15 text-amber-400 ring-1 ring-amber-400/30"
                            : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-1 ring-[var(--border)] hover:bg-[var(--accent)]",
                        )}
                      >
                        <Icon size={13} />
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Enabled toggle */}
              <div className="flex items-center justify-between rounded-xl bg-[var(--secondary)] px-4 py-3 ring-1 ring-[var(--border)]">
                <div>
                  <p className="text-xs font-medium">Enabled</p>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    When off, entries in this lorebook won't activate
                  </p>
                </div>
                <button
                  onClick={() => {
                    setFormEnabled(!formEnabled);
                    markDirty();
                  }}
                  className="transition-colors"
                >
                  {formEnabled ? (
                    <ToggleRight size={28} className="text-amber-400" />
                  ) : (
                    <ToggleLeft size={28} className="text-[var(--muted-foreground)]" />
                  )}
                </button>
              </div>

              {/* Scan settings */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                    Scan Depth{" "}
                    <HelpTooltip text="How many recent messages to scan for keyword matches. Higher = searches further back in chat history, but uses more processing." />
                  </label>
                  <input
                    type="number"
                    value={formScanDepth}
                    onChange={(e) => {
                      setFormScanDepth(parseInt(e.target.value) || 0);
                      markDirty();
                    }}
                    min={0}
                    className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  />
                </div>
                <div>
                  <label className="mb-1.5 flex items-center gap-1 text-xs font-medium">
                    Token Budget{" "}
                    <HelpTooltip text="Maximum number of tokens this lorebook can inject per generation. Prevents a lorebook from consuming too much of the context window." />
                  </label>
                  <input
                    type="number"
                    value={formTokenBudget}
                    onChange={(e) => {
                      setFormTokenBudget(parseInt(e.target.value) || 0);
                      markDirty();
                    }}
                    min={0}
                    className="w-full rounded-xl bg-[var(--secondary)] px-3 py-2.5 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  />
                </div>
                <div className="flex items-end">
                  <div className="flex items-center justify-between rounded-xl bg-[var(--secondary)] px-3 py-2.5 ring-1 ring-[var(--border)]">
                    <span className="mr-2 text-xs">Recursive</span>
                    <button
                      onClick={() => {
                        setFormRecursive(!formRecursive);
                        markDirty();
                      }}
                    >
                      {formRecursive ? (
                        <ToggleRight size={22} className="text-amber-400" />
                      ) : (
                        <ToggleLeft size={22} className="text-[var(--muted-foreground)]" />
                      )}
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === "entries" && (
            <div className="space-y-3">
              {/* Search + Add */}
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Search
                    size={13}
                    className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--muted-foreground)]"
                  />
                  <input
                    type="text"
                    placeholder="Search entries…"
                    value={entrySearch}
                    onChange={(e) => setEntrySearch(e.target.value)}
                    className="w-full rounded-xl bg-[var(--secondary)] py-2.5 pl-8 pr-3 text-xs ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                  />
                </div>
                <button
                  onClick={handleAddEntry}
                  className="flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-2.5 text-xs font-medium text-white shadow-md transition-all hover:shadow-lg active:scale-[0.98]"
                >
                  <Plus size={13} />
                  Add Entry
                </button>
              </div>

              {/* Entry list */}
              {filteredEntries.length === 0 && (
                <div className="flex flex-col items-center gap-2 py-8 text-center">
                  <FileText size={24} className="text-[var(--muted-foreground)]" />
                  <p className="text-xs text-[var(--muted-foreground)]">
                    {entrySearch ? "No entries match your search" : "No entries yet — add one to get started"}
                  </p>
                </div>
              )}

              {filteredEntries.map((entry) => (
                <div
                  key={entry.id}
                  onClick={() => setEditingEntryId(entry.id)}
                  className="group flex cursor-pointer items-center gap-3 rounded-xl bg-[var(--secondary)] p-3 ring-1 ring-[var(--border)] transition-all hover:ring-amber-400/30"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={cn("h-2 w-2 rounded-full", entry.enabled ? "bg-emerald-400" : "bg-zinc-500")} />
                      <span className="truncate text-sm font-medium">{entry.name}</span>
                      {entry.constant && (
                        <span className="rounded bg-amber-400/15 px-1.5 py-0.5 text-[9px] font-medium text-amber-400">
                          CONST
                        </span>
                      )}
                      {entry.tag && (
                        <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[9px] text-[var(--muted-foreground)]">
                          {entry.tag}
                        </span>
                      )}
                    </div>
                    <div className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--muted-foreground)]">
                      <span className="flex items-center gap-1">
                        <Key size={10} />
                        {entry.keys.length > 0 ? entry.keys.slice(0, 3).join(", ") : "No keys"}
                        {entry.keys.length > 3 && ` +${entry.keys.length - 3}`}
                      </span>
                      <span>•</span>
                      <span>Order {entry.order}</span>
                      <span>•</span>
                      <span>Depth {entry.depth}</span>
                    </div>
                  </div>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      handleDeleteEntry(entry.id);
                    }}
                    className="rounded-lg p-1.5 opacity-0 transition-all hover:bg-[var(--destructive)]/15 group-hover:opacity-100"
                  >
                    <Trash2 size={12} className="text-[var(--destructive)]" />
                  </button>
                  <ChevronRight size={14} className="text-[var(--muted-foreground)]" />
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Reusable sub-components ──

function FieldGroup({
  label,
  icon: Icon,
  help,
  children,
}: {
  label: string;
  icon: typeof FileText;
  help?: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center gap-1.5 text-xs font-medium">
        <Icon size={13} className="text-amber-400" />
        {label}
        {help && <HelpTooltip text={help} />}
      </div>
      {children}
    </div>
  );
}

function KeysEditor({ keys, onChange }: { keys: string[]; onChange: (keys: string[]) => void }) {
  const [input, setInput] = useState("");

  const addKey = () => {
    const trimmed = input.trim();
    if (trimmed && !keys.includes(trimmed)) {
      onChange([...keys, trimmed]);
      setInput("");
    }
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        {keys.map((key, i) => (
          <span
            key={i}
            className="flex items-center gap-1 rounded-lg bg-amber-400/15 px-2 py-1 text-[11px] text-amber-300"
          >
            {key}
            <button
              onClick={() => onChange(keys.filter((_, j) => j !== i))}
              className="ml-0.5 rounded-sm hover:text-[var(--destructive)]"
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <div className="mt-1.5 flex gap-1.5">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addKey())}
          className="flex-1 rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          placeholder="Type a keyword and press Enter…"
        />
        <button
          onClick={addKey}
          className="rounded-lg bg-[var(--accent)] px-2 py-1.5 text-[11px] font-medium transition-colors hover:bg-[var(--accent)]/80"
        >
          Add
        </button>
      </div>
    </div>
  );
}

function ToggleButton({ label, value, onChange }: { label: string; value: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!value)}
      className={cn(
        "flex items-center justify-between rounded-xl px-3 py-2.5 text-xs font-medium ring-1 transition-all",
        value
          ? "bg-amber-400/15 text-amber-400 ring-amber-400/30"
          : "bg-[var(--secondary)] text-[var(--muted-foreground)] ring-[var(--border)]",
      )}
    >
      {label}
      {value ? <ToggleRight size={18} /> : <ToggleLeft size={18} />}
    </button>
  );
}

function NumberField({
  label,
  value,
  onChange,
  min,
  max,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min?: number;
  max?: number;
}) {
  return (
    <div>
      <label className="mb-1 block text-[11px] text-[var(--muted-foreground)]">{label}</label>
      <input
        type="number"
        value={value}
        onChange={(e) => onChange(parseInt(e.target.value) || 0)}
        min={min}
        max={max}
        className="w-full rounded-lg bg-[var(--secondary)] px-2 py-1.5 text-xs ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
      />
    </div>
  );
}

/** Textarea with an expand button that opens a fullscreen modal editor. */
function ExpandableTextarea({
  value,
  onChange,
  rows,
  placeholder,
  title,
}: {
  value: string;
  onChange: (v: string) => void;
  rows?: number;
  placeholder?: string;
  title?: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={rows ?? 6}
          className="w-full resize-y rounded-xl bg-[var(--secondary)] p-3 pr-9 text-sm ring-1 ring-[var(--border)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
          placeholder={placeholder}
        />
        <button
          onClick={() => setExpanded(true)}
          className="absolute right-2 top-2 rounded-md p-1 text-[var(--muted-foreground)] hover:bg-[var(--accent)] hover:text-[var(--foreground)]"
          title="Expand editor"
        >
          <Maximize2 size={13} />
        </button>
      </div>

      {expanded && (
        <ExpandedContentModal
          title={title ?? "Edit"}
          value={value}
          onChange={onChange}
          onClose={() => setExpanded(false)}
          placeholder={placeholder}
        />
      )}
    </>
  );
}

/** Fullscreen modal editor for lorebook entry fields. */
function ExpandedContentModal({
  title,
  value,
  onChange,
  onClose,
  placeholder,
}: {
  title: string;
  value: string;
  onChange: (v: string) => void;
  onClose: () => void;
  placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setTimeout(() => textareaRef.current?.focus(), 100);
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onChange(local);
        onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [onClose, onChange, local]);

  const handleClose = () => {
    onChange(local);
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-6">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={handleClose} />
      <div className="relative flex h-[80vh] w-full max-w-3xl flex-col rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl shadow-black/50">
        <div className="flex items-center justify-between border-b border-[var(--border)] px-4 py-3">
          <h3 className="text-sm font-semibold">{title}</h3>
          <button onClick={handleClose} className="rounded-lg p-1.5 hover:bg-[var(--accent)]">
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 overflow-hidden p-4">
          <textarea
            ref={textareaRef}
            value={local}
            onChange={(e) => setLocal(e.target.value)}
            className="h-full w-full resize-none rounded-lg bg-[var(--secondary)] p-4 text-sm text-[var(--foreground)] ring-1 ring-[var(--border)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
            placeholder={placeholder}
          />
        </div>
        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
          <p className="text-[10px] text-[var(--muted-foreground)]">
            Changes auto-save on close. Press Escape to close.
          </p>
          <button
            onClick={handleClose}
            className="rounded-xl bg-gradient-to-r from-amber-400 to-orange-500 px-4 py-1.5 text-xs font-medium text-white shadow-md hover:shadow-lg active:scale-[0.98]"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
