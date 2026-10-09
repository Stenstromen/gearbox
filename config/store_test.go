//go:build darwin

package config

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestStoreRoundTrip(t *testing.T) {
	path := filepath.Join(t.TempDir(), "Gearbox", "preferences.json")
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("mode = %o", info.Mode().Perm())
	}
	prefs, err := store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.RefreshSeconds != 5 || prefs.URL != "" || prefs.Sort != "name" {
		t.Fatalf("defaults = %+v", prefs)
	}
	if err := store.Save(Preferences{URL: " http://127.0.0.1:9091 ", Username: " transmission ", RefreshSeconds: 0, Sort: " ratio "}); err != nil {
		t.Fatal(err)
	}
	prefs, err = store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.URL != "http://127.0.0.1:9091" || prefs.Username != "transmission" || prefs.RefreshSeconds != 5 || prefs.Sort != "ratio" {
		t.Fatalf("saved = %+v", prefs)
	}
	raw, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), "password") {
		t.Fatalf("config contains a password field: %s", raw)
	}
}

func TestNormalizeRefreshLimits(t *testing.T) {
	slow := (Preferences{RefreshSeconds: 99999}).Normalize()
	if slow.RefreshSeconds != 3600 {
		t.Fatalf("refresh = %d", slow.RefreshSeconds)
	}
	if slow.Sort != "name" {
		t.Fatalf("sort = %q", slow.Sort)
	}
	unknown := (Preferences{Sort: "nope"}).Normalize()
	if unknown.Sort != "name" {
		t.Fatalf("sort = %q", unknown.Sort)
	}
}
