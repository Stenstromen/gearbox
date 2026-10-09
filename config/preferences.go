//go:build darwin

package config

import "strings"

const (
	defaultRefreshSeconds = 5
	maxRefreshSeconds     = 3600
	defaultSort           = "name"
)

// Preferences are the client settings stored on disk.
// The password is kept in the macOS Keychain, not in this struct.
type Preferences struct {
	URL            string `json:"url"`
	Username       string `json:"username"`
	RefreshSeconds int    `json:"refreshSeconds"`
	Sort           string `json:"sort"`
}

// DefaultPreferences is used for a new install and for missing fields.
func DefaultPreferences() Preferences {
	return Preferences{RefreshSeconds: defaultRefreshSeconds, Sort: defaultSort}
}

// Normalize trims text fields and keeps the refresh interval and sort in range.
func (p Preferences) Normalize() Preferences {
	p.URL = strings.TrimSpace(p.URL)
	p.Username = strings.TrimSpace(p.Username)
	if p.RefreshSeconds < 1 {
		p.RefreshSeconds = defaultRefreshSeconds
	}
	if p.RefreshSeconds > maxRefreshSeconds {
		p.RefreshSeconds = maxRefreshSeconds
	}
	p.Sort = strings.TrimSpace(p.Sort)
	if !ValidSort(p.Sort) {
		p.Sort = defaultSort
	}
	return p
}

// ValidSort reports whether sort is one of the torrent list orders.
// The keys match frontend/src/sort.ts.
func ValidSort(sort string) bool {
	switch sort {
	case "name", "size", "progress", "peers", "download", "upload", "ratio", "status":
		return true
	default:
		return false
	}
}
