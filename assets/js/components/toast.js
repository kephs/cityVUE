let toastElement;
let toastBody;
let toast;

export function initializeToast() {

    toastElement = document.querySelector("#appToast");

    toastBody = document.querySelector("#toastMessage");

    if (!toastElement) return;

    toast = new bootstrap.Toast(toastElement);

}

export function showToast(message, type = "success") {

    if (!toast) return;

    toastBody.textContent = message;

    toastElement.classList.remove(
        "text-bg-success",
        "text-bg-danger",
        "text-bg-warning",
        "text-bg-info"
    );

    switch (type) {

        case "danger":
            toastElement.classList.add("text-bg-danger");
            break;

        case "warning":
            toastElement.classList.add("text-bg-warning");
            break;

        case "info":
            toastElement.classList.add("text-bg-info");
            break;

        default:
            toastElement.classList.add("text-bg-success");

    }

    toast.show();

}