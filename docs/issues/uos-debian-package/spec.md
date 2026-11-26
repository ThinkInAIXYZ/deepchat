# Debian packages and UOS compatibility

[Issue 2556](https://github.com/ThinkInAIXYZ/deepchat/issues/2556) reports UOS with Linux 4.19 and glibc 2.28. The reporter did not identify the CPU architecture. Both supported Linux architectures need a Debian package with architecture-specific dependencies and update metadata.

## Runtime boundary

The Linux x64 v1.1.5-beta.1 tarball contains an Electron executable requiring GLIBC_2.25 and a Node executable requiring GLIBC_2.28. Its packaged SQLite binding requires GLIBC_2.34. The x64 Dim host imports GLIBC_2.38 and has versioned references up to GLIBC_2.39. In a Debian 10 ARM64 guest with Linux 4.19, the published application stopped during database initialization because its SQLite binding could not load. The packaged Dim host also failed to load. A different installer alone cannot make those binaries runnable on UOS.

Build the startup SQLite binding and the local agent host against glibc 2.28 from the same pinned sources as other platforms. Exercise the built bindings and a PTY subprocess with the packaged Node runtime. Load the S3 backup adapter on demand, so cloud storage dependencies are needed only when performing cloud operations. Light OCR requires GLIBC_2.38 and GLIBCXX_3.4.32 on x64 and ARM64. The x64 OpenDAL binding requires GLIBC_2.38. On ARM64, OpenDAL loaded on Linux 4.19/glibc 2.28, completed an in-memory write/read round trip and constructed an S3 operator. File search and the preview overlay have separate native dependencies. Their existing platform smoke tests remain on the supported modern Linux runner.

## Acceptance

- The release contains one installable Debian package per Linux architecture. AppImage clients keep their existing update URL and Debian clients find a matching package.
- The Debian package declares its system dependencies and can be unpacked by the dpkg shipped with glibc 2.28 distributions.
- Both the encrypted database and the Dim protocol work on a glibc 2.28 userspace. An actual UOS 4.19 launch and the remaining native features need separate verification before declaring full UOS support.

## Implementation

- [x] Add Debian to packaging and release validation.
- [x] Build the database binding and Dim host against glibc 2.28 on both architectures.
- [x] Gate distribution on Debian installation, native runtime checks, and desktop startup. Validate both Linux updater payloads during release assembly.
