export default class MemoryStorage {
    constructor(initialValues = {}) {
        this.values = new Map(Object.entries(initialValues));
        this.getError = null;
        this.setError = null;
        this.removeError = null;
    }

    getItem(key) {
        if (this.getError) {
            throw this.getError;
        }

        return this.values.has(key) ? this.values.get(key) : null;
    }

    setItem(key, value) {
        if (this.setError) {
            throw this.setError;
        }

        this.values.set(key, String(value));
    }

    removeItem(key) {
        if (this.removeError) {
            throw this.removeError;
        }

        this.values.delete(key);
    }
}
