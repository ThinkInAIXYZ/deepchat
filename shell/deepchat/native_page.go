package main

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"sort"

	"github.com/egoist/mygo"
)

const maxNativePageID = uint64(1<<53 - 1)

type nativePageBounds struct {
	X      int `json:"x"`
	Y      int `json:"y"`
	Width  int `json:"width"`
	Height int `json:"height"`
}

type nativePageRecord struct {
	id         uint64
	window     *mygo.Window
	view       *mygo.WebView
	page       *mygo.Page
	navigation *nativeDocumentNavigation
	bounds     nativePageBounds
	attached   bool
	visible    bool
	z          uint64
}

type nativePageState struct {
	PageID      uint64           `json:"pageId"`
	WindowID    int              `json:"windowId"`
	DocumentURL string           `json:"documentUrl"`
	Bounds      nativePageBounds `json:"bounds"`
	Attached    bool             `json:"attached"`
	Visible     bool             `json:"visible"`
	Z           uint64           `json:"z"`
}

type nativePagePlacement struct {
	view   *mygo.WebView
	bounds nativePageBounds
	z      uint64
}

func nativePageStateOf(record nativePageRecord) nativePageState {
	return nativePageState{
		PageID: record.id, WindowID: record.window.ID(), DocumentURL: record.page.URL(),
		Bounds: record.bounds, Attached: record.attached, Visible: record.visible, Z: record.z,
	}
}

func (b *Bridge) nestedPage(id uint64) (nativePageRecord, error) {
	b.mu.RLock()
	record, ok := b.pages[id]
	b.mu.RUnlock()
	if id == 0 || !ok || record.window == nil || record.window.IsDestroyed() ||
		record.view == nil || record.view.IsDestroyed() || record.page == nil {
		return nativePageRecord{}, errors.New("nested page is not registered or is destroyed")
	}
	return record, nil
}

func (b *Bridge) nestedPageByPointer(page *mygo.Page) (nativePageRecord, bool) {
	b.mu.RLock()
	defer b.mu.RUnlock()
	for _, record := range b.pages {
		if record.page == page && record.window != nil && !record.window.IsDestroyed() &&
			record.view != nil && !record.view.IsDestroyed() {
			return record, true
		}
	}
	return nativePageRecord{}, false
}

func (b *Bridge) nestedPagePlacements(windowID int) []nativePagePlacement {
	b.mu.RLock()
	placements := make([]nativePagePlacement, 0, len(b.pages))
	for _, record := range b.pages {
		if record.window == nil || record.window.ID() != windowID || record.window.IsDestroyed() ||
			record.view == nil || record.view.IsDestroyed() || !record.attached || !record.visible ||
			record.bounds.Width <= 0 || record.bounds.Height <= 0 {
			continue
		}
		placements = append(placements, nativePagePlacement{view: record.view, bounds: record.bounds, z: record.z})
	}
	b.mu.RUnlock()
	sort.Slice(placements, func(i, j int) bool { return placements[i].z < placements[j].z })
	return placements
}

func (b *Bridge) ensureNestedPage(windowID int) (nativePageState, error) {
	window, err := b.nativeWindow(windowID)
	if err != nil {
		return nativePageState{}, err
	}
	b.mu.RLock()
	registered := b.windows[windowID]
	b.mu.RUnlock()
	if registered.role != nativeWindowMain || registered.page == nil || registered.page.WebView() == nil {
		return nativePageState{}, errors.New("nested pages require a registered native Content main window")
	}
	b.mu.Lock()
	if b.nextPageID >= maxNativePageID {
		b.mu.Unlock()
		return nativePageState{}, errors.New("nested page identifier space is exhausted")
	}
	b.nextPageID++
	id := b.nextPageID
	b.mu.Unlock()

	view, err := window.NewWebView(mygo.WebViewOptions{
		URL:  "about:blank",
		Page: mygo.PageOptions{PreloadScript: b.preload},
	})
	if err != nil {
		return nativePageState{}, fmt.Errorf("create nested page: %w", err)
	}
	record := nativePageRecord{
		id: id, window: window, view: view, page: view.Page(),
		navigation: &nativeDocumentNavigation{}, visible: true,
	}
	record.page.SetPermissionHandler(func(request mygo.PermissionRequest) bool {
		return isNativePermissionOriginAllowed(request.Origin)
	})
	record.page.OnDidNavigate(record.navigation.commit)
	b.mu.Lock()
	if b.pages == nil {
		b.pages = map[uint64]nativePageRecord{}
	}
	b.pages[id] = record
	b.mu.Unlock()
	window.Invalidate()
	return nativePageStateOf(record), nil
}

func isNativeNestedDocumentURL(rawURL string) bool {
	parsed, err := url.Parse(rawURL)
	if err != nil || parsed.User != nil {
		return false
	}
	switch parsed.Scheme {
	case "mygo":
		return isRendererDocument(nativeWindowMain, rawURL)
	case "http", "https":
		return parsed.Host != ""
	default:
		return false
	}
}

func isNativeNestedBusinessDocument(rawURL string) bool {
	return isRendererDocument(nativeWindowMain, rawURL)
}

func (b *Bridge) loadNestedPage(ctx context.Context, id uint64, rawURL string) (nativePageState, error) {
	if !isNativeNestedDocumentURL(rawURL) {
		return nativePageState{}, errors.New("nested page document is not allowed")
	}
	record, err := b.nestedPage(id)
	if err != nil {
		return nativePageState{}, err
	}
	if err := b.loadNativePageDocument(ctx, record.page, rawURL, record.navigation); err != nil {
		return nativePageState{}, err
	}
	return nativePageStateOf(record), nil
}

func (b *Bridge) attachNestedPage(id uint64, attached bool) (nativePageState, error) {
	record, err := b.nestedPage(id)
	if err != nil {
		return nativePageState{}, err
	}
	if attached && record.z == 0 {
		b.mu.Lock()
		b.nextPageZ++
		record.z = b.nextPageZ
		b.mu.Unlock()
	}
	record.attached = attached
	b.mu.Lock()
	b.pages[id] = record
	b.mu.Unlock()
	record.window.Invalidate()
	return nativePageStateOf(record), nil
}

func (b *Bridge) setNestedPageBounds(id uint64, bounds nativePageBounds) (nativePageState, error) {
	if bounds.Width < 0 || bounds.Width > 32768 || bounds.Height < 0 || bounds.Height > 32768 ||
		bounds.X < -32768 || bounds.X > 32768 || bounds.Y < -32768 || bounds.Y > 32768 {
		return nativePageState{}, errors.New("invalid nested page bounds")
	}
	record, err := b.nestedPage(id)
	if err != nil {
		return nativePageState{}, err
	}
	record.bounds = bounds
	b.mu.Lock()
	b.pages[id] = record
	b.mu.Unlock()
	record.window.Invalidate()
	return nativePageStateOf(record), nil
}

func (b *Bridge) setNestedPageVisibility(id uint64, visible bool) (nativePageState, error) {
	record, err := b.nestedPage(id)
	if err != nil {
		return nativePageState{}, err
	}
	record.visible = visible
	b.mu.Lock()
	b.pages[id] = record
	b.mu.Unlock()
	record.window.Invalidate()
	return nativePageStateOf(record), nil
}

func (b *Bridge) focusNestedPage(id uint64) (nativePageState, error) {
	record, err := b.nestedPage(id)
	if err != nil {
		return nativePageState{}, err
	}
	if !record.attached || !record.visible {
		return nativePageState{}, errors.New("nested page must be attached and visible to receive focus")
	}
	record.view.Focus()
	return nativePageStateOf(record), nil
}

func (b *Bridge) closeNestedPage(id uint64) error {
	record, err := b.nestedPage(id)
	if err != nil {
		return err
	}
	b.mu.Lock()
	delete(b.pages, id)
	b.mu.Unlock()
	record.view.Destroy()
	record.window.Invalidate()
	return nil
}

func (b *Bridge) removeNestedPagesForWindow(window *mygo.Window) {
	if window == nil {
		return
	}
	b.mu.Lock()
	for id, record := range b.pages {
		if record.window == window {
			delete(b.pages, id)
		}
	}
	b.mu.Unlock()
}

func (b *Bridge) resetNestedPages() {
	b.mu.RLock()
	records := make([]nativePageRecord, 0, len(b.pages))
	for _, record := range b.pages {
		records = append(records, record)
	}
	b.mu.RUnlock()
	sort.Slice(records, func(i, j int) bool { return records[i].id < records[j].id })
	b.mu.Lock()
	clear(b.pages)
	b.mu.Unlock()
	windows := map[int]*mygo.Window{}
	for _, record := range records {
		if record.view != nil && !record.view.IsDestroyed() {
			record.view.Destroy()
		}
		if record.window != nil && !record.window.IsDestroyed() {
			windows[record.window.ID()] = record.window
		}
	}
	for _, window := range windows {
		window.Invalidate()
	}
}
