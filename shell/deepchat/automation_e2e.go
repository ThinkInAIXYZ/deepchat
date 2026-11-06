//go:build e2e

package main

// The official automation plugin is limited to explicit e2e builds. It only
// listens when MYGO_AUTOMATION names a socket; the normal app opens neither a
// socket nor a remote debugging port.
import _ "github.com/egoist/mygo/plugins/automation"
