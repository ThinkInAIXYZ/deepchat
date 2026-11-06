package main

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
)

type resourceLayout struct {
	appRoot      string
	rendererDir  string
	sidecarEntry string
	preloadPath  string
	nodePath     string
}

func requireResourceFile(path string) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("required application resource %s: %w", path, err)
	}
	if !info.Mode().IsRegular() {
		return fmt.Errorf("required application resource %s is not a file", path)
	}
	return nil
}

// resolveResourceLayout separates explicit repository development from packaged
// resources. Packaged mode never falls back to PATH or the source checkout.
func resolveResourceLayout(resourcesDir string) (resourceLayout, error) {
	if appRoot := os.Getenv("DEEPCHAT_APP_PATH"); appRoot != "" {
		absRoot, err := filepath.Abs(appRoot)
		if err != nil {
			return resourceLayout{}, fmt.Errorf("resolve development app root: %w", err)
		}
		nodePath, err := exec.LookPath("node")
		if err != nil {
			return resourceLayout{}, fmt.Errorf("development Node.js is unavailable: %w", err)
		}
		layout := resourceLayout{
			appRoot:      absRoot,
			rendererDir:  filepath.Join(absRoot, "out", "renderer"),
			sidecarEntry: filepath.Join(absRoot, "out", "sidecar", "app.mjs"),
			preloadPath:  filepath.Join(absRoot, "out", "preload", "bridge.js"),
			nodePath:     nodePath,
		}
		for _, path := range []string{layout.sidecarEntry, layout.preloadPath} {
			if err := requireResourceFile(path); err != nil {
				return resourceLayout{}, err
			}
		}
		if info, err := os.Stat(layout.rendererDir); err != nil || !info.IsDir() {
			return resourceLayout{}, fmt.Errorf("development renderer is missing at %s", layout.rendererDir)
		}
		return layout, nil
	}

	executable := "node"
	if runtime.GOOS == "windows" {
		executable += ".exe"
	}
	layout := resourceLayout{
		appRoot:      resourcesDir,
		sidecarEntry: filepath.Join(resourcesDir, "sidecar", "app.mjs"),
		preloadPath:  filepath.Join(resourcesDir, "preload", "bridge.js"),
		nodePath:     filepath.Join(resourcesDir, "runtime", "node", "bin", executable),
	}
	for _, path := range []string{layout.nodePath, layout.sidecarEntry, layout.preloadPath} {
		if err := requireResourceFile(path); err != nil {
			return resourceLayout{}, err
		}
	}
	// frontendDist is embedded by mygo build, so no source directory is needed.
	return layout, nil
}
