// Cold-profile restoration changes the physical output location without
// rewriting immutable history or removing files from the original profile.
impl SessionStore {
    pub async fn relocate_output(
        &self,
        session_id: &str,
        old_path: &str,
        new_path: PathBuf,
    ) -> Result<bool> {
        if old_path.is_empty() || old_path.contains('\0') || !new_path.is_absolute() {
            return Err(error("invalid output relocation"));
        }
        let new_path = files::imported_output_path(&new_path)
            .ok_or_else(|| error("invalid canonical output destination"))?;
        let new_path = new_path
            .into_os_string()
            .into_string()
            .map_err(|_| error("output relocation must be UTF-8"))?;
        let session = session_id.to_owned();
        let old_path = old_path.to_owned();
        let _ownership = self.ownership.lock().await;
        self.timeline.db.run(move |connection| {
            let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(error)?;
            let changed = tx.execute(
                "INSERT OR IGNORE INTO session_output_owners (session_id, path) SELECT session_id, ?3 FROM session_output_owners WHERE session_id = ?1 AND path = ?2",
                params![session, old_path, new_path],
            ).map_err(error)?;
            if old_path != new_path {
                tx.execute("DELETE FROM session_output_owners WHERE session_id = ?1 AND path = ?2", params![session, old_path]).map_err(error)?;
            }
            tx.commit().map_err(error)?;
            Ok(changed > 0)
        }).await
    }
}
