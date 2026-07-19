import { Toast } from "bootstrap";

// ======================================================
// Application State
// ======================================================

let toastInstance = null;

// ======================================================
// Initialize Toast
// ======================================================

export function initializeToast() {

    const toastElement =
        document.querySelector("#appToast");

    if (!toastElement) {

        toastInstance = null;
        return;

    }

    toastInstance = Toast.getOrCreateInstance(
        toastElement,
        {
            animation: true,
            autohide: true,
            delay: 5000
        }
    );

}

// ======================================================
// Show Toast
// ======================================================

export function showToast(
    message,
    variant = "success",
    delay = 5000
) {

    const toastElement =
        document.querySelector("#appToast");

    const toastMessage =
        document.querySelector("#toastMessage");

    if (!toastElement || !toastMessage) {

        console.warn(
            "Toast elements were not found:",
            message
        );

        return;

    }

    toastMessage.textContent = message;

    updateToastVariant(
        toastElement,
        variant
    );

    toastInstance =
        Toast.getOrCreateInstance(
            toastElement,
            {
                animation: true,
                autohide: true,
                delay
            }
        );

    toastInstance.show();

}

// ======================================================
// Update Toast Color
// ======================================================

function updateToastVariant(
    toastElement,
    variant
) {

    const supportedVariants = [
        "primary",
        "secondary",
        "success",
        "danger",
        "warning",
        "info",
        "light",
        "dark"
    ];

    supportedVariants.forEach(item => {

        toastElement.classList.remove(
            `text-bg-${item}`
        );

    });

    const selectedVariant =
        supportedVariants.includes(variant)
            ? variant
            : "success";

    toastElement.classList.add(
        `text-bg-${selectedVariant}`
    );

    const closeButton =
        toastElement.querySelector(".btn-close");

    if (!closeButton) {

        return;

    }

    const requiresWhiteButton = [
        "primary",
        "secondary",
        "success",
        "danger",
        "dark"
    ].includes(selectedVariant);

    closeButton.classList.toggle(
        "btn-close-white",
        requiresWhiteButton
    );

}