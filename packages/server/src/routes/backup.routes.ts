// ──────────────────────────────────────────────
// Routes: Backup
// ──────────────────────────────────────────────
import type { FastifyInstance } from "fastify";
import { DATA_DIR } from "../utils/data-dir.js";
import { basename, join } from "path";
import { existsSync, readdirSync, statSync } from "fs";
import { cp, mkdir, copyFile, readFile } from "fs/promises";
import { createCharactersStorage } from "../services/storage/characters.storage.js";
import { createLorebooksStorage } from "../services/storage/lorebooks.storage.js";
import { createPromptsStorage } from "../services/storage/prompts.storage.js";
import { createAgentsStorage } from "../services/storage/agents.storage.js";
import type { ExportEnvelope } from "@marinara-engine/shared";

/** Directories inside DATA_DIR that should be included in every backup. */
const BACKUP_DIRS = ["avatars", "sprites", "backgrounds", "gallery", "fonts", "knowledge-sources"];

/** The primary database filename. */
const DB_FILENAME = "marinara-engine.db";

/** Resolve the actual database file path, respecting DATABASE_URL. */
const DB_PATH = (process.env.DATABASE_URL ?? `file:${join(DATA_DIR, DB_FILENAME)}`).replace(/^file:/, "");

export async function backupRoutes(app: FastifyInstance) {
  // Create a full backup folder
  app.post("/", async (_req, reply) => {
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").slice(0, 19);
    const backupName = `marinara-backup-${timestamp}`;
    const backupsRoot = join(DATA_DIR, "backups");
    const backupDir = join(backupsRoot, backupName);

    await mkdir(backupDir, { recursive: true });

    // 1. Copy the database file (respects DATABASE_URL)
    const dbName = basename(DB_PATH);
    if (existsSync(DB_PATH)) {
      await copyFile(DB_PATH, join(backupDir, dbName));
      // Also copy WAL/SHM if they exist (for a complete backup)
      for (const ext of ["-wal", "-shm"]) {
        const walSrc = DB_PATH + ext;
        if (existsSync(walSrc)) {
          await copyFile(walSrc, join(backupDir, dbName + ext));
        }
      }
    }

    // 2. Copy data directories
    for (const dirName of BACKUP_DIRS) {
      const src = join(DATA_DIR, dirName);
      if (existsSync(src)) {
        await cp(src, join(backupDir, dirName), { recursive: true });
      }
    }

    return reply.send({
      success: true,
      backupName,
    });
  });

  // List existing backups
  app.get("/", async () => {
    const backupsRoot = join(DATA_DIR, "backups");
    if (!existsSync(backupsRoot)) return [];

    return readdirSync(backupsRoot)
      .filter((name) => {
        const p = join(backupsRoot, name);
        return statSync(p).isDirectory() && name.startsWith("marinara-backup-");
      })
      .map((name) => {
        const p = join(backupsRoot, name);
        const st = statSync(p);
        return { name, createdAt: st.birthtime.toISOString() };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  });

  // Delete a backup
  app.delete<{ Params: { name: string } }>("/:name", async (req, reply) => {
    const { name } = req.params;
    // Sanitize: only allow backup folder names
    if (!/^marinara-backup-[\w-]+$/.test(name)) {
      return reply.status(400).send({ error: "Invalid backup name" });
    }
    const backupsRoot = join(DATA_DIR, "backups");
    const backupDir = join(backupsRoot, name);

    if (!existsSync(backupDir)) {
      return reply.status(404).send({ error: "Backup not found" });
    }

    // Remove recursively
    const { rm } = await import("fs/promises");
    await rm(backupDir, { recursive: true, force: true });

    return { success: true };
  });

  // ── Profile Export ──
  // Returns a portable JSON envelope with characters, personas, lorebooks,
  // presets (+ groups/sections/choices), agent configs, and connections
  // (API keys are redacted).
  app.get("/export-profile", async (_req, reply) => {
    const chars = createCharactersStorage(app.db);
    const lbs = createLorebooksStorage(app.db);
    const presets = createPromptsStorage(app.db);
    const agents = createAgentsStorage(app.db);

    // Characters — include avatar as base64 if available
    const allChars = await chars.list();
    const characterExports = await Promise.all(
      allChars.map(async (c: any) => {
        let avatarBase64: string | null = null;
        if (c.avatarPath && existsSync(join(DATA_DIR, c.avatarPath))) {
          const buf = await readFile(join(DATA_DIR, c.avatarPath));
          avatarBase64 = buf.toString("base64");
        }
        return { ...c, avatarBase64 };
      }),
    );

    // Personas — include avatar as base64 if available
    const allPersonaRows = await chars.listPersonas();
    const allPersonas = await Promise.all(
      (allPersonaRows as any[]).map(async (p: any) => {
        let avatarBase64: string | null = null;
        if (p.avatarPath && existsSync(join(DATA_DIR, p.avatarPath))) {
          const buf = await readFile(join(DATA_DIR, p.avatarPath));
          avatarBase64 = buf.toString("base64");
        }
        return { ...p, avatarBase64 };
      }),
    );

    // Lorebooks + entries
    const allLorebooks = await lbs.list();
    const lorebookExports = await Promise.all(
      (allLorebooks as any[]).map(async (lb: any) => {
        const entries = await lbs.listEntries(lb.id);
        return { ...lb, entries };
      }),
    );

    // Presets + groups + sections + choices
    const allPresets = await presets.list();
    const presetExports = await Promise.all(
      (allPresets as any[]).map(async (p: any) => {
        const groups = await presets.listGroups(p.id);
        const sections = await presets.listSections(p.id);
        const choices = await presets.listChoiceBlocksForPreset(p.id);
        return { ...p, groups, sections, choices };
      }),
    );

    // Agent configs
    const allAgents = await agents.list();

    const envelope: ExportEnvelope = {
      type: "marinara_profile",
      version: 1,
      exportedAt: new Date().toISOString(),
      data: {
        characters: characterExports,
        personas: allPersonas,
        lorebooks: lorebookExports,
        presets: presetExports,
        agents: allAgents,
      },
    };

    return reply
      .header("Content-Disposition", `attachment; filename="marinara-profile.json"`)
      .header("Content-Type", "application/json")
      .send(envelope);
  });

  // ── Profile Import ──
  // Accepts a profile JSON envelope and creates all entities.
  app.post("/import-profile", async (req, reply) => {
    const envelope = req.body as ExportEnvelope;
    if (!envelope || envelope.type !== "marinara_profile" || envelope.version !== 1) {
      return reply.status(400).send({ error: "Invalid profile export" });
    }

    const data = envelope.data as Record<string, any>;
    const chars = createCharactersStorage(app.db);
    const lbs = createLorebooksStorage(app.db);
    const presets = createPromptsStorage(app.db);
    const agents = createAgentsStorage(app.db);

    const stats = { characters: 0, personas: 0, lorebooks: 0, presets: 0, agents: 0 };

    // Import characters
    if (Array.isArray(data.characters)) {
      for (const c of data.characters) {
        try {
          const charData = typeof c.data === "string" ? JSON.parse(c.data) : c.data;
          const result = await chars.create(charData, c.avatarPath ?? undefined);
          // Restore avatar from base64 if provided
          if (c.avatarBase64 && result?.avatarPath) {
            const avatarDir = join(DATA_DIR, "avatars");
            await mkdir(avatarDir, { recursive: true });
            const { writeFile } = await import("fs/promises");
            await writeFile(join(DATA_DIR, result.avatarPath), Buffer.from(c.avatarBase64, "base64"));
          }
          stats.characters++;
        } catch {
          /* skip failed entries */
        }
      }
    }

    // Import personas
    if (Array.isArray(data.personas)) {
      for (const p of data.personas) {
        try {
          // Restore persona avatar from base64 if provided
          let personaAvatarPath: string | undefined;
          if (p.avatarBase64) {
            const avatarDir = join(DATA_DIR, "avatars");
            await mkdir(avatarDir, { recursive: true });
            const ext = ".png";
            const avatarName = `persona-${Date.now()}-${Math.random().toString(36).slice(2, 8)}${ext}`;
            personaAvatarPath = `avatars/${avatarName}`;
            const { writeFile } = await import("fs/promises");
            await writeFile(join(DATA_DIR, personaAvatarPath), Buffer.from(p.avatarBase64, "base64"));
          }
          await chars.createPersona(
            p.name,
            p.description ?? "",
            personaAvatarPath,
            {
              comment: p.comment,
              personality: p.personality,
              backstory: p.backstory,
              appearance: p.appearance,
              scenario: p.scenario,
              nameColor: p.nameColor,
              dialogueColor: p.dialogueColor,
              boxColor: p.boxColor,
              personaStats: p.personaStats,
              altDescriptions: typeof p.altDescriptions === "string" ? p.altDescriptions : JSON.stringify(p.altDescriptions ?? []),
            },
          );
          stats.personas++;
        } catch {
          /* skip */
        }
      }
    }

    // Import lorebooks + entries
    if (Array.isArray(data.lorebooks)) {
      for (const lb of data.lorebooks) {
        try {
          const created = await lbs.create({
            name: lb.name,
            description: lb.description ?? "",
            category: lb.category ?? "uncategorized",
            scanDepth: lb.scanDepth,
            tokenBudget: lb.tokenBudget,
            recursiveScanning: lb.recursiveScanning,
            maxRecursionDepth: lb.maxRecursionDepth,
            enabled: lb.enabled ?? true,
          });
          if (created && Array.isArray(lb.entries)) {
            for (const entry of lb.entries) {
              await lbs.createEntry({ ...entry, lorebookId: (created as any).id });
            }
          }
          stats.lorebooks++;
        } catch {
          /* skip */
        }
      }
    }

    // Import presets with full hierarchy (groups, sections, choice blocks)
    if (Array.isArray(data.presets)) {
      for (const p of data.presets) {
        try {
          const existing = await presets.getById(p.id);
          if (!existing) {
            const created = await presets.create({
              name: `${p.name} (imported)`,
              description: p.description ?? "",
              parameters: typeof p.parameters === "string" ? JSON.parse(p.parameters) : (p.parameters ?? p.generationParams),
              variableGroups: typeof p.variableGroups === "string" ? JSON.parse(p.variableGroups) : (p.variableGroups ?? []),
              variableValues: typeof p.variableValues === "string" ? JSON.parse(p.variableValues) : (p.variableValues ?? {}),
            });
            if (created) {
              const newPresetId = (created as any).id;
              // Map old group IDs → new group IDs for section groupId references
              const groupIdMap = new Map<string, string>();

              // Import groups — two passes to handle parent→child ordering
              if (Array.isArray(p.groups)) {
                // Pass 1: create all groups without parent references
                for (const g of p.groups) {
                  try {
                    const newGroup = await presets.createGroup({
                      presetId: newPresetId,
                      name: g.name,
                      parentGroupId: null,
                      order: g.order ?? 100,
                      enabled: g.enabled === "true" || g.enabled === true,
                    });
                    if (newGroup) groupIdMap.set(g.id, (newGroup as any).id);
                  } catch { /* skip individual group */ }
                }
                // Pass 2: fix parent references using the fully-populated map
                for (const g of p.groups) {
                  if (g.parentGroupId && groupIdMap.has(g.id) && groupIdMap.has(g.parentGroupId)) {
                    try {
                      await presets.updateGroup(groupIdMap.get(g.id)!, {
                        parentGroupId: groupIdMap.get(g.parentGroupId)!,
                      });
                    } catch { /* skip */ }
                  }
                }
              }

              // Import sections
              if (Array.isArray(p.sections)) {
                for (const s of p.sections) {
                  try {
                    await presets.createSection({
                      presetId: newPresetId,
                      identifier: s.identifier,
                      name: s.name,
                      content: s.content ?? "",
                      role: s.role ?? "system",
                      enabled: s.enabled === "true" || s.enabled === true,
                      isMarker: s.isMarker === "true" || s.isMarker === true,
                      groupId: s.groupId ? (groupIdMap.get(s.groupId) ?? null) : null,
                      markerConfig: typeof s.markerConfig === "string" ? JSON.parse(s.markerConfig) : (s.markerConfig ?? null),
                      injectionPosition: s.injectionPosition ?? "ordered",
                      injectionDepth: s.injectionDepth ?? 0,
                      injectionOrder: s.injectionOrder ?? 100,
                      forbidOverrides: s.forbidOverrides === "true" || s.forbidOverrides === true,
                    });
                  } catch { /* skip individual section */ }
                }
              }

              // Import choice blocks
              if (Array.isArray(p.choices)) {
                for (const cb of p.choices) {
                  try {
                    await presets.createChoiceBlock({
                      presetId: newPresetId,
                      variableName: cb.variableName,
                      question: cb.question,
                      options: typeof cb.options === "string" ? JSON.parse(cb.options) : (cb.options ?? []),
                      multiSelect: cb.multiSelect === "true" || cb.multiSelect === true,
                      separator: cb.separator ?? ", ",
                      randomPick: cb.randomPick === "true" || cb.randomPick === true,
                    });
                  } catch { /* skip individual choice block */ }
                }
              }

              stats.presets++;
            }
          }
        } catch {
          /* skip */
        }
      }
    }

    // Import agent configs
    if (Array.isArray(data.agents)) {
      for (const a of data.agents) {
        try {
          // Only import if this agent type doesn't already exist
          const existing = await agents.getByType(a.type);
          if (!existing) {
            await agents.create({
              type: a.type,
              name: a.name,
              description: a.description ?? "",
              phase: a.phase,
              enabled: a.enabled === "true" || a.enabled === true,
              connectionId: a.connectionId ?? null,
              promptTemplate: a.promptTemplate ?? "",
              settings: typeof a.settings === "string" ? JSON.parse(a.settings) : (a.settings ?? {}),
            });
            stats.agents++;
          }
        } catch {
          /* skip */
        }
      }
    }

    return { success: true, imported: stats };
  });
}
