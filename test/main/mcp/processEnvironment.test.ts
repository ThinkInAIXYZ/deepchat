import { describe, expect, it } from 'vitest'

import { createMinimalProcessEnvironment } from '@/mcp/processEnvironment'

const sourceEnvironment = {
  PATH: '/usr/bin:/bin',
  HOME: '/home/user',
  USER: 'user',
  LOGNAME: 'user',
  SHELL: '/bin/zsh',
  TMPDIR: '/tmp/session',
  TMP: '/tmp',
  TEMP: '/tmp',
  LANG: 'en_US.UTF-8',
  LC_ALL: 'en_US.UTF-8',
  CUA_LOG: 'debug',
  API_TOKEN: 'secret',
  HTTP_PROXY: 'http://proxy.invalid'
}

describe('createMinimalProcessEnvironment', () => {
  it('preserves the Linux desktop session without inheriting credentials', () => {
    expect(
      createMinimalProcessEnvironment(
        {
          ...sourceEnvironment,
          DISPLAY: ':0',
          WAYLAND_DISPLAY: 'wayland-0',
          XAUTHORITY: '/run/user/1000/xauth',
          XDG_RUNTIME_DIR: '/run/user/1000',
          XDG_SESSION_TYPE: 'x11',
          DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
          AT_SPI_BUS: 'unix:path=/run/user/1000/at-spi/bus',
          SWAYSOCK: '/run/user/1000/sway-ipc.sock',
          XDG_CURRENT_DESKTOP: 'sway',
          XDG_SESSION_DESKTOP: 'sway',
          DESKTOP_SESSION: 'sway',
          XDG_DATA_HOME: '/home/user/.local/share',
          XDG_DATA_DIRS: '/usr/local/share:/usr/share',
          SSH_AUTH_SOCK: '/run/user/1000/ssh-agent'
        },
        'linux'
      )
    ).toEqual({
      PATH: '/usr/bin:/bin',
      HOME: '/home/user',
      USER: 'user',
      LOGNAME: 'user',
      SHELL: '/bin/zsh',
      TMPDIR: '/tmp/session',
      TMP: '/tmp',
      TEMP: '/tmp',
      LANG: 'en_US.UTF-8',
      LC_ALL: 'en_US.UTF-8',
      DISPLAY: ':0',
      WAYLAND_DISPLAY: 'wayland-0',
      XAUTHORITY: '/run/user/1000/xauth',
      XDG_RUNTIME_DIR: '/run/user/1000',
      XDG_SESSION_TYPE: 'x11',
      DBUS_SESSION_BUS_ADDRESS: 'unix:path=/run/user/1000/bus',
      AT_SPI_BUS: 'unix:path=/run/user/1000/at-spi/bus',
      SWAYSOCK: '/run/user/1000/sway-ipc.sock',
      XDG_CURRENT_DESKTOP: 'sway',
      XDG_SESSION_DESKTOP: 'sway',
      DESKTOP_SESSION: 'sway',
      XDG_DATA_HOME: '/home/user/.local/share',
      XDG_DATA_DIRS: '/usr/local/share:/usr/share'
    })
  })

  it('matches Windows environment keys case-insensitively', () => {
    expect(
      createMinimalProcessEnvironment(
        {
          Path: 'C:\\Windows\\System32',
          SystemRoot: 'C:\\Windows',
          windir: 'C:\\Windows',
          ComSpec: 'C:\\Windows\\System32\\cmd.exe',
          PATHEXT: '.EXE;.CMD',
          USERPROFILE: 'C:\\Users\\user',
          USERNAME: 'user',
          APPDATA: 'C:\\Users\\user\\AppData\\Roaming',
          LOCALAPPDATA: 'C:\\Users\\user\\AppData\\Local',
          PROGRAMDATA: 'C:\\ProgramData',
          PROCESSOR_ARCHITECTURE: 'AMD64',
          lc_messages: 'en_US',
          AWS_SECRET_ACCESS_KEY: 'secret'
        },
        'win32'
      )
    ).toEqual({
      Path: 'C:\\Windows\\System32',
      SystemRoot: 'C:\\Windows',
      windir: 'C:\\Windows',
      ComSpec: 'C:\\Windows\\System32\\cmd.exe',
      PATHEXT: '.EXE;.CMD',
      USERPROFILE: 'C:\\Users\\user',
      USERNAME: 'user',
      APPDATA: 'C:\\Users\\user\\AppData\\Roaming',
      LOCALAPPDATA: 'C:\\Users\\user\\AppData\\Local',
      PROGRAMDATA: 'C:\\ProgramData',
      PROCESSOR_ARCHITECTURE: 'AMD64',
      lc_messages: 'en_US'
    })
  })

  it('does not leak Linux session variables into macOS helpers', () => {
    expect(
      createMinimalProcessEnvironment(
        {
          ...sourceEnvironment,
          DISPLAY: ':0',
          XDG_RUNTIME_DIR: '/run/user/1000'
        },
        'darwin'
      )
    ).not.toMatchObject({
      DISPLAY: expect.anything(),
      XDG_RUNTIME_DIR: expect.anything(),
      CUA_LOG: expect.anything(),
      API_TOKEN: expect.anything()
    })
  })
})
