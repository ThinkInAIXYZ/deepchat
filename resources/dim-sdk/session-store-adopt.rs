// Importing a cold profile copies the immutable bytes before recording their
// native ownership. Ordinary files continue to be created by SessionFiles.put.
impl SessionStore {
    pub async fn adopt_file(
        &self,
        session_id: &str,
        file_id: &str,
        cancel: &tokio_util::sync::CancellationToken,
    ) -> Result<()> {
        self.files
            .adopt(session_id.to_owned(), file_id.to_owned(), cancel)
            .await
            .map_err(error)
    }
}
