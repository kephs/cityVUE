export function formatDate(date) {
    return new Date(date).toLocaleDateString();
}

export function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}