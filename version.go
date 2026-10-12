//go:build darwin

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"encoding/xml"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const (
	githubLatestRelease = "https://api.github.com/repos/stenstromen/gearbox/releases/latest"
	githubReleasesPage  = "https://github.com/stenstromen/gearbox/releases"
)

var (
	updateHTTP     = &http.Client{Timeout: 8 * time.Second}
	readAppVersion = currentVersion
)

// UpdateNotice is a startup version check. Available is false when this
// build is current, or when the check could not be completed.
type UpdateNotice struct {
	Available bool   `json:"available"`
	URL       string `json:"url"`
}

// CheckUpdate compares the running app version with the latest GitHub release.
// When a newer release exists, URL points at the releases page.
func (s *TransmissionService) CheckUpdate() (UpdateNotice, error) {
	if s.store != nil {
		prefs, err := s.store.Preferences()
		if err != nil || !prefs.CheckUpdates {
			return UpdateNotice{}, nil
		}
	}
	current, err := readAppVersion()
	if err != nil || current == "" {
		return UpdateNotice{}, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Second)
	defer cancel()
	return updateNotice(ctx, updateHTTP, githubLatestRelease, current), nil
}

func updateNotice(ctx context.Context, client *http.Client, endpoint, current string) UpdateNotice {
	if _, ok := parseSemver(current); !ok {
		return UpdateNotice{}
	}
	tag, err := latestReleaseTag(ctx, client, endpoint)
	if err != nil || !versionLess(current, tag) {
		return UpdateNotice{}
	}
	return UpdateNotice{Available: true, URL: githubReleasesPage}
}

func latestReleaseTag(ctx context.Context, client *http.Client, endpoint string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("Accept", "application/vnd.github+json")
	req.Header.Set("User-Agent", "gearbox")
	resp, err := client.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	body, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return "", err
	}
	if resp.StatusCode == http.StatusNotFound {
		return "", nil
	}
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("github releases returned %s", resp.Status)
	}
	var payload struct {
		TagName string `json:"tag_name"`
	}
	if err := json.Unmarshal(body, &payload); err != nil {
		return "", err
	}
	return strings.TrimSpace(payload.TagName), nil
}

type semver struct {
	major int
	minor int
	patch int
	pre   string
}

func parseSemver(raw string) (semver, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return semver{}, false
	}
	if raw[0] == 'v' || raw[0] == 'V' {
		raw = raw[1:]
	}
	main, pre, _ := strings.Cut(raw, "-")
	parts := strings.Split(main, ".")
	if len(parts) < 3 {
		return semver{}, false
	}
	if len(parts) > 3 {
		extra := strings.Join(parts[3:], ".")
		if pre != "" {
			pre = extra + "-" + pre
		} else {
			pre = extra
		}
		parts = parts[:3]
	}
	major, err1 := strconv.Atoi(parts[0])
	minor, err2 := strconv.Atoi(parts[1])
	patch, err3 := strconv.Atoi(parts[2])
	if err1 != nil || err2 != nil || err3 != nil || major < 0 || minor < 0 || patch < 0 {
		return semver{}, false
	}
	return semver{major: major, minor: minor, patch: patch, pre: pre}, true
}

func versionLess(current, latest string) bool {
	left, okLeft := parseSemver(current)
	right, okRight := parseSemver(latest)
	if !okLeft || !okRight {
		return false
	}
	if left.major != right.major {
		return left.major < right.major
	}
	if left.minor != right.minor {
		return left.minor < right.minor
	}
	if left.patch != right.patch {
		return left.patch < right.patch
	}
	if left.pre == right.pre {
		return false
	}
	if left.pre == "" {
		return false
	}
	if right.pre == "" {
		return true
	}
	return left.pre < right.pre
}

func currentVersion() (string, error) {
	exe, err := os.Executable()
	if err != nil {
		return "", err
	}
	return versionFromExecutable(exe)
}

func versionFromExecutable(exe string) (string, error) {
	if resolved, err := filepath.EvalSymlinks(exe); err == nil {
		exe = resolved
	}
	data, err := os.ReadFile(filepath.Clean(filepath.Join(filepath.Dir(exe), "..", "Info.plist")))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	return shortVersionString(data)
}

func shortVersionString(data []byte) (string, error) {
	dec := xml.NewDecoder(bytes.NewReader(data))
	wantValue := false
	for {
		tok, err := dec.Token()
		if err == io.EOF {
			return "", nil
		}
		if err != nil {
			return "", err
		}
		start, ok := tok.(xml.StartElement)
		if !ok {
			continue
		}
		switch start.Name.Local {
		case "key":
			var key string
			if err := dec.DecodeElement(&key, &start); err != nil {
				return "", err
			}
			wantValue = key == "CFBundleShortVersionString"
		case "string":
			var value string
			if err := dec.DecodeElement(&value, &start); err != nil {
				return "", err
			}
			if wantValue {
				return strings.TrimSpace(value), nil
			}
		default:
			if !wantValue {
				continue
			}
			if err := dec.Skip(); err != nil {
				return "", err
			}
			wantValue = false
		}
	}
}
