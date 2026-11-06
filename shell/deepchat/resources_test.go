package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestResolveResourceLayoutDevelopment(t *testing.T) {
	root := t.TempDir()
	for _, directory := range []string{"out/renderer", "out/sidecar", "out/preload"} {
		if err := os.MkdirAll(filepath.Join(root, directory), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, path := range []string{"out/sidecar/app.mjs", "out/preload/bridge.js", "out/preload/splash.js"} {
		if err := os.WriteFile(filepath.Join(root, path), []byte("// test\n"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	t.Setenv("DEEPCHAT_APP_PATH", root)

	layout, err := resolveResourceLayout("")
	if err != nil {
		t.Fatal(err)
	}
	if layout.appRoot != root || layout.rendererDir != filepath.Join(root, "out", "renderer") {
		t.Fatalf("unexpected development layout: %+v", layout)
	}
	if !filepath.IsAbs(layout.nodePath) {
		t.Fatalf("development Node must be resolved: %q", layout.nodePath)
	}
}

func TestResolveResourceLayoutRequiresPackagedNode(t *testing.T) {
	t.Setenv("DEEPCHAT_APP_PATH", "")
	_, err := resolveResourceLayout(t.TempDir())
	if err == nil || !strings.Contains(err.Error(), filepath.Join("runtime", "node", "bin")) {
		t.Fatalf("expected missing bundled Node error, got %v", err)
	}
}
