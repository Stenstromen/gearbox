export type ToastTone = "pending" | "success";

export type ToastControls = {
    show(title: string, detail: string, tone: ToastTone, href?: string): void;
    hide(): void;
};

export function mountToast(openLink: (href: string) => void | Promise<void> = () => undefined): ToastControls {
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
    const link = document.createElement("button");
    link.type = "button";
    link.className = "toast-link";
    link.hidden = true;
    const detail = document.createElement("p");
    detail.className = "toast-detail";
    detail.hidden = true;
    text.append(title, link, detail);
    toast.append(mark, text);
    host.append(toast);
    document.body.append(host);

    let hideTimer = 0;
    toast.addEventListener("animationend", () => {
        toast.classList.remove("is-fresh");
    });

    const hide = () => {
        window.clearTimeout(hideTimer);
        toast.hidden = true;
        toast.classList.remove("is-fresh", "is-link");
        link.hidden = true;
        delete link.dataset.href;
        title.hidden = false;
    };

    toast.addEventListener("click", () => {
        const href = link.dataset.href ?? "";
        if (href === "" || link.hidden) {
            return;
        }
        void Promise.resolve(openLink(href)).then(() => {
            if ((link.dataset.href ?? "") === href) {
                hide();
            }
        }, () => undefined);
    });

    return {
        show(titleText, detailText, tone, href = "") {
            window.clearTimeout(hideTimer);
            const appear = toast.hidden;
            toast.dataset.tone = tone;
            detail.textContent = detailText;
            detail.hidden = detailText === "";
            toast.classList.toggle("is-link", href !== "");
            if (href !== "") {
                title.hidden = true;
                link.hidden = false;
                link.textContent = titleText;
                link.dataset.href = href;
            } else {
                link.hidden = true;
                delete link.dataset.href;
                title.hidden = false;
                title.textContent = titleText;
            }
            toast.hidden = false;
            if (appear) {
                toast.classList.remove("is-fresh");
                void toast.offsetWidth;
                toast.classList.add("is-fresh");
            }
            if (tone === "success" && href === "") {
                hideTimer = window.setTimeout(() => {
                    hide();
                }, 2800);
            }
        },
        hide,
    };
}
