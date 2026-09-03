/**
 * Registry of editors, IDEs and terminals offered in the workspace "open with" picker.
 * Icons are not listed here: the main process reads each application's real icon
 * from the OS, and the renderer falls back to a placeholder per app kind.
 */

export type WorkspaceFileOpenAppKind = 'editor' | 'terminal'

export type WorkspaceFileOpenAppDefinition = {
  /** Stable identifier used across IPC; never a filesystem path. */
  id: string
  /** Display name shown in the picker. */
  name: string
  kind: WorkspaceFileOpenAppKind
  /** macOS bundle identifiers, most specific first. */
  bundleIds?: string[]
  /** Windows executable basenames looked up via App Paths / PATH. */
  executables?: string[]
  /** Linux desktop entry ids. */
  desktopIds?: string[]
}

/**
 * Only mainstream editors, IDEs and terminals are listed. Anything outside this
 * registry (browsers, note apps, generic viewers) is intentionally excluded from
 * the picker; the "open with system default" entry still covers those cases.
 */
export const WORKSPACE_FILE_OPEN_APPS: readonly WorkspaceFileOpenAppDefinition[] = [
  {
    id: 'vscode',
    name: 'VS Code',
    kind: 'editor',
    bundleIds: ['com.microsoft.VSCode'],
    executables: ['code.exe'],
    desktopIds: ['code.desktop', 'visual-studio-code.desktop']
  },
  {
    id: 'vscode-insiders',
    name: 'VS Code Insiders',
    kind: 'editor',
    bundleIds: ['com.microsoft.VSCodeInsiders'],
    executables: ['code-insiders.exe'],
    desktopIds: ['code-insiders.desktop']
  },
  {
    id: 'vscodium',
    name: 'VSCodium',
    kind: 'editor',
    bundleIds: ['com.vscodium', 'com.visualstudio.code.oss'],
    executables: ['codium.exe'],
    desktopIds: ['codium.desktop', 'vscodium.desktop']
  },
  {
    id: 'cursor',
    name: 'Cursor',
    kind: 'editor',
    bundleIds: ['com.todesktop.230313mzl4w4u92'],
    executables: ['cursor.exe'],
    desktopIds: ['cursor.desktop']
  },
  {
    id: 'windsurf',
    name: 'Windsurf',
    kind: 'editor',
    bundleIds: ['com.exafunction.windsurf'],
    executables: ['windsurf.exe'],
    desktopIds: ['windsurf.desktop']
  },
  {
    id: 'zed',
    name: 'Zed',
    kind: 'editor',
    bundleIds: ['dev.zed.Zed'],
    executables: ['zed.exe'],
    desktopIds: ['dev.zed.Zed.desktop', 'zed.desktop']
  },
  {
    id: 'intellij',
    name: 'IntelliJ IDEA',
    kind: 'editor',
    bundleIds: ['com.jetbrains.intellij', 'com.jetbrains.intellij.ce'],
    executables: ['idea64.exe'],
    desktopIds: ['intellij-idea-ultimate.desktop', 'intellij-idea-community.desktop']
  },
  {
    id: 'goland',
    name: 'GoLand',
    kind: 'editor',
    bundleIds: ['com.jetbrains.goland'],
    executables: ['goland64.exe'],
    desktopIds: ['goland.desktop']
  },
  {
    id: 'webstorm',
    name: 'WebStorm',
    kind: 'editor',
    bundleIds: ['com.jetbrains.WebStorm'],
    executables: ['webstorm64.exe'],
    desktopIds: ['webstorm.desktop']
  },
  {
    id: 'pycharm',
    name: 'PyCharm',
    kind: 'editor',
    bundleIds: ['com.jetbrains.pycharm', 'com.jetbrains.pycharm.ce'],
    executables: ['pycharm64.exe'],
    desktopIds: ['pycharm-professional.desktop', 'pycharm-community.desktop']
  },
  {
    id: 'rustrover',
    name: 'RustRover',
    kind: 'editor',
    bundleIds: ['com.jetbrains.rustrover'],
    executables: ['rustrover64.exe'],
    desktopIds: ['rustrover.desktop']
  },
  {
    id: 'clion',
    name: 'CLion',
    kind: 'editor',
    bundleIds: ['com.jetbrains.CLion'],
    executables: ['clion64.exe'],
    desktopIds: ['clion.desktop']
  },
  {
    id: 'rider',
    name: 'Rider',
    kind: 'editor',
    bundleIds: ['com.jetbrains.rider'],
    executables: ['rider64.exe'],
    desktopIds: ['rider.desktop']
  },
  {
    id: 'phpstorm',
    name: 'PhpStorm',
    kind: 'editor',
    bundleIds: ['com.jetbrains.PhpStorm'],
    executables: ['phpstorm64.exe'],
    desktopIds: ['phpstorm.desktop']
  },
  {
    id: 'rubymine',
    name: 'RubyMine',
    kind: 'editor',
    bundleIds: ['com.jetbrains.rubymine'],
    executables: ['rubymine64.exe'],
    desktopIds: ['rubymine.desktop']
  },
  {
    id: 'fleet',
    name: 'Fleet',
    kind: 'editor',
    bundleIds: ['com.jetbrains.fleet'],
    executables: ['fleet.exe'],
    desktopIds: ['fleet.desktop']
  },
  {
    id: 'android-studio',
    name: 'Android Studio',
    kind: 'editor',
    bundleIds: ['com.google.android.studio'],
    executables: ['studio64.exe'],
    desktopIds: ['android-studio.desktop']
  },
  {
    id: 'xcode',
    name: 'Xcode',
    kind: 'editor',
    bundleIds: ['com.apple.dt.Xcode']
  },
  {
    id: 'sublime-text',
    name: 'Sublime Text',
    kind: 'editor',
    bundleIds: ['com.sublimetext.4', 'com.sublimetext.3'],
    executables: ['sublime_text.exe'],
    desktopIds: ['sublime_text.desktop']
  },
  {
    id: 'neovim',
    name: 'Neovim',
    kind: 'editor',
    bundleIds: ['io.neovim.neovide', 'com.neovim.neovim'],
    executables: ['nvim.exe'],
    desktopIds: ['nvim.desktop', 'neovide.desktop']
  },
  {
    id: 'emacs',
    name: 'Emacs',
    kind: 'editor',
    bundleIds: ['org.gnu.Emacs'],
    executables: ['emacs.exe'],
    desktopIds: ['emacs.desktop']
  },
  {
    id: 'apple-terminal',
    name: 'Terminal',
    kind: 'terminal',
    bundleIds: ['com.apple.Terminal']
  },
  {
    id: 'iterm2',
    name: 'iTerm2',
    kind: 'terminal',
    bundleIds: ['com.googlecode.iterm2']
  },
  {
    id: 'ghostty',
    name: 'Ghostty',
    kind: 'terminal',
    bundleIds: ['com.mitchellh.ghostty'],
    desktopIds: ['com.mitchellh.ghostty.desktop']
  },
  {
    id: 'warp',
    name: 'Warp',
    kind: 'terminal',
    bundleIds: ['dev.warp.Warp-Stable'],
    desktopIds: ['dev.warp.Warp.desktop']
  },
  {
    id: 'wezterm',
    name: 'WezTerm',
    kind: 'terminal',
    bundleIds: ['com.github.wez.wezterm'],
    executables: ['wezterm-gui.exe'],
    desktopIds: ['org.wezfurlong.wezterm.desktop']
  },
  {
    id: 'kitty',
    name: 'kitty',
    kind: 'terminal',
    bundleIds: ['net.kovidgoyal.kitty'],
    desktopIds: ['kitty.desktop']
  },
  {
    id: 'alacritty',
    name: 'Alacritty',
    kind: 'terminal',
    bundleIds: ['org.alacritty'],
    executables: ['alacritty.exe'],
    desktopIds: ['Alacritty.desktop', 'alacritty.desktop']
  },
  {
    id: 'hyper',
    name: 'Hyper',
    kind: 'terminal',
    bundleIds: ['co.zeit.hyper'],
    executables: ['hyper.exe'],
    desktopIds: ['hyper.desktop']
  },
  {
    id: 'windows-terminal',
    name: 'Windows Terminal',
    kind: 'terminal',
    executables: ['wt.exe']
  },
  {
    id: 'gnome-terminal',
    name: 'GNOME Terminal',
    kind: 'terminal',
    desktopIds: ['org.gnome.Terminal.desktop']
  },
  {
    id: 'konsole',
    name: 'Konsole',
    kind: 'terminal',
    desktopIds: ['org.kde.konsole.desktop']
  }
]
