//go:build darwin

package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/stenstromen/gearbox/config"
)

func TestVersionLess(t *testing.T) {
	tests := []struct {
		current string
		latest  string
		want    bool
	}{
		{current: "0.1.0", latest: "v0.2.0", want: true},
		{current: "0.1.0", latest: "v0.1.1", want: true},
		{current: "1.2.3", latest: "v1.3.0", want: true},
		{current: "1.9.0", latest: "v1.10.0", want: true},
		{current: "1.2.3-rc.1", latest: "v1.2.3", want: true},
		{current: "1.2.3-rc.1", latest: "v1.2.3-rc.2", want: true},
		{current: "0.2.0", latest: "v0.2.0", want: false},
		{current: "v1.2.3", latest: "1.2.3", want: false},
		{current: "0.3.0", latest: "v0.2.0", want: false},
		{current: "2.0.0", latest: "v1.9.9", want: false},
		{current: "1.2.3", latest: "v1.2.3-rc.1", want: false},
		{current: "", latest: "v1.0.0", want: false},
		{current: "dev", latest: "v1.0.0", want: false},
		{current: "1.2", latest: "v1.2.0", want: false},
		{current: "0.1.0", latest: "", want: false},
	}
	for _, test := range tests {
		if got := versionLess(test.current, test.latest); got != test.want {
			t.Errorf("versionLess(%q, %q) = %v, want %v", test.current, test.latest, got, test.want)
		}
	}
}

func TestShortVersionString(t *testing.T) {
	got, err := shortVersionString([]byte(samplePlist(" 0.1.0 ")))
	if err != nil {
		t.Fatal(err)
	}
	if got != "0.1.0" {
		t.Fatalf("version = %q", got)
	}
	got, err = shortVersionString([]byte(`<plist><dict><key>CFBundleName</key><string>Gearbox</string></dict></plist>`))
	if err != nil {
		t.Fatal(err)
	}
	if got != "" {
		t.Fatalf("missing key = %q", got)
	}
	if _, err := shortVersionString([]byte("<plist>")); err == nil {
		t.Fatal("expected invalid plist to fail")
	}
	bundled, err := os.ReadFile("build/darwin/Info.plist")
	if err != nil {
		t.Fatal(err)
	}
	got, err = shortVersionString(bundled)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := parseSemver(got); !ok {
		t.Fatalf("Info.plist version = %q", got)
	}
}

func TestVersionFromExecutable(t *testing.T) {
	root := t.TempDir()
	macOS := filepath.Join(root, "Gearbox.app", "Contents", "MacOS")
	if err := os.MkdirAll(macOS, 0o755); err != nil {
		t.Fatal(err)
	}
	plist := filepath.Join(root, "Gearbox.app", "Contents", "Info.plist")
	if err := os.WriteFile(plist, []byte(samplePlist("1.4.0")), 0o644); err != nil {
		t.Fatal(err)
	}
	exe := filepath.Join(macOS, "gearbox")
	if err := os.WriteFile(exe, []byte("bin"), 0o755); err != nil {
		t.Fatal(err)
	}
	got, err := versionFromExecutable(exe)
	if err != nil {
		t.Fatal(err)
	}
	if got != "1.4.0" {
		t.Fatalf("version = %q", got)
	}

	linkDir := t.TempDir()
	link := filepath.Join(linkDir, "gearbox")
	if err := os.Symlink(exe, link); err != nil {
		t.Fatal(err)
	}
	got, err = versionFromExecutable(link)
	if err != nil {
		t.Fatal(err)
	}
	if got != "1.4.0" {
		t.Fatalf("symlink version = %q", got)
	}

	bare := filepath.Join(t.TempDir(), "Contents", "MacOS")
	if err := os.MkdirAll(bare, 0o755); err != nil {
		t.Fatal(err)
	}
	missing, err := versionFromExecutable(filepath.Join(bare, "gearbox"))
	if err != nil {
		t.Fatal(err)
	}
	if missing != "" {
		t.Fatalf("missing bundle = %q", missing)
	}
}

func TestCheckUpdateDisabled(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	store, err := config.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	prefs, err := store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	prefs.CheckUpdates = false
	if err := store.Save(prefs); err != nil {
		t.Fatal(err)
	}
	originalClient := updateHTTP
	originalVersion := readAppVersion
	t.Cleanup(func() {
		updateHTTP = originalClient
		readAppVersion = originalVersion
	})
	readAppVersion = func() (string, error) { return "0.1.0", nil }
	updateHTTP = &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		t.Error("version check ran while disabled")
		return nil, errors.New("unexpected request")
	})}
	notice, err := (&TransmissionService{store: store}).CheckUpdate()
	if err != nil || notice.Available || notice.URL != "" {
		t.Fatalf("disabled = %+v, %v", notice, err)
	}
}

func TestUpdateNotice(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("User-Agent") != "gearbox" {
			t.Errorf("user agent = %q", r.Header.Get("User-Agent"))
		}
		if !strings.Contains(r.Header.Get("Accept"), "application/vnd.github+json") {
			t.Errorf("accept = %q", r.Header.Get("Accept"))
		}
		switch r.URL.Query().Get("case") {
		case "missing":
			w.WriteHeader(http.StatusNotFound)
		case "down":
			w.WriteHeader(http.StatusInternalServerError)
		case "bad":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte("{"))
		default:
			_, _ = w.Write([]byte(`{"tag_name":"v0.2.0","html_url":"https://github.com/stenstromen/gearbox/releases/tag/v0.2.0"}`))
		}
	}))
	t.Cleanup(server.Close)

	notice := func(current, query string) UpdateNotice {
		t.Helper()
		return updateNotice(context.Background(), server.Client(), server.URL+"?"+query, current)
	}
	if got := notice("0.1.0", ""); !got.Available || got.URL != githubReleasesPage {
		t.Fatalf("newer = %+v", got)
	}
	if got := notice("0.2.0", ""); got.Available || got.URL != "" {
		t.Fatalf("current = %+v", got)
	}
	if got := notice("0.3.0", ""); got.Available {
		t.Fatalf("newer local = %+v", got)
	}
	if got := notice("dev", ""); got.Available {
		t.Fatalf("unversioned = %+v", got)
	}
	if got := notice("0.1.0", "case=missing"); got.Available {
		t.Fatalf("no releases = %+v", got)
	}
	if got := notice("0.1.0", "case=down"); got.Available {
		t.Fatalf("server error = %+v", got)
	}
	if got := notice("0.1.0", "case=bad"); got.Available {
		t.Fatalf("bad json = %+v", got)
	}

	offline := &http.Client{Transport: roundTripFunc(func(*http.Request) (*http.Response, error) {
		return nil, errors.New("offline")
	})}
	if got := updateNotice(context.Background(), offline, "https://example.invalid", "0.1.0"); got.Available {
		t.Fatalf("offline = %+v", got)
	}
}

func samplePlist(version string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
<key>CFBundleVersion</key><string>9.9.9</string>
<key>CFBundleShortVersionString</key><string>` + version + `</string>
<key>CFBundleName</key><string>Gearbox</string>
</dict></plist>`
}

type roundTripFunc func(*http.Request) (*http.Response, error)

func (fn roundTripFunc) RoundTrip(req *http.Request) (*http.Response, error) {
	return fn(req)
}
