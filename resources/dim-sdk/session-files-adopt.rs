// Cold-profile import seam: the caller first copies this immutable directory
// under the destination's exclusive native database lease.
impl SessionFiles {
    pub(super) async fn adopt(
        &self,
        session: String,
        id: String,
        cancel: &CancellationToken,
    ) -> Result<(), SessionFileError> {
        if uuid::Uuid::parse_str(&id)
            .ok()
            .is_none_or(|value| value.to_string() != id)
        {
            return Err(file_error(
                SessionFileErrorCode::Invalid,
                "invalid imported file id",
            ));
        }
        let storage = self
            .0
            .ctx
            .get::<FileStorage>()
            .ok_or_else(node_unavailable)?;
        let relative = Path::new(&self.0.directory).join(&id);
        let directory = storage
            .path(self.0.root, &relative)
            .map_err(storage_failure)?;
        let entries = storage
            .list(&directory, cancel)
            .await
            .map_err(storage_failure)?;
        if entries.len() != 1
            || entries[0].kind != dim_agent_capabilities::file_storage::EntryKind::File
            || !entries[0].name.to_str().is_some_and(valid_name)
        {
            return Err(file_error(
                SessionFileErrorCode::Invalid,
                "invalid imported file directory",
            ));
        }
        let file = storage
            .path(self.0.root, relative.join(&entries[0].name))
            .map_err(storage_failure)?;
        if storage
            .open_read(&file, cancel)
            .await
            .map_err(storage_failure)?
            .len()
            > MAX_BYTES as u64
        {
            return Err(file_error(
                SessionFileErrorCode::TooLarge,
                "imported file exceeds 16 MiB",
            ));
        }
        if cancel.is_cancelled() {
            return Err(cancelled());
        }
        let present = self.0.db.run(move |connection| {
            let tx = connection.transaction_with_behavior(TransactionBehavior::Immediate).map_err(error)?;
            if !session_exists(&tx, &session).map_err(error)? { return Ok(false); }
            tx.execute("INSERT OR IGNORE INTO session_files (file_id, node, writer) VALUES (?1, NULL, NULL)", [&id]).map_err(error)?;
            let committed: bool = tx.query_row("SELECT node IS NULL AND writer IS NULL FROM session_files WHERE file_id = ?1", [&id], |row| row.get(0)).map_err(error)?;
            if !committed { return Err(error("imported file conflicts with native ownership")); }
            tx.execute("INSERT OR IGNORE INTO session_file_owners (session_id, file_id) VALUES (?1, ?2)", params![session, id]).map_err(error)?;
            tx.commit().map_err(error)?;
            Ok(true)
        }).await.map_err(|failure| file_error(SessionFileErrorCode::Storage, failure))?;
        if present { Ok(()) } else { Err(not_found()) }
    }
}
