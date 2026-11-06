package main

import "testing"

func TestNativeNestedDocumentRules(t *testing.T) {
	tests := []struct {
		name     string
		rawURL   string
		load     bool
		business bool
	}{
		{name: "local root", rawURL: "mygo://localhost/", load: true, business: true},
		{name: "local index hash", rawURL: "mygo://localhost/index.html#/chat", load: true, business: true},
		{name: "external https", rawURL: "https://example.com/path", load: true},
		{name: "external http", rawURL: "http://example.com/", load: true},
		{name: "external credentials", rawURL: "https://user@example.com/"},
		{name: "settings document", rawURL: "mygo://localhost/settings/index.html"},
		{name: "file document", rawURL: "file:///tmp/index.html"},
		{name: "data document", rawURL: "data:text/html,hello"},
		{name: "mcp app document", rawURL: "mcp-app://instance/sandbox.html"},
		{name: "malformed", rawURL: "://bad-url"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isNativeNestedDocumentURL(test.rawURL); got != test.load {
				t.Fatalf("isNativeNestedDocumentURL(%q) = %t, want %t", test.rawURL, got, test.load)
			}
			if got := isNativeNestedBusinessDocument(test.rawURL); got != test.business {
				t.Fatalf("isNativeNestedBusinessDocument(%q) = %t, want %t", test.rawURL, got, test.business)
			}
		})
	}
}
