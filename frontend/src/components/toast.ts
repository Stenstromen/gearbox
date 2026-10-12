export type ToastTone = "pending" | "success";

export type ToastControls = {
    show(title: string, detail: string, tone: ToastTone): void;
    hide(): void;
};

export function mountToast(): ToastControls {
    const host = document.createElement("div");
    host.className = "toast-host";
    const toast = document.createElement("div");
    toast.className = "toast";
    toast.hidden = true;
    toast.setAttribute("role", "status");
    toast.setAttribute("aria-live", "polite");
    toast.setAttribute("aria-atomic", "true");
    const mark = document.createElement("span");
    mark.className = "toast-mark";
    mark.setAttribute("aria-hidden", "true");
    const text = document.createElement("div");
    text.className = "toast-text";
    const title = document.createElement("p");
    title.className = "toast-title";
    const detail = document.createElement("p");
    detail.className = "toast-detail";
    detail.hidden = true;
    text.append(title, detail);
    toast.append(mark, text);
    host.append(toast);
    document.body.append(host);

    let hideTimer = 0;
    toast.addEventListener("animationend", () => {
        toast.classList.remove("is-fresh");
    });

    return {
        show(titleText, detailText, tone) {
            window.clearTimeout(hideTimer);
            const appear = toast.hidden;
            toast.dataset.tone = tone;
            title.textContent = titleText;
            detail.textContent = detailText;
            detail.hidden = detailText === "";
            toast.hidden = false;
            if (appear) {
                toast.classList.remove("is-fresh");
                void toast.offsetWidth;
                toast.classList.add("is-fresh");
            }
            if (tone === "success") {
                hideTimer = window.setTimeout(() => {
                    toast.hidden = true;
                }, 2800);
            }
        },
        hide() {
            window.clearTimeout(hideTimer);
            toast.hidden = true;
            toast.classList.remove("is-fresh");
        },
    };
}
