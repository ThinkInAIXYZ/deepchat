package main

import (
	"io/fs"
	"net/http"
	"strings"

	"github.com/egoist/mygo"
)

// rendererProtocol resolves existing index documents without FileServer's
// relative "./" redirect. WebKit does not follow that redirect for a
// top-level custom-scheme navigation, leaving an empty document at the URL.
func rendererProtocol(frontend fs.FS) http.Handler {
	files := mygo.FileServer(frontend)
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, "/index.html") {
			name := strings.TrimPrefix(r.URL.Path, "/")
			if info, err := fs.Stat(frontend, name); err == nil && !info.IsDir() {
				r = r.Clone(r.Context())
				url := *r.URL
				r.URL = &url
				r.URL.Path = strings.TrimSuffix(r.URL.Path, "index.html")
				// RawPath must not retain the escaped form of the old path.
				r.URL.RawPath = ""
			}
		}
		files.ServeHTTP(w, r)
	})
}
