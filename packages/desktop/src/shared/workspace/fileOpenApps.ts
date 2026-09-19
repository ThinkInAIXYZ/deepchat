/**
 * Registry of editors, IDEs and terminals offered in the workspace "open with" picker.
 *
 * Platform support is data, not control flow: an app is offered on a platform
 * only when it has both a `detect` and a `launch` entry for it. Enabling or
 * disabling a platform is a registry edit.
 */

export type WorkspaceFileOpenAppKind = 'editor' | 'terminal'

export type WorkspaceFileOpenAppPlatform = 'darwin' | 'win32' | 'linux'

/**
 * How to decide whether an app is installed.
 *
 * - `macBundleId` resolves through Launch Services, so `~/Applications` is found
 *   as well as `/Applications`.
 * - `winExecutable` reads App Paths (HKCU before HKLM, because per-user
 *   installers cannot write HKLM) and falls back to PATH.
 * - `linuxApp` prefers a `command -v` hit, because a binary can be exec'd with
 *   CLI flags. It falls back to a `.desktop` entry, which is the only trace left
 *   by JetBrains Toolbox IDEs without a CLI launcher, Flatpaks, and distro
 *   packages that keep their binary off PATH.
 */
export type WorkspaceFileOpenAppDetect =
  | { type: 'macBundleId'; bundleIds: string[] }
  | { type: 'winExecutable'; exeNames: string[] }
  | { type: 'linuxApp'; binary?: string; desktopIds?: string[] }

/**
 * How to hand the target path to the app.
 *
 * - `macOpenA` runs `open -a <resolved bundle> <path>`.
 * - `exec` runs the resolved binary. `args` defaults to `[<path>]`; when it
 *   contains `{path}` the placeholder is substituted instead of appending.
 * - `desktopEntry` runs `gio launch <entry> <path>`, used on Linux when only a
 *   `.desktop` file was found. Requires the entry to declare a file field code.
 */
export type WorkspaceFileOpenAppLaunch =
  | { type: 'macOpenA' }
  | { type: 'exec'; args?: string[] }
  | { type: 'desktopEntry' }

export type WorkspaceFileOpenAppDefinition = {
  /** Stable IPC identifier; never a filesystem path. */
  id: string
  name: string
  /** Editors receive the file; terminals receive its containing directory. */
  kind: WorkspaceFileOpenAppKind
  detect: Partial<Record<WorkspaceFileOpenAppPlatform, WorkspaceFileOpenAppDetect>>
  launch: Partial<Record<WorkspaceFileOpenAppPlatform, WorkspaceFileOpenAppLaunch>>
}

/**
 * Build the argument list for an `exec` launch.
 *
 * `{path}` substitution exists because not every app takes a trailing path:
 * Ghostty requires `--working-directory=<dir>`, and a bare positional argument
 * makes `wt.exe` try to run the directory as a command.
 */
export function buildLaunchArgs(args: readonly string[] | undefined, targetPath: string): string[] {
  if (!args?.length) {
    return [targetPath]
  }

  return args.some((arg) => arg.includes('{path}'))
    ? args.map((arg) => arg.replace('{path}', targetPath))
    : [...args, targetPath]
}

/**
 * Editors that take a file path positionally on every platform they support.
 *
 * Linux gets both a binary and desktop-entry ids where available, so a Toolbox or
 * Flatpak install without a CLI launcher is still detected.
 */
function editor(
  id: string,
  name: string,
  targets: { bundleIds?: string[]; exeNames?: string[]; binary?: string; desktopIds?: string[] }
): WorkspaceFileOpenAppDefinition {
  const detect: WorkspaceFileOpenAppDefinition['detect'] = {}
  const launch: WorkspaceFileOpenAppDefinition['launch'] = {}

  if (targets.bundleIds) {
    detect.darwin = { type: 'macBundleId', bundleIds: targets.bundleIds }
    launch.darwin = { type: 'macOpenA' }
  }
  if (targets.exeNames) {
    detect.win32 = { type: 'winExecutable', exeNames: targets.exeNames }
    launch.win32 = { type: 'exec' }
  }
  if (targets.binary || targets.desktopIds) {
    detect.linux = { type: 'linuxApp', binary: targets.binary, desktopIds: targets.desktopIds }
    // The detector narrows this to `desktopEntry` when only an entry was found.
    launch.linux = { type: 'exec' }
  }

  return { id, name, kind: 'editor', detect, launch }
}

/**
 * Only mainstream GUI editors, IDEs and terminals are listed. Browsers, note
 * apps and generic viewers are excluded on purpose; "open with system default"
 * still covers those.
 */
export const WORKSPACE_FILE_OPEN_APPS: readonly WorkspaceFileOpenAppDefinition[] = [
  editor('vscode', 'VS Code', {
    bundleIds: ['com.microsoft.VSCode'],
    exeNames: ['Code.exe'],
    binary: 'code',
    desktopIds: ['code.desktop', 'visual-studio-code.desktop', 'com.visualstudio.code.desktop']
  }),
  editor('vscode-insiders', 'VS Code Insiders', {
    bundleIds: ['com.microsoft.VSCodeInsiders'],
    exeNames: ['Code - Insiders.exe'],
    binary: 'code-insiders',
    desktopIds: ['code-insiders.desktop']
  }),
  editor('vscodium', 'VSCodium', {
    bundleIds: ['com.vscodium', 'com.visualstudio.code.oss'],
    exeNames: ['VSCodium.exe'],
    binary: 'codium',
    desktopIds: ['codium.desktop', 'vscodium.desktop', 'com.vscodium.codium.desktop']
  }),
  editor('cursor', 'Cursor', {
    bundleIds: ['com.todesktop.230313mzl4w4u92'],
    exeNames: ['Cursor.exe'],
    binary: 'cursor',
    desktopIds: ['cursor.desktop']
  }),
  editor('windsurf', 'Windsurf', {
    bundleIds: ['com.exafunction.windsurf'],
    exeNames: ['Windsurf.exe'],
    binary: 'windsurf',
    desktopIds: ['windsurf.desktop']
  }),
  editor('zed', 'Zed', {
    bundleIds: ['dev.zed.Zed'],
    binary: 'zed',
    desktopIds: ['dev.zed.Zed.desktop', 'zed.desktop']
  }),
  editor('sublime-text', 'Sublime Text', {
    bundleIds: ['com.sublimetext.4', 'com.sublimetext.3'],
    exeNames: ['sublime_text.exe'],
    binary: 'subl',
    desktopIds: ['sublime_text.desktop', 'com.sublimetext.three.desktop']
  }),
  editor('intellij', 'IntelliJ IDEA', {
    bundleIds: ['com.jetbrains.intellij', 'com.jetbrains.intellij.ce'],
    exeNames: ['idea64.exe'],
    binary: 'idea',
    desktopIds: [
      'intellij-idea-ultimate.desktop',
      'intellij-idea-community.desktop',
      'jetbrains-idea.desktop',
      'jetbrains-idea-ce.desktop',
      'com.jetbrains.IntelliJ-IDEA-Ultimate.desktop',
      'com.jetbrains.IntelliJ-IDEA-Community.desktop'
    ]
  }),
  editor('goland', 'GoLand', {
    bundleIds: ['com.jetbrains.goland'],
    exeNames: ['goland64.exe'],
    binary: 'goland',
    desktopIds: ['goland.desktop', 'jetbrains-goland.desktop', 'com.jetbrains.GoLand.desktop']
  }),
  editor('webstorm', 'WebStorm', {
    bundleIds: ['com.jetbrains.WebStorm'],
    exeNames: ['webstorm64.exe'],
    binary: 'webstorm',
    desktopIds: ['webstorm.desktop', 'jetbrains-webstorm.desktop', 'com.jetbrains.WebStorm.desktop']
  }),
  editor('pycharm', 'PyCharm', {
    bundleIds: ['com.jetbrains.pycharm', 'com.jetbrains.pycharm.ce'],
    exeNames: ['pycharm64.exe'],
    binary: 'pycharm',
    desktopIds: [
      'pycharm-professional.desktop',
      'pycharm-community.desktop',
      'jetbrains-pycharm.desktop',
      'jetbrains-pycharm-ce.desktop',
      'com.jetbrains.PyCharm-Professional.desktop',
      'com.jetbrains.PyCharm-Community.desktop'
    ]
  }),
  editor('rustrover', 'RustRover', {
    bundleIds: ['com.jetbrains.rustrover'],
    exeNames: ['rustrover64.exe'],
    binary: 'rustrover',
    desktopIds: [
      'rustrover.desktop',
      'jetbrains-rustrover.desktop',
      'com.jetbrains.RustRover.desktop'
    ]
  }),
  editor('clion', 'CLion', {
    bundleIds: ['com.jetbrains.CLion'],
    exeNames: ['clion64.exe'],
    binary: 'clion',
    desktopIds: ['clion.desktop', 'jetbrains-clion.desktop', 'com.jetbrains.CLion.desktop']
  }),
  editor('rider', 'Rider', {
    bundleIds: ['com.jetbrains.rider'],
    exeNames: ['rider64.exe'],
    binary: 'rider',
    desktopIds: ['rider.desktop', 'jetbrains-rider.desktop', 'com.jetbrains.Rider.desktop']
  }),
  editor('phpstorm', 'PhpStorm', {
    bundleIds: ['com.jetbrains.PhpStorm'],
    exeNames: ['phpstorm64.exe'],
    binary: 'phpstorm',
    desktopIds: ['phpstorm.desktop', 'jetbrains-phpstorm.desktop', 'com.jetbrains.PhpStorm.desktop']
  }),
  editor('rubymine', 'RubyMine', {
    bundleIds: ['com.jetbrains.rubymine'],
    exeNames: ['rubymine64.exe'],
    binary: 'rubymine',
    desktopIds: ['rubymine.desktop', 'jetbrains-rubymine.desktop', 'com.jetbrains.RubyMine.desktop']
  }),
  editor('fleet', 'Fleet', {
    bundleIds: ['com.jetbrains.fleet'],
    exeNames: ['Fleet.exe'],
    desktopIds: ['fleet.desktop', 'jetbrains-fleet.desktop']
  }),
  editor('android-studio', 'Android Studio', {
    bundleIds: ['com.google.android.studio'],
    exeNames: ['studio64.exe'],
    binary: 'studio',
    desktopIds: ['android-studio.desktop', 'com.google.AndroidStudio.desktop']
  }),
  // Neovide is the GUI front end; bare nvim would open detached with no terminal.
  editor('neovim', 'Neovim', {
    bundleIds: ['io.neovim.neovide', 'com.neovim.neovim'],
    binary: 'neovide',
    desktopIds: ['neovide.desktop', 'nvim.desktop', 'io.neovim.nvim.desktop']
  }),
  editor('emacs', 'Emacs', {
    bundleIds: ['org.gnu.Emacs'],
    exeNames: ['runemacs.exe'],
    binary: 'emacs',
    desktopIds: ['emacs.desktop']
  }),
  // macOS only: Xcode ships nowhere else.
  editor('xcode', 'Xcode', { bundleIds: ['com.apple.dt.Xcode'] }),

  {
    id: 'apple-terminal',
    name: 'Terminal',
    kind: 'terminal',
    detect: { darwin: { type: 'macBundleId', bundleIds: ['com.apple.Terminal'] } },
    launch: { darwin: { type: 'macOpenA' } }
  },
  {
    id: 'iterm2',
    name: 'iTerm2',
    kind: 'terminal',
    detect: { darwin: { type: 'macBundleId', bundleIds: ['com.googlecode.iterm2'] } },
    launch: { darwin: { type: 'macOpenA' } }
  },
  {
    // Warp has no documented working-directory flag, so it is macOS only, where
    // `open -a <bundle> <dir>` supplies the directory.
    id: 'warp',
    name: 'Warp',
    kind: 'terminal',
    detect: { darwin: { type: 'macBundleId', bundleIds: ['dev.warp.Warp-Stable'] } },
    launch: { darwin: { type: 'macOpenA' } }
  },
  {
    id: 'ghostty',
    name: 'Ghostty',
    kind: 'terminal',
    detect: {
      darwin: { type: 'macBundleId', bundleIds: ['com.mitchellh.ghostty'] },
      linux: { type: 'linuxApp', binary: 'ghostty' }
    },
    launch: {
      darwin: { type: 'macOpenA' },
      // Ghostty's CLI only accepts the `--flag=value` form.
      linux: { type: 'exec', args: ['--working-directory={path}'] }
    }
  },
  {
    id: 'wezterm',
    name: 'WezTerm',
    kind: 'terminal',
    detect: {
      darwin: { type: 'macBundleId', bundleIds: ['com.github.wez.wezterm'] },
      win32: { type: 'winExecutable', exeNames: ['wezterm-gui.exe'] },
      linux: { type: 'linuxApp', binary: 'wezterm' }
    },
    launch: {
      darwin: { type: 'macOpenA' },
      win32: { type: 'exec', args: ['start', '--cwd'] },
      linux: { type: 'exec', args: ['start', '--cwd'] }
    }
  },
  {
    id: 'kitty',
    name: 'kitty',
    kind: 'terminal',
    detect: {
      darwin: { type: 'macBundleId', bundleIds: ['net.kovidgoyal.kitty'] },
      linux: { type: 'linuxApp', binary: 'kitty' }
    },
    launch: {
      darwin: { type: 'macOpenA' },
      // A positional argument would be read as the program to run.
      linux: { type: 'exec', args: ['--directory'] }
    }
  },
  {
    id: 'alacritty',
    name: 'Alacritty',
    kind: 'terminal',
    detect: {
      darwin: { type: 'macBundleId', bundleIds: ['org.alacritty'] },
      win32: { type: 'winExecutable', exeNames: ['alacritty.exe'] },
      linux: { type: 'linuxApp', binary: 'alacritty' }
    },
    launch: {
      darwin: { type: 'macOpenA' },
      win32: { type: 'exec', args: ['--working-directory'] },
      linux: { type: 'exec', args: ['--working-directory'] }
    }
  },
  {
    id: 'hyper',
    name: 'Hyper',
    kind: 'terminal',
    detect: {
      darwin: { type: 'macBundleId', bundleIds: ['co.zeit.hyper'] },
      win32: { type: 'winExecutable', exeNames: ['Hyper.exe'] },
      linux: { type: 'linuxApp', binary: 'hyper' }
    },
    // Hyper is the one terminal here that documents a positional directory
    // (`hyper <dir>`), so it needs no working-directory flag. Every other
    // terminal must declare one; see test/main/shared/fileOpenApps.test.ts.
    launch: {
      darwin: { type: 'macOpenA' },
      win32: { type: 'exec' },
      linux: { type: 'exec' }
    }
  },
  {
    id: 'windows-terminal',
    name: 'Windows Terminal',
    kind: 'terminal',
    detect: { win32: { type: 'winExecutable', exeNames: ['wt.exe'] } },
    // A positional argument is the command line wt runs, not the start directory.
    launch: { win32: { type: 'exec', args: ['-d'] } }
  },
  {
    id: 'gnome-terminal',
    name: 'GNOME Terminal',
    kind: 'terminal',
    detect: { linux: { type: 'linuxApp', binary: 'gnome-terminal' } },
    launch: { linux: { type: 'exec', args: ['--working-directory'] } }
  },
  {
    id: 'konsole',
    name: 'Konsole',
    kind: 'terminal',
    detect: { linux: { type: 'linuxApp', binary: 'konsole' } },
    launch: { linux: { type: 'exec', args: ['--workdir'] } }
  }
]

/** Normalize `process.platform` to the three platforms the registry covers. */
export function toFileOpenAppPlatform(platform: NodeJS.Platform): WorkspaceFileOpenAppPlatform {
  if (platform === 'darwin' || platform === 'win32') {
    return platform
  }
  return 'linux'
}

/** Apps usable on the given platform: both detection and launch must exist. */
export function appsForPlatform(
  platform: WorkspaceFileOpenAppPlatform
): WorkspaceFileOpenAppDefinition[] {
  return WORKSPACE_FILE_OPEN_APPS.filter(
    (definition) => definition.detect[platform] && definition.launch[platform]
  )
}
