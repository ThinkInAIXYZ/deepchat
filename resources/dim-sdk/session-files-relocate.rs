// Restore uses the same canonical existing-prefix rule as ordinary output
// registration, including native Windows prefixes and aliased system temp paths.
pub(super) fn imported_output_path(path: &Path) -> Option<PathBuf> {
    resolve(path)
}
