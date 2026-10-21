import {TransmissionService, type NotificationPermission} from "../../bindings/github.com/stenstromen/gearbox";

export type PreferencesPanel = {
    element: HTMLElement;
    open: () => void;
    close: () => void;
};

export function createPreferencesPanel(onClose: () => void, onSaved: (refreshSeconds: number) => void): PreferencesPanel {
    const page = document.createElement("section");
    page.className = "preferences";
    page.hidden = true;
    page.setAttribute("aria-label", "Preferences");

    const title = document.createElement("h2");
    title.textContent = "Preferences";

    const form = document.createElement("form");
    form.className = "preferences-form";
    form.noValidate = true;

    const urlInput = textField("Transmission URL", "Transmission URL", "http://127.0.0.1:9091");
    const usernameInput = textField("Username", "Username", "");
    const passwordInput = textField("Password", "Password", "");
    passwordInput.input.type = "password";
    passwordInput.input.autocomplete = "new-password";
    const passwordHint = document.createElement("p");
    passwordHint.className = "preferences-hint";
    passwordHint.textContent = "Stored in the macOS Keychain. Leave blank to keep the saved password.";

    const clearLabel = document.createElement("label");
    clearLabel.className = "preferences-check";
    clearLabel.hidden = true;
    const clearInput = document.createElement("input");
    clearInput.type = "checkbox";
    const clearText = document.createElement("span");
    clearText.textContent = "Remove saved password";
    clearLabel.append(clearInput, clearText);

    const refreshInput = textField("Refresh rate (seconds)", "Refresh rate in seconds", "5");
    refreshInput.input.type = "number";
    refreshInput.input.min = "1";
    refreshInput.input.max = "3600";
    refreshInput.input.step = "1";

    const updateLabel = document.createElement("label");
    updateLabel.className = "preferences-check";
    const updateInput = document.createElement("input");
    updateInput.type = "checkbox";
    updateInput.checked = true;
    const updateText = document.createElement("span");
    updateText.textContent = "Check for new versions";
    updateLabel.append(updateInput, updateText);

    const notifyLabel = document.createElement("label");
    notifyLabel.className = "preferences-check";
    const notifyInput = document.createElement("input");
    notifyInput.type = "checkbox";
    notifyInput.checked = true;
    const notifyText = document.createElement("span");
    notifyText.textContent = "Send a notification when a download finishes";
    notifyLabel.append(notifyInput, notifyText);

    const permission = document.createElement("div");
    permission.className = "preferences-permission";
    const permissionRow = document.createElement("div");
    permissionRow.className = "preferences-permission-row";
    const permissionCopy = document.createElement("div");
    permissionCopy.className = "preferences-permission-copy";
    const permissionTitle = document.createElement("div");
    permissionTitle.className = "preferences-permission-title";
    permissionTitle.textContent = "System permission";
    const permissionDesc = document.createElement("p");
    permissionDesc.className = "preferences-note";
    permissionDesc.textContent = "macOS must allow Gearbox to show notifications when a download finishes.";
    permissionCopy.append(permissionTitle, permissionDesc);
    const permissionBadge = document.createElement("span");
    permissionBadge.className = "preferences-badge is-warn";
    permissionBadge.textContent = "Checking…";
    permissionRow.append(permissionCopy, permissionBadge);

    const permissionMessage = document.createElement("p");
    permissionMessage.className = "preferences-note";
    permissionMessage.hidden = true;

    const permissionActions = document.createElement("div");
    permissionActions.className = "preferences-actions";
    const enableButton = document.createElement("button");
    enableButton.type = "button";
    enableButton.className = "modal-button modal-primary";
    enableButton.textContent = "Enable Notifications…";
    enableButton.disabled = true;
    const testButton = document.createElement("button");
    testButton.type = "button";
    testButton.className = "modal-button";
    testButton.textContent = "Send Test Notification";
    testButton.disabled = true;
    const refreshPermButton = document.createElement("button");
    refreshPermButton.type = "button";
    refreshPermButton.className = "modal-button";
    refreshPermButton.textContent = "Refresh Status";
    permissionActions.append(enableButton, testButton, refreshPermButton);

    const permissionFlash = document.createElement("p");
    permissionFlash.className = "preferences-flash";
    permissionFlash.hidden = true;

    const permissionHint = document.createElement("p");
    permissionHint.className = "preferences-note";
    permissionHint.textContent = "If the system dialog doesn’t appear, open System Settings → Notifications → Gearbox and turn alerts on.";
    permission.append(permissionRow, permissionMessage, permissionActions, permissionFlash, permissionHint);

    let permissionState: NotificationPermission | null = null;
    let permissionBusy = false;

    const showPermissionFlash = (message: string, warn = false) => {
        permissionFlash.hidden = false;
        permissionFlash.textContent = message;
        permissionFlash.classList.toggle("is-warn", warn);
    };

    const renderPermission = () => {
        const authorized = permissionState?.authorized === true;
        permissionBadge.textContent = permissionState == null ? "Checking…" : authorized ? "Allowed" : "Not allowed";
        permissionBadge.className = `preferences-badge${authorized ? " is-ok" : " is-warn"}`;
        permissionMessage.hidden = !permissionState?.message;
        permissionMessage.textContent = permissionState?.message ?? "";
        enableButton.hidden = authorized;
        enableButton.disabled = permissionBusy || permissionState?.available !== true;
        testButton.disabled = permissionBusy || !authorized;
        refreshPermButton.disabled = permissionBusy;
    };

    const loadPermission = () => {
        permissionBusy = true;
        renderPermission();
        void TransmissionService.GetNotificationPermission().then((next) => {
            permissionState = next;
        }).catch((err: unknown) => {
            permissionState = {authorized: false, available: false, message: messageOf(err)};
        }).finally(() => {
            permissionBusy = false;
            renderPermission();
        });
    };

    const error = document.createElement("p");
    error.className = "modal-error";
    error.hidden = true;

    const actions = document.createElement("div");
    actions.className = "preferences-actions";
    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "modal-button";
    closeButton.textContent = "Close";
    const saveButton = document.createElement("button");
    saveButton.type = "submit";
    saveButton.className = "modal-button modal-primary";
    saveButton.textContent = "Save";
    actions.append(closeButton, saveButton);

    form.append(
        urlInput.label,
        usernameInput.label,
        passwordInput.label,
        passwordHint,
        clearLabel,
        refreshInput.label,
        updateLabel,
        notifyLabel,
        permission,
        error,
        actions,
    );
    page.append(title, form);

    const showError = (message: string) => {
        error.hidden = false;
        error.textContent = message;
    };

    const close = () => {
        if (page.hidden) {
            return;
        }
        page.hidden = true;
        onClose();
    };

    const open = () => {
        page.hidden = false;
        error.hidden = true;
        passwordInput.input.value = "";
        clearInput.checked = false;
        notifyInput.checked = true;
        permissionFlash.hidden = true;
        saveButton.disabled = false;
        saveButton.textContent = "Save";
        loadPermission();
        void TransmissionService.GetSettings().then((settings) => {
            if (page.hidden) {
                return;
            }
            urlInput.input.value = settings?.url ?? "";
            usernameInput.input.value = settings?.username ?? "";
            refreshInput.input.value = String(settings?.refreshSeconds || 5);
            updateInput.checked = settings?.checkUpdates !== false;
            notifyInput.checked = settings?.notifyOnFinish !== false;
            clearLabel.hidden = !settings?.hasPassword;
        }).catch((err: unknown) => {
            if (!page.hidden) {
                showError(messageOf(err));
            }
        });
        urlInput.input.focus();
    };

    enableButton.addEventListener("click", () => {
        permissionBusy = true;
        permissionFlash.hidden = true;
        renderPermission();
        void TransmissionService.RequestNotificationPermission().then((next) => {
            permissionState = next;
            if (next.authorized) {
                showPermissionFlash("Permission granted.");
            }
        }).catch((err: unknown) => {
            showPermissionFlash(messageOf(err), true);
            return TransmissionService.GetNotificationPermission().then((next) => {
                permissionState = next;
            }).catch((loadErr: unknown) => {
                permissionState = {authorized: false, available: false, message: messageOf(loadErr)};
            });
        }).finally(() => {
            permissionBusy = false;
            renderPermission();
        });
    });
    testButton.addEventListener("click", () => {
        permissionBusy = true;
        permissionFlash.hidden = true;
        renderPermission();
        void TransmissionService.SendTestNotification().then(() => {
            showPermissionFlash("Test notification sent.");
        }).catch((err: unknown) => {
            showPermissionFlash(messageOf(err), true);
            return TransmissionService.GetNotificationPermission().then((next) => {
                permissionState = next;
            }).catch((loadErr: unknown) => {
                permissionState = {authorized: false, available: false, message: messageOf(loadErr)};
            });
        }).finally(() => {
            permissionBusy = false;
            renderPermission();
        });
    });
    refreshPermButton.addEventListener("click", () => {
        permissionFlash.hidden = true;
        loadPermission();
    });

    closeButton.addEventListener("click", close);
    form.addEventListener("submit", (event) => {
        event.preventDefault();
        const url = urlInput.input.value.trim();
        if (url === "") {
            showError("Transmission URL is required.");
            return;
        }
        const refreshSeconds = Number(refreshInput.input.value);
        if (!Number.isInteger(refreshSeconds) || refreshSeconds < 1 || refreshSeconds > 3600) {
            showError("Refresh rate must be between 1 and 3600 seconds.");
            return;
        }
        error.hidden = true;
        saveButton.disabled = true;
        saveButton.textContent = "Saving…";
        void TransmissionService.SaveSettings({
            url,
            username: usernameInput.input.value.trim(),
            password: passwordInput.input.value,
            clearPassword: clearInput.checked,
            refreshSeconds,
            checkUpdates: updateInput.checked,
            notifyOnFinish: notifyInput.checked,
        }).then(() => {
            passwordInput.input.value = "";
            page.hidden = true;
            onSaved(refreshSeconds);
        }).catch((err: unknown) => {
            saveButton.disabled = false;
            saveButton.textContent = "Save";
            showError(messageOf(err));
        });
    });

    return {element: page, open, close};
}

function textField(caption: string, ariaLabel: string, placeholder: string): {label: HTMLLabelElement; input: HTMLInputElement} {
    const label = document.createElement("label");
    const text = document.createElement("span");
    text.textContent = caption;
    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = placeholder;
    input.setAttribute("aria-label", ariaLabel);
    input.autocomplete = "off";
    input.spellcheck = false;
    label.append(text, input);
    return {label, input};
}

function messageOf(err: unknown): string {
    if (err instanceof Error && err.message) {
        return err.message;
    }
    if (typeof err === "string" && err) {
        return err;
    }
    if (err && typeof err === "object" && "message" in err && typeof err.message === "string" && err.message) {
        return err.message;
    }
    return "Could not save preferences";
}
