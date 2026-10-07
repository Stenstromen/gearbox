//go:build darwin

package config

import "strings"

const (
	defaultRefreshSeconds = 5
	maxRefreshSeconds     = 3600
)

// Preferences are the Transmission connection settings stored on disk.
// The password is kept in the macOS Keychain, not in this struct.
type Preferences struct {
	URL            string `json:"url"`
	Username       string `json:"username"`
	RefreshSeconds int    `json:"refreshSeconds"`
}

// DefaultPreferences is used for a new install and for missing fields.
func DefaultPreferences() Preferences {
	return Preferences{RefreshSeconds: defaultRefreshSeconds}
}

// Normalize trims text fields and keeps the refresh interval in range.
func (p Preferences) Normalize() Preferences {
	p.URL = strings.TrimSpace(p.URL)
	p.Username = strings.TrimSpace(p.Username)
	if p.RefreshSeconds < 1 {
		p.RefreshSeconds = defaultRefreshSeconds
	}
	if p.RefreshSeconds > maxRefreshSeconds {
		p.RefreshSeconds = maxRefreshSeconds
	}
	return p
}
