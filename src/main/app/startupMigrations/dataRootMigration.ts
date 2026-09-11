/**
 * 数据根迁移：把旧 OEM 数据根 ~/.deepchat 的 skills 子树迁到 ~/.miowork。
 *
 * 为什么存在：OEM 把用户可见数据根从 ~/.deepchat 改为 ~/.miowork（此前 ~/.deepchat
 * 会让官方 MioWork 与 MioWork 同机时互踩 skills/sessions）。本模块在应用启动最早期、
 * 任何 skill/session 服务构建之前执行一次幂等迁移。
 *
 * 迁移策略（评审定稿）：
 *  - 只拷贝 skills 子树（KB-MB 级）；sessions/remote-assets/backups/tmp 只切根不拷贝，
 *    旧目录原样保留，数据库里引用旧绝对路径的 offload/远程资产继续可解析
 *  - 幂等合并：目标已存在的文件跳过（保留目标态）、缺失的补拷；.deepchat-meta sidecar
 *    目录改名为 .miowork-meta；失败不写 marker，下次启动重试直到干净
 *  - 判据只认 marker 文件 .migrated-from-deepchat：中途失败（磁盘满/权限）时新目录
 *    可能已部分存在但没有 marker → 下次启动继续补齐，不会误跳过
 *  - stored skillsPath 一次性改写：仅当其解析后等于旧默认（~/.deepchat/skills）时
 *    改为 ~/.miowork/skills；用户自定义过的外部路径一律不动
 *  - 不建 symlink：用户「清理旧目录」会穿过符号链接删掉真实数据（数据丢失隐患）
 *
 * 上游合并面：本文件为 OEM 新增文件，上游不触碰；appMain.ts 仅一行挂钩。
 */
import fs from 'fs'
import os from 'os'
import path from 'path'

/** 新数据根（与 skill/index.ts、sessionPaths.ts 等处的字面量保持一致） */
export const MIOWORK_DATA_ROOT = '.miowork'
/** 旧数据根（官方 MioWork 原生目录，迁移源；只读，永不写入/删除） */
export const LEGACY_DATA_ROOT = '.deepchat'
/** 迁移完成标记：只在新数据根写。存在即视为已迁移，启动时直接跳过 */
export const MIGRATION_MARKER = '.migrated-from-deepchat'
/** skills 树内随包分发的 sidecar 配置目录（新名，与 SKILL_CONFIG.SIDECAR_DIR 一致） */
const SIDECAR_DIR_NEW = '.miowork-meta'
const SIDECAR_DIR_LEGACY = '.deepchat-meta'

export interface DataRootMigrationDeps {
  /** 家目录（默认 os.homedir()；测试注入临时目录） */
  homeDir?: string
  /** skills 路径存取（连接 SettingsStore；测试用内存 map 代替） */
  skillsPathStore?: { get(): string | undefined; set(value: string): void }
  /** 结构化日志口（默认静默；主进程传入 logger） */
  log?: (message: string) => void
}

/**
 * 判断给定 skills 路径是否就是旧默认值 ~/.deepchat/skills。
 *
 * 先做 path.resolve 归一再比较：存量库里可能存着坏形态（Windows 丢分隔符的
 * `C:\Users\name.deepchat\skills` 或尾部冗余分隔符），精确字符串匹配会漏掉它们，
 * 导致 repair 函数后来又把路径修回旧根（评审缺陷 3）。
 */
export function isLegacyDefaultSkillsPath(configuredPath: string, homeDir: string): boolean {
  const legacyDefault = path.resolve(homeDir, LEGACY_DATA_ROOT, 'skills')
  return path.resolve(configuredPath) === legacyDefault
}

/**
 * 执行迁移总入口：拷贝 skills 子树 + 改写等于旧默认的 stored skillsPath。
 * 幂等：已有 marker 直接返回；skills 子树为空的旧目录同样写 marker（nothing to copy）。
 * 抛错时保持「无 marker」状态，下次启动自动重试。
 */
export function runDataRootMigration(deps: DataRootMigrationDeps = {}): void {
  const log = deps.log ?? (() => undefined)
  const homeDir = path.resolve(deps.homeDir ?? os.homedir())
  const legacyRoot = path.join(homeDir, LEGACY_DATA_ROOT)
  const newRoot = path.join(homeDir, MIOWORK_DATA_ROOT)
  const markerPath = path.join(newRoot, MIGRATION_MARKER)

  // 已迁移过（或本就是全新安装且跑完过本流程）：唯一跳过判据
  if (fs.existsSync(markerPath)) {
    return
  }

  // 旧目录不存在 = 全新用户或从未用过旧版：写 marker 让流程一次收口，此后零开销
  if (!fs.existsSync(legacyRoot)) {
    ensureNewRoot(newRoot)
    writeMarker(markerPath, log)
    return
  }

  ensureNewRoot(newRoot)

  const legacySkillsDir = path.join(legacyRoot, 'skills')
  if (fs.existsSync(legacySkillsDir)) {
    const newSkillsDir = path.join(newRoot, 'skills')
    ensureNewRoot(newSkillsDir)
    mergeSkillsTree(legacySkillsDir, newSkillsDir, log)
  }

  migrateStoredSkillsPath(homeDir, deps, log)

  writeMarker(markerPath, log)
  log(`data root migrated: ${legacyRoot} -> ${newRoot}`)
}

/** 确保新数据根存在（skills 子树拷贝前也会走到这里） */
function ensureNewRoot(dir: string): void {
  fs.mkdirSync(dir, { recursive: true })
}

/**
 * skills 子树幂等合并：目标已存在的文件/目录跳过（保留目标态），缺失的补拷；
 * 旧 sidecar .deepchat-meta 目录改名为 .miowork-meta（仅在目标没有 sidecar 时）。
 * 任一文件拷贝失败即抛出 → 外层保持无 marker → 下次启动重试。
 */
function mergeSkillsTree(sourceRoot: string, targetRoot: string, log: (m: string) => void): void {
  const entries = fs.readdirSync(sourceRoot, { withFileTypes: true })
  for (const entry of entries) {
    const sourcePath = path.join(sourceRoot, entry.name)
    // 跨改名的目录：旧 sidecar 名映射到新 sidecar 名
    const targetName = entry.name === SIDECAR_DIR_LEGACY ? SIDECAR_DIR_NEW : entry.name
    const targetPath = path.join(targetRoot, targetName)

    if (entry.isSymbolicLink()) {
      // 与 agentSkillImportService 的哈希遍历一致：不跟随符号链接，跳过（避免链外写入）
      log(`skip symlink during migration: ${sourcePath}`)
      continue
    }

    if (fs.existsSync(targetPath)) {
      // 幂等合并的核心：目标已有（无论来源）一律保留目标态，不覆盖
      if (entry.isDirectory() && targetName !== SIDECAR_DIR_NEW) {
        mergeSkillsTree(sourcePath, targetPath, log)
      }
      continue
    }

    if (entry.isDirectory()) {
      fs.cpSync(sourcePath, targetPath, { recursive: true, verbatimSymlinks: false })
    } else if (entry.isFile()) {
      fs.copyFileSync(sourcePath, targetPath)
    }
  }
}

/**
 * stored skillsPath 一次性改写：仅当值解析后等于旧默认 ~/.deepchat/skills 时改为
 * ~/.miowork/skills。用户自定义过的外部路径（含指向 ~/.deepchat/skills 子路径以外的
 * 任何自定义）一律不动。store 缺 skillsPath 键时不动（fallback 已指向新根）。
 */
function migrateStoredSkillsPath(
  homeDir: string,
  deps: DataRootMigrationDeps,
  log: (m: string) => void
): void {
  const store = deps.skillsPathStore
  if (!store) return
  const configured = store.get()
  if (!configured || typeof configured !== 'string') return
  if (!isLegacyDefaultSkillsPath(configured, homeDir)) return

  const newDefault = path.join(homeDir, MIOWORK_DATA_ROOT, 'skills')
  store.set(newDefault)
  log(`stored skillsPath rewritten to new default: ${newDefault}`)
}

function writeMarker(markerPath: string, log: (m: string) => void): void {
  fs.writeFileSync(markerPath, `${new Date().toISOString()}\n`, 'utf-8')
  log(`migration marker written: ${markerPath}`)
}
