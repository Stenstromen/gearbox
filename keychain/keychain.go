//go:build darwin

// Package keychain stores the Transmission password in the macOS Keychain.
// Preferences JSON never contains the password.
package keychain

import "github.com/zalando/go-keyring"

const (
	service = "se.stenstromen.gearbox"
	account = "transmission"
)

// Set stores the Transmission password. An empty secret deletes the item.
func Set(secret string) error {
	if secret == "" {
		return Delete()
	}
	return keyring.Set(service, account, secret)
}

// Get returns the stored password. A missing item returns ("", nil).
func Get() (string, error) {
	secret, err := keyring.Get(service, account)
	if err == keyring.ErrNotFound {
		return "", nil
	}
	return secret, err
}

// Delete removes the password. A missing item is ignored.
func Delete() error {
	err := keyring.Delete(service, account)
	if err == keyring.ErrNotFound {
		return nil
	}
	return err
}
