//go:build !e2e

package main

import "github.com/egoist/mygo"

func configurePrimaryAutomation(func() *mygo.Page) error {
	return nil
}
