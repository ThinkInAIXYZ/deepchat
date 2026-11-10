        #[cfg(windows)]
        if spec
            .executable
            .file_name()
            .is_some_and(|name| name.to_string_lossy().eq_ignore_ascii_case("cmd.exe"))
            && spec.args.len() >= 2
            && spec.args[spec.args.len() - 2]
                .to_string_lossy()
                .eq_ignore_ascii_case("/c")
        {
            use std::os::windows::process::CommandExt;
            command.args(&spec.args[..spec.args.len() - 1]);
            // cmd parses its command string itself. CRT argument quoting inserts
            // backslashes before its quotes and changes the command it executes.
            let mut raw = OsString::from("\"");
            raw.push(spec.args.last().expect("command argument"));
            raw.push("\"");
            command.as_std_mut().raw_arg(raw);
        } else {
            command.args(&spec.args);
        }
        #[cfg(not(windows))]
        command.args(&spec.args);
