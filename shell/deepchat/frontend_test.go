package main

import (
	"net/http/httptest"
	"testing"
	"testing/fstest"
)

func TestRendererProtocolPreservesCanonicalIndexURL(t *testing.T) {
	frontend := fstest.MapFS{
		"index.html":          &fstest.MapFile{Data: []byte("<main>main</main>")},
		"settings/index.html": &fstest.MapFile{Data: []byte("<main>settings</main>")},
		"assets/settings.js":  &fstest.MapFile{Data: []byte("export {}")},
	}
	handler := rendererProtocol(frontend)

	for _, test := range []struct {
		path string
		body string
	}{
		{path: "/settings/index.html?tab=general", body: "<main>settings</main>"},
		{path: "/settings/", body: "<main>settings</main>"},
		{path: "/index.html", body: "<main>main</main>"},
		{path: "/assets/settings.js", body: "export {}"},
	} {
		t.Run(test.path, func(t *testing.T) {
			request := httptest.NewRequest("GET", "mygo://localhost"+test.path, nil)
			response := httptest.NewRecorder()
			handler.ServeHTTP(response, request)
			if response.Code != 200 || response.Body.String() != test.body {
				t.Fatalf("response = %d %q, want 200 %q", response.Code, response.Body.String(), test.body)
			}
			if location := response.Header().Get("Location"); location != "" {
				t.Fatalf("unexpected canonical redirect: %q", location)
			}
			if request.URL.RequestURI() != test.path {
				t.Fatalf("handler mutated the request path: %q", request.URL.RequestURI())
			}
		})
	}
}
