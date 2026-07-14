import fs from "fs";
import path from "path";
import type { IConfigPresenter, ISkillPresenter } from "@shared/presenter";
import type { MCPToolDefinition } from "@shared/types/core/mcp";
import type { IToolPresenter } from "@shared/types/presenters/tool.presenter";
import type { DeepChatAgentInstance } from "@/agent/deepchat/instance/deepChatAgentInstance";
import type { ProviderCatalogPort } from "@/presenter/runtimePorts";
import { buildRuntimeCapabilitiesPrompt, buildSystemEnvPrompt } from "./systemEnvPromptBuilder";

export type AgentExtensionPolicy = {
  enabledSkillNames?: string[] | null;
  enabledMcpServerIds?: string[] | null;
};

type SkillPresenterPort = Pick<
  ISkillPresenter,
  "getMetadataList" | "getActiveSkills" | "loadSkillContent"
>;

export interface SystemPromptBuilderDependencies {
  configPresenter: IConfigPresenter;
  skillPresenter?: SkillPresenterPort;
  providerCatalogPort: Pick<ProviderCatalogPort, "getProviderModels" | "getCustomModels">;
  toolPresenter: IToolPresenter | null;
  assertCurrent(sessionId: string, instance: DeepChatAgentInstance): void;
  isAcpBackedSubagentSession(sessionId: string, providerId?: string): boolean;
  resolveProjectDir(
    sessionId: string,
    projectDir: string | null | undefined,
    instance: DeepChatAgentInstance,
  ): string | null;
  resolveAgentExtensionPolicy(
    sessionId: string,
    instance: DeepChatAgentInstance,
  ): Promise<AgentExtensionPolicy>;
  logSlowStep(sessionId: string, step: string, startedAt: number): void;
}

export interface SystemPromptBuildInput {
  sessionId: string;
  basePrompt: string;
  toolDefinitions: MCPToolDefinition[];
  activeSkillNamesOverride?: string[];
  resourceInstance: DeepChatAgentInstance;
}

type PackageJsonManifest = {
  name?: unknown;
  scripts?: Record<string, unknown>;
};

function readPackageJsonManifest(workdir: string): PackageJsonManifest | null {
  try {
    const packageJsonPath = path.join(workdir, "package.json");
    if (!fs.existsSync(packageJsonPath)) {
      return null;
    }

    const parsed = JSON.parse(fs.readFileSync(packageJsonPath, "utf-8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    return parsed as PackageJsonManifest;
  } catch {
    return null;
  }
}

function getVerificationScriptNames(workdir: string): string[] {
  const manifest = readPackageJsonManifest(workdir);
  const scripts = manifest?.scripts;
  if (!scripts || typeof scripts !== "object") {
    return [];
  }

  return Object.entries(scripts)
    .filter(
      ([name, value]) => typeof name === "string" && typeof value === "string" && value.trim(),
    )
    .map(([name]) => name);
}

export async function buildSystemPromptWithSkills(
  dependencies: SystemPromptBuilderDependencies,
  input: SystemPromptBuildInput,
): Promise<string> {
  const { sessionId, basePrompt, toolDefinitions, activeSkillNamesOverride, resourceInstance } =
    input;
  dependencies.assertCurrent(sessionId, resourceInstance);
  const normalizedBase = basePrompt?.trim() ?? "";
  const state = resourceInstance.getRuntimeState();
  const providerId = state?.providerId?.trim() || "unknown-provider";
  const modelId = state?.modelId?.trim() || "unknown-model";
  if (dependencies.isAcpBackedSubagentSession(sessionId, providerId)) {
    return normalizedBase;
  }

  const workdir = resourceInstance.hasProjectDir()
    ? resourceInstance.getProjectDir()
    : dependencies.resolveProjectDir(sessionId, undefined, resourceInstance);
  const now = new Date();
  const dayKey = buildLocalDayKey(now);

  const skillsEnabled = dependencies.configPresenter.getSkillsEnabled();
  const skillPresenter = dependencies.skillPresenter;
  const availableSkills: Array<{
    name: string;
    description: string;
    category?: string | null;
    platforms?: string[];
  }> = [];
  const activeSkillNames: string[] = activeSkillNamesOverride ? [...activeSkillNamesOverride] : [];
  const skillDraftSuggestionsEnabled =
    dependencies.configPresenter.getSkillDraftSuggestionsEnabled?.() ?? false;

  const extensionPolicy = await dependencies.resolveAgentExtensionPolicy(
    sessionId,
    resourceInstance,
  );
  const allowedSkillNameSet =
    extensionPolicy.enabledSkillNames === null || extensionPolicy.enabledSkillNames === undefined
      ? null
      : new Set(normalizeStringList(extensionPolicy.enabledSkillNames));

  if (skillsEnabled && skillPresenter) {
    if (skillPresenter.getMetadataList) {
      const stepStartedAt = Date.now();
      try {
        const metadataList = await skillPresenter.getMetadataList();
        for (const metadata of metadataList) {
          const skillName = metadata?.name?.trim();
          if (skillName && (!allowedSkillNameSet || allowedSkillNameSet.has(skillName))) {
            availableSkills.push({
              name: skillName,
              description: metadata.description?.trim() || "",
              category: metadata.category ?? null,
              platforms: metadata.platforms,
            });
          }
        }
      } catch (error) {
        console.warn(
          `[DeepChatAgent] Failed to load skills metadata for session ${sessionId}:`,
          error,
        );
      }
      dependencies.logSlowStep(sessionId, "system-prompt.skills-metadata-load", stepStartedAt);
    }

    if (!activeSkillNamesOverride && skillPresenter.getActiveSkills) {
      const stepStartedAt = Date.now();
      try {
        const activeSkills = await skillPresenter.getActiveSkills(sessionId);
        for (const skillName of activeSkills) {
          const normalizedName = skillName?.trim();
          if (normalizedName) {
            activeSkillNames.push(normalizedName);
          }
        }
      } catch (error) {
        console.warn(
          `[DeepChatAgent] Failed to load active skills for session ${sessionId}:`,
          error,
        );
      }
      dependencies.logSlowStep(sessionId, "system-prompt.active-skills-load", stepStartedAt);
    }
  }

  let stepStartedAt = Date.now();
  const normalizedAvailableSkills = normalizeSkillMetadata(availableSkills);
  const availableSkillNames = new Set(normalizedAvailableSkills.map((skill) => skill.name));
  const normalizedActiveSkills = filterSkillNamesByPolicy(
    activeSkillNames.filter((skillName) => availableSkillNames.has(skillName)),
    extensionPolicy,
  );
  const agentToolNames = getAgentToolNames(toolDefinitions);
  const fingerprint = buildSystemPromptFingerprint({
    providerId,
    modelId,
    workdir,
    basePrompt: normalizedBase,
    skillsEnabled,
    availableSkillNames: normalizedAvailableSkills.map((skill) => skill.name),
    activeSkillNames: normalizedActiveSkills,
    toolSignature: buildToolSignature(toolDefinitions),
    skillDraftSuggestionsEnabled,
  });
  dependencies.logSlowStep(sessionId, "system-prompt.fingerprint", stepStartedAt);

  dependencies.assertCurrent(sessionId, resourceInstance);
  const cachedPrompt = resourceInstance.getSystemPromptCache();
  if (cachedPrompt && cachedPrompt.dayKey === dayKey && cachedPrompt.fingerprint === fingerprint) {
    return cachedPrompt.prompt;
  }

  const runtimePrompt = buildRuntimeCapabilitiesPrompt({
    hasYoBrowser: toolDefinitions.some(
      (tool) => tool.source === "agent" && tool.server.name === "yobrowser",
    ),
    hasExec: agentToolNames.has("exec"),
    hasProcess: agentToolNames.has("process"),
  });
  const skillsMetadataPrompt = skillsEnabled
    ? buildSkillsMetadataPrompt(
        normalizedAvailableSkills,
        {
          canListSkills: agentToolNames.has("skill_list"),
          canViewSkills: agentToolNames.has("skill_view"),
          canManageDraftSkills: agentToolNames.has("skill_manage"),
          canRunSkillScripts: agentToolNames.has("skill_run"),
        },
        skillDraftSuggestionsEnabled,
      )
    : "";

  let skillsPrompt = "";
  if (skillsEnabled && skillPresenter?.loadSkillContent && normalizedActiveSkills.length > 0) {
    stepStartedAt = Date.now();
    const skillSections: string[] = [];
    for (const skillName of normalizedActiveSkills) {
      try {
        const skill = await skillPresenter.loadSkillContent(skillName);
        const content = skill?.content?.trim();
        if (content) {
          skillSections.push(`### ${skillName}\n${content}`);
        }
      } catch (error) {
        console.warn(
          `[DeepChatAgent] Failed to load skill content for "${skillName}" in session ${sessionId}:`,
          error,
        );
      }
    }
    skillsPrompt = buildPinnedSkillsPrompt(skillSections);
    dependencies.logSlowStep(sessionId, "system-prompt.pinned-skills-load", stepStartedAt);
  }

  let envPrompt = "";
  try {
    stepStartedAt = Date.now();
    envPrompt = await buildSystemEnvPrompt({
      providerId,
      modelId,
      workdir,
      now,
      modelLookup: dependencies.providerCatalogPort,
    });
    dependencies.logSlowStep(sessionId, "system-prompt.env-prompt", stepStartedAt);
  } catch (error) {
    console.warn(`[DeepChatAgent] Failed to build env prompt for session ${sessionId}:`, error);
  }

  let toolingPrompt = "";
  if (dependencies.toolPresenter) {
    try {
      stepStartedAt = Date.now();
      toolingPrompt = dependencies.toolPresenter.buildToolSystemPrompt({
        conversationId: sessionId,
        toolDefinitions,
      });
      dependencies.logSlowStep(sessionId, "system-prompt.tooling-prompt", stepStartedAt);
    } catch (error) {
      console.warn(
        `[DeepChatAgent] Failed to build tooling prompt for session ${sessionId}:`,
        error,
      );
    }
  }

  stepStartedAt = Date.now();
  const composedPrompt = composePromptSections([
    normalizedBase,
    runtimePrompt,
    envPrompt,
    skillsMetadataPrompt,
    skillsPrompt,
    toolingPrompt,
    buildPermissionRulesPrompt(agentToolNames),
    buildVerificationPolicyPrompt(workdir),
  ]);
  dependencies.logSlowStep(sessionId, "system-prompt.compose", stepStartedAt);

  dependencies.assertCurrent(sessionId, resourceInstance);
  resourceInstance.setSystemPromptCache({
    prompt: composedPrompt,
    dayKey,
    fingerprint,
  });

  return composedPrompt;
}

function composePromptSections(sections: string[]): string {
  return sections
    .map((section) => section.trim())
    .filter((section) => section.length > 0)
    .join("\n\n");
}

function buildPermissionRulesPrompt(agentToolNames: Set<string>): string {
  const readOnlyTools = ["read"].filter((toolName) => agentToolNames.has(toolName));
  const serializedTools = ["write", "edit", "exec", "process"].filter((toolName) =>
    agentToolNames.has(toolName),
  );

  if (readOnlyTools.length === 0 && serializedTools.length === 0) {
    return "";
  }

  const lines = ["## Permission Rules"];
  if (readOnlyTools.length > 0) {
    lines.push(
      `Read-only Agent tools may be batched in parallel when useful: ${readOnlyTools
        .map((toolName) => `\`${toolName}\``)
        .join(", ")}.`,
    );
  }
  if (serializedTools.length > 0) {
    lines.push(
      `Mutating and runtime tools stay serialized or permission-gated: ${serializedTools
        .map((toolName) => `\`${toolName}\``)
        .join(", ")}.`,
    );
  }
  lines.push("Do not assume approval for file writes or commands when the session asks for it.");

  return lines.join("\n");
}

function buildVerificationPolicyPrompt(workdir: string | null): string {
  const lines = [
    "## Verification Policy",
    "After changing code, configuration, tests, docs that affect behavior, or generated assets, check verification status before the final response.",
    "If verification was not run, state the reason explicitly in the final response.",
  ];

  const normalizedWorkdir = workdir?.trim();
  if (!normalizedWorkdir) {
    return lines.join("\n");
  }

  const verificationScripts = getVerificationScriptNames(normalizedWorkdir);
  const manifest = readPackageJsonManifest(normalizedWorkdir);
  const isDeepChatWorkspace =
    String(manifest?.name ?? "").toLowerCase() === "deepchat" ||
    ["format", "i18n", "lint"].every((scriptName) => verificationScripts.includes(scriptName));

  if (isDeepChatWorkspace) {
    lines.push(
      "In the DeepChat repository, prioritize `pnpm run format`, `pnpm run i18n`, and `pnpm run lint` after feature work.",
    );
  } else if (verificationScripts.length > 0) {
    const suggestedScripts = verificationScripts
      .slice(0, 4)
      .map((scriptName) => `\`${scriptName}\``);
    lines.push(
      `When relevant, prefer project-local verification scripts such as ${suggestedScripts.join(", ")}.`,
    );
  }

  return lines.join("\n");
}

function buildSkillsMetadataPrompt(
  availableSkills: Array<{
    name: string;
    description: string;
    category?: string | null;
    platforms?: string[];
  }>,
  capabilities: {
    canListSkills: boolean;
    canViewSkills: boolean;
    canManageDraftSkills: boolean;
    canRunSkillScripts: boolean;
  },
  skillDraftSuggestionsEnabled: boolean,
): string {
  if (
    !capabilities.canListSkills &&
    !capabilities.canViewSkills &&
    !capabilities.canManageDraftSkills &&
    !capabilities.canRunSkillScripts
  ) {
    return "";
  }

  const lines = ["## Skills"];
  let hasContent = false;

  if (capabilities.canListSkills || capabilities.canViewSkills) {
    lines.push(
      "Before replying, always scan available skills. If any skill plausibly matches the task, call `skill_view` first.",
    );
    lines.push(
      "Viewing a skill root `SKILL.md` activates that skill for the current message/tool loop; it does not pin the skill to the conversation. Viewing linked skill files is read-only and does not activate the skill.",
    );
    hasContent = true;
  }
  if (capabilities.canRunSkillScripts) {
    lines.push(
      "Use `skill_run` only for skills that are active in the current message/tool loop, including manually pinned skills and skills activated by `skill_view`.",
    );
    hasContent = true;
  }
  if (capabilities.canManageDraftSkills && skillDraftSuggestionsEnabled) {
    lines.push(
      "After completing a complex task, solving a tricky bug, or discovering a non-trivial workflow, you may draft a reusable skill with `skill_manage`.",
    );
    lines.push(
      "Only propose one draft per task, do it after the main answer is complete, and use `deepchat_question` to ask whether the user wants to keep the draft.",
    );
    lines.push(
      "Do not modify installed skills with `skill_manage`; it is draft-only in this version.",
    );
    hasContent = true;
  }

  if (availableSkills.length > 0) {
    lines.push("<available_skills>");
    lines.push(
      ...availableSkills.map((skill) => {
        const details: string[] = [];
        if (skill.category) {
          details.push(`category=${skill.category}`);
        }
        if (skill.platforms?.length) {
          details.push(`platforms=${skill.platforms.join(",")}`);
        }
        const suffix = details.length > 0 ? ` [${details.join("; ")}]` : "";
        return `- ${skill.name}: ${skill.description}${suffix}`;
      }),
    );
    lines.push("</available_skills>");
    hasContent = true;
  } else if (hasContent) {
    lines.push("<available_skills>");
    lines.push("(none)");
    lines.push("</available_skills>");
  }

  return hasContent ? lines.join("\n") : "";
}

function buildPinnedSkillsPrompt(skillSections: string[]): string {
  if (skillSections.length === 0) {
    return "";
  }
  return [
    "## Active Skills",
    "These skills are active for the current message context. Some may be manually pinned for the conversation; others may have been activated by `skill_view` for this message/tool loop only. Follow them when relevant.",
    "",
    skillSections.join("\n\n"),
  ].join("\n");
}

export function resolveEffectiveActiveSkillNames(
  sessionActiveSkillNames: string[],
  instance: DeepChatAgentInstance,
): string[] {
  return normalizeStringList([...sessionActiveSkillNames, ...instance.getRuntimeActivatedSkills()]);
}

export function normalizeStringList(values: string[]): string[] {
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value) => value.length > 0)),
  ).sort((a, b) => a.localeCompare(b));
}

function normalizeSkillMetadata(
  skills: Array<{
    name: string;
    description: string;
    category?: string | null;
    platforms?: string[];
  }>,
): Array<{
  name: string;
  description: string;
  category?: string | null;
  platforms?: string[];
}> {
  const deduped = new Map<string, (typeof skills)[number]>();
  for (const skill of skills) {
    const name = skill.name.trim();
    if (!name || deduped.has(name)) {
      continue;
    }
    deduped.set(name, {
      ...skill,
      name,
      description: skill.description.trim(),
      category: skill.category?.trim() || null,
      platforms: skill.platforms?.map((platform) => platform.trim()).filter(Boolean),
    });
  }
  return Array.from(deduped.values()).sort((left, right) => {
    return (
      (left.category ?? "").localeCompare(right.category ?? "") ||
      left.name.localeCompare(right.name)
    );
  });
}

function buildSystemPromptFingerprint(params: {
  providerId: string;
  modelId: string;
  workdir: string | null;
  basePrompt: string;
  skillsEnabled: boolean;
  availableSkillNames: string[];
  activeSkillNames: string[];
  toolSignature: string[];
  skillDraftSuggestionsEnabled: boolean;
}): string {
  return JSON.stringify({
    providerId: params.providerId,
    modelId: params.modelId,
    workdir: params.workdir ?? "",
    basePrompt: params.basePrompt,
    skillsEnabled: params.skillsEnabled,
    availableSkillNames: params.availableSkillNames,
    activeSkillNames: params.activeSkillNames,
    toolSignature: params.toolSignature,
    skillDraftSuggestionsEnabled: params.skillDraftSuggestionsEnabled,
  });
}

function getAgentToolNames(toolDefinitions: MCPToolDefinition[]): Set<string> {
  return new Set(
    toolDefinitions.filter((tool) => tool.source === "agent").map((tool) => tool.function.name),
  );
}

function buildToolSignature(toolDefinitions: MCPToolDefinition[]): string[] {
  return toolDefinitions
    .filter((tool) => tool.source === "agent")
    .map((tool) => `${tool.server.name}:${tool.function.name}`)
    .sort((left, right) => left.localeCompare(right));
}

function buildLocalDayKey(now: Date): string {
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function filterSkillNamesByPolicy(
  skillNames: string[] | undefined,
  policy: AgentExtensionPolicy,
): string[] {
  const normalizedSkillNames = normalizeStringList(skillNames ?? []);
  if (policy.enabledSkillNames === null || policy.enabledSkillNames === undefined) {
    return normalizedSkillNames;
  }

  const allowed = new Set(normalizeStringList(policy.enabledSkillNames));
  return normalizedSkillNames.filter((skillName) => allowed.has(skillName));
}
