import {TransmissionService} from "../../bindings/github.com/stenstromen/gearbox";

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
        saveButton.disabled = false;
        saveButton.textContent = "Save";
        void TransmissionService.GetSettings().then((settings) => {
            if (page.hidden) {
                return;
            }
            urlInput.input.value = settings?.url ?? "";
            usernameInput.input.value = settings?.username ?? "";
            refreshInput.input.value = String(settings?.refreshSeconds || 5);
            clearLabel.hidden = !settings?.hasPassword;
        }).catch((err: unknown) => {
            if (!page.hidden) {
                showError(messageOf(err));
            }
        });
        urlInput.input.focus();
    };

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
