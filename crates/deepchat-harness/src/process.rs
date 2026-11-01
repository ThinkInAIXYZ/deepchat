use std::io;

#[cfg(target_os = "macos")]
#[repr(C)]
#[derive(Clone, Default)]
struct UniqueIdentity {
    executable_uuid: [u8; 16],
    unique_id: u64,
    parent_unique_id: u64,
    pid_version: i32,
    original_parent_version: i32,
    reserved: [u64; 2],
}

#[cfg(target_os = "macos")]
pub fn launch(args: &[std::ffi::OsString]) -> io::Result<()> {
    use std::{
        fs::File, io::Read, os::fd::FromRawFd, os::unix::process::CommandExt, process::Command,
    };

    let executable = args
        .first()
        .filter(|value| !value.is_empty())
        .ok_or_else(|| io::Error::other("Missing execution command"))?;
    // SAFETY: fcntl validates the inherited control descriptor before File takes ownership.
    let flags = unsafe { libc::fcntl(3, libc::F_GETFL) };
    if flags < 0 {
        return Err(io::Error::last_os_error());
    }
    // SAFETY: descriptor 3 is owned by this process; only its blocking mode changes.
    if flags & libc::O_NONBLOCK != 0
        && unsafe { libc::fcntl(3, libc::F_SETFL, flags & !libc::O_NONBLOCK) } < 0
    {
        return Err(io::Error::last_os_error());
    }
    let environment = {
        // SAFETY: descriptor 3 is open and no other Rust object owns it.
        let mut control = unsafe { File::from_raw_fd(3) };
        let mut header = [0; 4];
        control.read_exact(&mut header)?;
        let length = u32::from_be_bytes(header) as usize;
        if length > 2 * 1024 * 1024 {
            return Err(io::Error::other(
                "Execution environment exceeds launch limit",
            ));
        }
        let mut data = vec![0; length];
        control.read_exact(&mut data)?;
        serde_json::from_slice::<std::collections::HashMap<String, String>>(&data)?
    };
    // Close the control descriptor before exec; stdin remains exclusively the command's input.
    Err(Command::new(executable)
        .args(&args[1..])
        .env_clear()
        .envs(environment)
        .exec())
}

#[cfg(not(target_os = "macos"))]
pub fn launch(_args: &[std::ffi::OsString]) -> io::Result<()> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Native execution gate is unavailable on this platform",
    ))
}

#[cfg(target_os = "macos")]
fn identity(pid: i32) -> io::Result<UniqueIdentity> {
    use std::mem::size_of;
    // XNU proc_uniqidentifierinfo is a stable 56-byte ABI; pidversion changes on exec.
    // https://github.com/apple-oss-distributions/xnu/blob/main/bsd/sys/proc_info_private.h
    const _: () = assert!(size_of::<UniqueIdentity>() == 56);
    let mut identity = UniqueIdentity::default();
    // SAFETY: identity is aligned, writable and exactly the requested ABI size.
    let bytes = unsafe {
        libc::proc_pidinfo(
            pid,
            17, // PROC_PIDUNIQIDENTIFIERINFO
            0,
            (&mut identity as *mut UniqueIdentity).cast(),
            size_of::<UniqueIdentity>() as i32,
        )
    };
    if bytes != size_of::<UniqueIdentity>() as i32 || identity.unique_id == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(identity)
}

#[cfg(target_os = "macos")]
fn boot_session() -> io::Result<String> {
    use std::ffi::CStr;
    let mut boot = [0_u8; 64];
    let mut length = boot.len();
    // SAFETY: the key is NUL-terminated and boot is writable for length bytes.
    let result = unsafe {
        libc::sysctlbyname(
            c"kern.bootsessionuuid".as_ptr(),
            boot.as_mut_ptr().cast(),
            &mut length,
            std::ptr::null_mut(),
            0,
        )
    };
    if result != 0 || length == 0 || length > boot.len() {
        return Err(io::Error::last_os_error());
    }
    let boot = CStr::from_bytes_until_nul(&boot[..length])
        .map_err(io::Error::other)?
        .to_str()
        .map_err(io::Error::other)?;
    Ok(boot.to_owned())
}

#[cfg(target_os = "macos")]
pub fn inspect(pid: i32) -> io::Result<serde_json::Value> {
    let identity = identity(pid)?;
    let boot = boot_session()?;
    Ok(serde_json::json!({
        "pid": pid,
        "nativeIdentity": format!("darwin:{boot}:{}", identity.unique_id)
    }))
}

#[cfg(target_os = "macos")]
pub fn terminate_tree(
    pid: i32,
    expected: &str,
    grace_ms: u64,
    owned_group: bool,
) -> io::Result<bool> {
    use std::{
        collections::HashSet,
        time::{Duration, Instant},
    };

    if pid <= 0 || grace_ms > 2000 {
        return Err(io::Error::other("Invalid owned process root"));
    }
    let boot = boot_session()?;
    let (expected_boot, expected_birth) = expected
        .strip_prefix("darwin:")
        .and_then(|value| value.rsplit_once(':'))
        .ok_or_else(|| io::Error::other("Invalid process identity"))?;
    if expected_boot.len() != 36
        || !expected_boot.bytes().enumerate().all(|(i, c)| {
            if [8, 13, 18, 23].contains(&i) {
                c == b'-'
            } else {
                c.is_ascii_hexdigit()
            }
        })
    {
        return Err(io::Error::other("Invalid process boot identity"));
    }
    let expected_id: u64 = expected_birth.parse().map_err(io::Error::other)?;
    if expected_id == 0 || expected_birth != expected_id.to_string() {
        return Err(io::Error::other("Invalid process birth identity"));
    }
    if !expected_boot.eq_ignore_ascii_case(&boot) {
        return Ok(true);
    }
    if pid == std::process::id() as i32 {
        return Err(io::Error::other("Cannot retire the inspector"));
    }
    let root_alive = || -> io::Result<bool> {
        match identity(pid) {
            Ok(root) => {
                if root.unique_id != expected_id {
                    return Err(io::Error::other("Process birth identity changed"));
                }
                if owned_group {
                    // SAFETY: getpgid only observes the positive, validated root PID.
                    let group = unsafe { libc::getpgid(pid) };
                    if group < 0 {
                        let error = io::Error::last_os_error();
                        if error.raw_os_error() == Some(libc::ESRCH) {
                            return Ok(false);
                        }
                        return Err(error);
                    }
                    if group != pid {
                        return Err(io::Error::other("Process does not lead its owned group"));
                    }
                }
                match identity(pid) {
                    Ok(after) if after.unique_id == expected_id => Ok(true),
                    Ok(_) => Err(io::Error::other("Process birth identity changed")),
                    Err(error) if error.raw_os_error() == Some(libc::ESRCH) => Ok(false),
                    Err(error) => Err(error),
                }
            }
            Err(error) if error.raw_os_error() == Some(libc::ESRCH) => Ok(false),
            Err(error) => Err(error),
        }
    };
    let capture = |owned: &mut HashSet<u64>| -> io::Result<Vec<(i32, UniqueIdentity)>> {
        root_alive()?;
        let mut pids = [0_i32; 4096];
        // libproc returns zero for both an empty group and errors.
        // SAFETY: __error returns this thread's writable errno pointer.
        unsafe { *libc::__error() = 0 };
        let count = if owned_group {
            // SAFETY: pids is writable for the exact supplied byte count.
            unsafe {
                libc::proc_listpgrppids(
                    pid,
                    pids.as_mut_ptr().cast(),
                    std::mem::size_of_val(&pids) as i32,
                )
            }
        } else {
            0
        };
        let error = io::Error::last_os_error();
        if count == 0 && error.raw_os_error() != Some(0) {
            return Err(error);
        }
        if count < 0 || count as usize >= pids.len() {
            return Err(io::Error::other("Incomplete process group snapshot"));
        }
        let mut group = Vec::with_capacity(count as usize);
        for &member in &pids[..count as usize] {
            match identity(member) {
                Ok(observed) => {
                    // Bind group membership to this birth rather than a reused listed PID.
                    // SAFETY: getpgid only observes a PID returned by libproc.
                    let member_group = unsafe { libc::getpgid(member) };
                    if member_group < 0 {
                        let error = io::Error::last_os_error();
                        if error.raw_os_error() == Some(libc::ESRCH) {
                            continue;
                        }
                        return Err(error);
                    }
                    let after = match identity(member) {
                        Ok(after) => after,
                        Err(error) if error.raw_os_error() == Some(libc::ESRCH) => continue,
                        Err(error) => return Err(error),
                    };
                    if member_group != pid || after.unique_id != observed.unique_id {
                        continue;
                    }
                    group.push((member, observed));
                }
                Err(error) if error.raw_os_error() == Some(libc::ESRCH) => {}
                Err(error) => return Err(error),
            }
        }
        // SAFETY: reset errno before the bounded UID query, with the exact writable buffer.
        unsafe { *libc::__error() = 0 };
        let bytes = unsafe {
            libc::proc_listpids(
                4, // PROC_UID_ONLY
                libc::geteuid(),
                pids.as_mut_ptr().cast(),
                std::mem::size_of_val(&pids) as i32,
            )
        };
        if bytes <= 0
            || bytes as usize >= std::mem::size_of_val(&pids)
            || !(bytes as usize).is_multiple_of(std::mem::size_of::<i32>())
        {
            return Err(io::Error::other("Incomplete same-user process snapshot"));
        }
        let mut candidates = Vec::with_capacity(bytes as usize / std::mem::size_of::<i32>());
        for &candidate in &pids[..bytes as usize / std::mem::size_of::<i32>()] {
            match identity(candidate) {
                Ok(observed) => {
                    if observed.unique_id == expected_id && candidate != pid {
                        return Err(io::Error::other("Root birth belongs to another PID"));
                    }
                    candidates.push((candidate, observed));
                }
                Err(error) if error.raw_os_error() == Some(libc::ESRCH) => {}
                Err(error) => return Err(error),
            }
        }
        let root_present = root_alive()?;
        for (member, observed) in &group {
            if root_present {
                owned.insert(observed.unique_id);
            }
            if !candidates
                .iter()
                .any(|(_, other)| other.unique_id == observed.unique_id)
            {
                candidates.push((*member, observed.clone()));
            }
        }
        if candidates.len() >= pids.len() {
            return Err(io::Error::other("Process snapshot exceeds ownership limit"));
        }
        loop {
            let before = owned.len();
            for (_, candidate) in &candidates {
                if owned.contains(&candidate.parent_unique_id) {
                    owned.insert(candidate.unique_id);
                }
            }
            if owned.len() >= pids.len() {
                return Err(io::Error::other("Process ancestry exceeds ownership limit"));
            }
            if before == owned.len() {
                break;
            }
        }
        if group
            .iter()
            .any(|(_, member)| !owned.contains(&member.unique_id))
        {
            return Err(io::Error::other("Cannot attest ancestry after root exit"));
        }
        candidates.retain(|(_, member)| owned.contains(&member.unique_id));
        candidates.sort_by_key(|(member, _)| *member == pid);
        Ok(candidates)
    };
    let wait = |members: &[(i32, UniqueIdentity)], duration| -> io::Result<bool> {
        let deadline = Instant::now() + duration;
        loop {
            let mut members_gone = true;
            for (member, captured) in members {
                match identity(*member) {
                    Ok(observed) => members_gone &= observed.unique_id != captured.unique_id,
                    Err(error) if error.raw_os_error() == Some(libc::ESRCH) => {}
                    Err(error) => return Err(error),
                }
            }
            let group_gone = if owned_group {
                // SAFETY: signal zero observes group liveness without sending a signal.
                if unsafe { libc::kill(-pid, 0) } != 0 {
                    let error = io::Error::last_os_error();
                    if error.raw_os_error() != Some(libc::ESRCH) {
                        return Err(error);
                    }
                    true
                } else {
                    false
                }
            } else {
                true
            };
            if group_gone && members_gone {
                return Ok(true);
            }
            if Instant::now() >= deadline {
                return Ok(false);
            }
            std::thread::sleep(Duration::from_millis(25));
        }
    };
    let mut owned = HashSet::from([expected_id]);
    let members = capture(&mut owned)?;
    if members.is_empty() && wait(&members, Duration::from_millis(500))? {
        return Ok(capture(&mut owned)?.is_empty());
    }
    type Signal = unsafe extern "C" fn(*const [u32; 8], i32) -> i32;
    // SAFETY: dlsym resolves an optional system function with the libproc.h signature.
    let symbol =
        unsafe { libc::dlsym(libc::RTLD_DEFAULT, c"proc_signal_with_audittoken".as_ptr()) };
    if symbol.is_null() {
        return Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Identity-bound process signals are unavailable",
        ));
    }
    // SAFETY: the non-null symbol is the system function declared above.
    let signal: Signal = unsafe { std::mem::transmute(symbol) };
    let send = |members: &[(i32, UniqueIdentity)], signum| -> io::Result<()> {
        for &(member, ref captured) in members {
            let observed = match identity(member) {
                Ok(observed) => observed,
                Err(error) if error.raw_os_error() == Some(libc::ESRCH) => continue,
                Err(error) => return Err(error),
            };
            if observed.unique_id != captured.unique_id {
                continue;
            }
            let mut token = [0_u32; 8];
            token[5] = member as u32;
            token[7] = observed.pid_version as u32;
            // XNU validates PID/version and retains the process reference while signaling.
            // SAFETY: token has the audit_token_t layout for this synchronous call.
            if unsafe { signal(&token, signum) } != 0 {
                let error = io::Error::last_os_error();
                if error.raw_os_error() == Some(libc::ESRCH) {
                    match identity(member) {
                        Ok(current) if current.unique_id != captured.unique_id => continue,
                        Err(gone) if gone.raw_os_error() == Some(libc::ESRCH) => continue,
                        _ => {}
                    }
                }
                return Err(error);
            }
        }
        Ok(())
    };
    send(&members, libc::SIGTERM)?;
    let exited = wait(&members, Duration::from_millis(grace_ms))?;
    let remaining = capture(&mut owned)?;
    if exited && remaining.is_empty() {
        return Ok(true);
    }
    send(&remaining, libc::SIGKILL)?;
    if !wait(&remaining, Duration::from_millis(500))? {
        return Ok(false);
    }
    Ok(capture(&mut owned)?.is_empty())
}

#[cfg(not(target_os = "macos"))]
pub fn terminate_tree(
    _pid: i32,
    _expected: &str,
    _grace_ms: u64,
    _owned_group: bool,
) -> io::Result<bool> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Identity-bound process signals are unavailable on this platform",
    ))
}

#[cfg(not(target_os = "macos"))]
pub fn inspect(_pid: i32) -> io::Result<serde_json::Value> {
    Err(io::Error::new(
        io::ErrorKind::Unsupported,
        "Native process identity is unavailable on this platform",
    ))
}

#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::{
        io::{BufRead, BufReader, Write},
        process::{Command, Stdio},
    };

    #[test]
    fn native_identity_survives_exec_and_rejects_an_exited_process() {
        let mut child = Command::new("/bin/sh")
            .args(["-c", "read gate; exec /bin/cat"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .unwrap();
        let checked = (|| -> io::Result<_> {
            let before = inspect(child.id() as i32)?;
            child
                .stdin
                .as_mut()
                .unwrap()
                .write_all(b"go\ntransitioned\n")?;
            let mut line = String::new();
            BufReader::new(child.stdout.as_mut().unwrap()).read_line(&mut line)?;
            Ok((before, inspect(child.id() as i32)?, line))
        })();
        let _ = child.kill();
        child.wait().unwrap();
        let (before, after, line) = checked.unwrap();
        assert_eq!(line, "transitioned\n");
        assert_eq!(before, after);
        assert!(inspect(child.id() as i32).is_err());
    }

    #[test]
    fn group_recovery_refuses_another_birth_and_escalates_owned_members() {
        use std::os::unix::process::CommandExt;

        for (root_exits, escaped, owned_group) in [
            (false, false, true),
            (true, false, true),
            (false, true, true),
            (true, true, true),
            (false, false, false),
            (true, false, false),
            (false, true, false),
            (true, true, false),
        ] {
            let release = std::env::temp_dir().join(format!(
                "deepchat-native-root-{}-{root_exits}-{escaped}-{owned_group}",
                std::process::id()
            ));
            let quoted = release.to_string_lossy().replace('\'', "'\\''");
            let ending = if root_exits {
                format!("while [ ! -f '{quoted}' ]; do sleep 0.01; done; exit 0")
            } else {
                "wait".to_owned()
            };
            let mut command = Command::new("/bin/sh");
            if owned_group {
                command.process_group(0);
            }
            let mut child = command
                .args([
                    "-c",
                    &format!(
                        "{}trap '' TERM; /bin/cat <&0 & echo $!; {ending}",
                        if escaped { "set -m; " } else { "" }
                    ),
                ])
                .stdin(Stdio::piped())
                .stdout(Stdio::piped())
                .spawn()
                .unwrap();
            let pid = child.id() as i32;
            let input = child.stdin.take().unwrap();
            let mut output = BufReader::new(child.stdout.take().unwrap());
            let mut waiter = Some(std::thread::spawn(move || child.wait()));
            let checked = (|| -> io::Result<_> {
                let mut ready = String::new();
                output.read_line(&mut ready)?;
                let member: i32 = ready.trim().parse().map_err(io::Error::other)?;
                let member_identity = identity(member)?.unique_id;
                // SAFETY: this only observes the fixture's announced live child.
                if owned_group && (unsafe { libc::getpgid(member) } != pid) != escaped {
                    return Err(io::Error::other("Fixture process group mismatch"));
                }
                let expected = inspect(pid)?["nativeIdentity"]
                    .as_str()
                    .ok_or_else(|| io::Error::other("Missing native identity"))?
                    .to_owned();
                if root_exits {
                    std::fs::write(&release, b"release")?;
                    waiter.take().unwrap().join().unwrap()?;
                }
                let wrong = inspect(std::process::id() as i32)?["nativeIdentity"]
                    .as_str()
                    .unwrap()
                    .to_owned();
                let refused = terminate_tree(pid, &wrong, 20, owned_group).is_err();
                let old_boot = if expected.contains("00000000-0000-0000-0000-000000000000") {
                    "11111111-1111-1111-1111-111111111111"
                } else {
                    "00000000-0000-0000-0000-000000000000"
                };
                let stale_retired = terminate_tree(
                    pid,
                    &format!("darwin:{old_boot}:{}", expected.rsplit(':').next().unwrap()),
                    20,
                    owned_group,
                )?;
                let still_owned = identity(member)?.unique_id == member_identity;
                let retired = terminate_tree(pid, &expected, 20, owned_group)?;
                Ok((refused && stale_retired, still_owned, retired))
            })();
            // EOF and the owned release file drain failures without signaling a reused PID.
            drop(input);
            std::fs::write(&release, b"release").unwrap();
            if let Some(waiter) = waiter {
                waiter.join().unwrap().unwrap();
            }
            std::fs::remove_file(release).unwrap();
            let (refused, still_owned, retired) = checked.unwrap();
            assert!(refused && still_owned && retired);
            assert!(inspect(std::process::id() as i32).is_ok());
        }
    }
}
