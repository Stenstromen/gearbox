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
	if prefs.RefreshSeconds != 5 || prefs.URL != "" || prefs.Sort != "name" || !prefs.CheckUpdates || !prefs.NotifyOnFinish {
		t.Fatalf("defaults = %+v", prefs)
	}
	if err := store.Save(Preferences{URL: " http://127.0.0.1:9091 ", Username: " transmission ", RefreshSeconds: 0, Sort: " ratio "}); err != nil {
		t.Fatal(err)
	}
	prefs, err = store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.URL != "http://127.0.0.1:9091" || prefs.Username != "transmission" || prefs.RefreshSeconds != 5 || prefs.Sort != "ratio" || prefs.CheckUpdates {
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
	reversed := (Preferences{Sort: "-ratio"}).Normalize()
	if reversed.Sort != "-ratio" {
		t.Fatalf("sort = %q", reversed.Sort)
	}
	if (Preferences{Sort: "-"}).Normalize().Sort != "name" {
		t.Fatal("expected a bare reverse mark to be rejected")
	}
	if !(Preferences{CheckUpdates: true}).Normalize().CheckUpdates {
		t.Fatal("normalize cleared the version check")
	}
}

func TestVersionCheckDefaultsOn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	raw := []byte("{\n  \"version\": 1,\n  \"preferences\": {\n    \"url\": \"http://127.0.0.1:9091\",\n    \"refreshSeconds\": 5,\n    \"sort\": \"name\"\n  }\n}\n")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	prefs, err := store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	if !prefs.CheckUpdates || prefs.URL != "http://127.0.0.1:9091" {
		t.Fatalf("missing field = %+v", prefs)
	}
	prefs.CheckUpdates = false
	if err := store.Save(prefs); err != nil {
		t.Fatal(err)
	}
	prefs, err = store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.CheckUpdates || prefs.URL != "http://127.0.0.1:9091" || prefs.Sort != "name" {
		t.Fatalf("disabled = %+v", prefs)
	}
}

func TestNotifyOnFinishDefaultsOn(t *testing.T) {
	path := filepath.Join(t.TempDir(), "preferences.json")
	raw := []byte("{\n  \"version\": 1,\n  \"preferences\": {\n    \"url\": \"http://127.0.0.1:9091\",\n    \"refreshSeconds\": 5,\n    \"sort\": \"name\"\n  }\n}\n")
	if err := os.WriteFile(path, raw, 0o600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	prefs, err := store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	if !prefs.NotifyOnFinish || prefs.URL != "http://127.0.0.1:9091" {
		t.Fatalf("missing field = %+v", prefs)
	}
	prefs.NotifyOnFinish = false
	if err := store.Save(prefs); err != nil {
		t.Fatal(err)
	}
	prefs, err = store.Preferences()
	if err != nil {
		t.Fatal(err)
	}
	if prefs.NotifyOnFinish || prefs.URL != "http://127.0.0.1:9091" || prefs.Sort != "name" {
		t.Fatalf("disabled = %+v", prefs)
	}
}
