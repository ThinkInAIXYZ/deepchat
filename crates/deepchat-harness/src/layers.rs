use super::*;
use rutis_loader::Loader;

pub struct Layers {
    loader: Loader,
    current: tokio::sync::Mutex<Vec<(String, Vec<Patch>)>>,
}

impl Layers {
    pub fn new(loader: Loader) -> Self {
        Self {
            loader,
            current: tokio::sync::Mutex::new(Vec::new()),
        }
    }

    pub async fn set(&self, name: &str, patches: Vec<Patch>) -> Result<()> {
        let mut current = self.current.lock().await;
        let mut next = current.clone();
        if let Some(layer) = next.iter_mut().find(|layer| layer.0 == name) {
            layer.1 = patches;
        } else {
            next.push((name.to_owned(), patches));
        }
        self.loader
            .reconcile(
                next.iter()
                    .map(|(name, patches)| Layer::new(name, patches.clone()))
                    .collect(),
                None,
            )
            .await?;
        *current = next;
        Ok(())
    }
}
