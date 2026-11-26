# Debian packages and UOS compatibility

[Issue 2556](https://github.com/ThinkInAIXYZ/deepchat/issues/2556) reports UOS with Linux 4.19 and glibc 2.28. The reporter did not identify the CPU architecture. Both supported Linux architectures need a Debian package with architecture-specific dependencies and update metadata.

## Runtime boundary

The Linux x64 v1.1.5-beta.1 tarball contains an Electron executable requiring GLIBC_2.25 and a Node executable requiring GLIBC_2.28. Its packaged SQLite binding requires GLIBC_2.34. Its native Dim host imports GLIBC_2.38 and has versioned references up to GLIBC_2.39. A different installer alone cannot make those binaries runnable on UOS.

Build the startup SQLite binding and the local agent host against glibc 2.28 from the same pinned sources as other platforms. Exercise the built bindings with the packaged Node runtime. Load the S3 backup adapter on demand, so cloud storage dependencies are needed only when performing cloud operations. The packaged OpenDAL and Light OCR bindings currently require GLIBC_2.38 on x64. File search and the preview overlay have separate native dependencies. Their existing platform smoke tests remain on the supported modern Linux runner.

## Acceptance

- The release contains one installable Debian package per Linux architecture. AppImage clients keep their existing update URL and Debian clients find a matching package.
- The Debian package declares its system dependencies and can be unpacked by the dpkg shipped with glibc 2.28 distributions.
- Both the encrypted database and the Dim protocol work on a glibc 2.28 userspace. An actual UOS 4.19 launch and the remaining native features need separate verification before declaring full UOS support.

## Implementation

- [x] Add Debian to packaging and release validation.
- [ ] Build and exercise the startup and agent binaries on the older userspace.
- [ ] Validate the release assembly, updater metadata, and native package jobs.
