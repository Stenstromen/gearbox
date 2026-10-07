//go:build darwin

package config

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"
)

const fileVersion = 1

// Store persists preferences as JSON under the user config directory.
type Store struct {
	path string
	mu   sync.Mutex
}

type document struct {
	Version     int          `json:"version"`
	Preferences *Preferences `json:"preferences"`
}

// DefaultPath is ~/Library/Application Support/Gearbox/preferences.json.
// GEARBOX_CONFIG overrides it.
func DefaultPath() (string, error) {
	if path := strings.TrimSpace(os.Getenv("GEARBOX_CONFIG")); path != "" {
		return path, nil
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	dir := filepath.Join(home, "Library", "Application Support", "Gearbox")
	return filepath.Join(dir, "preferences.json"), nil
}

// Open creates the config directory and an empty file when needed.
func Open(path string) (*Store, error) {
	if path == "" {
		var err error
		path, err = DefaultPath()
		if err != nil {
			return nil, err
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return nil, err
	}
	store := &Store{path: path}
	if _, err := os.Stat(path); os.IsNotExist(err) {
		if err := store.Save(DefaultPreferences()); err != nil {
			return nil, err
		}
	}
	return store, nil
}

// Preferences returns the saved settings, or the defaults when none exist.
func (s *Store) Preferences() (Preferences, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.loadLocked()
}

func (s *Store) loadLocked() (Preferences, error) {
	raw, err := os.ReadFile(s.path)
	if err != nil {
		return Preferences{}, err
	}
	var doc document
	if err := json.Unmarshal(raw, &doc); err != nil {
		return Preferences{}, fmt.Errorf("parse config: %w", err)
	}
	if doc.Preferences == nil {
		return DefaultPreferences(), nil
	}
	return doc.Preferences.Normalize(), nil
}

// Save writes preferences atomically. The password is never included.
func (s *Store) Save(prefs Preferences) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.saveLocked(prefs.Normalize())
}

func (s *Store) saveLocked(prefs Preferences) error {
	raw, err := json.MarshalIndent(document{Version: fileVersion, Preferences: &prefs}, "", "  ")
	if err != nil {
		return err
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, append(raw, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, s.path)
}
