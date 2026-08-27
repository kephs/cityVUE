import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";

import IssueService from "../assets/services/IssueService.js";
import MemoryStorage from "./helpers/MemoryStorage.js";

const STORAGE_KEY = "cityvueIssues";
const originalConsoleError = console.error;

let storage;

beforeEach(() => {
    storage = new MemoryStorage();
    globalThis.localStorage = storage;
});

afterEach(() => {
    delete globalThis.localStorage;
    console.error = originalConsoleError;
});

test("getIssues returns an empty collection when storage is empty", () => {
    assert.deepEqual(IssueService.getIssues(), []);
});

test("getIssues returns stored valid issues", () => {
    const storedIssues = [
        { id: "issue-1", title: "Pothole", status: "Open" },
        { id: "issue-2", title: "Streetlight", status: "Closed" }
    ];
    storage.setItem(STORAGE_KEY, JSON.stringify(storedIssues));

    assert.deepEqual(IssueService.getIssues(), storedIssues);
});

test("getIssueById returns a matching issue or null when none exists", () => {
    const storedIssue = { id: "issue-1", title: "Pothole" };
    storage.setItem(STORAGE_KEY, JSON.stringify([storedIssue]));

    assert.deepEqual(IssueService.getIssueById("issue-1"), storedIssue);
    assert.equal(IssueService.getIssueById("missing"), null);
});

test("getIssues returns an empty collection for malformed JSON", () => {
    console.error = () => {};
    storage.setItem(STORAGE_KEY, "{not valid JSON");

    assert.doesNotThrow(() => IssueService.getIssues());
    assert.deepEqual(IssueService.getIssues(), []);
});

test("getIssues returns an empty collection for non-array JSON", () => {
    console.error = () => {};
    storage.setItem(STORAGE_KEY, JSON.stringify({ id: "issue-1" }));

    assert.deepEqual(IssueService.getIssues(), []);
});

test("getIssues returns an empty collection when storage reads fail", () => {
    console.error = () => {};
    storage.getError = new Error("Storage is unavailable");

    assert.deepEqual(IssueService.getIssues(), []);
});

test("saveIssue writes the expected issue collection", () => {
    const existingIssue = { id: "issue-1", title: "Existing issue" };
    storage.setItem(STORAGE_KEY, JSON.stringify([existingIssue]));
    const newIssue = {
        id: "issue-2",
        title: "New issue",
        description: "New description",
        category: "Roads",
        priority: "High",
        status: "Open",
        reportedBy: "Sam",
        dateReported: "2026-08-02T12:00:00.000Z",
        location: "300 Pine Street"
    };

    const savedIssue = IssueService.saveIssue(newIssue);

    assert.deepEqual({ ...savedIssue }, newIssue);
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), [existingIssue, newIssue]);
});

test("updateIssue updates an existing issue and returns true", () => {
    const originalIssue = {
        id: "issue-1",
        title: "Original title",
        dateReported: "2026-08-03T12:00:00.000Z"
    };
    storage.setItem(STORAGE_KEY, JSON.stringify([originalIssue]));
    const updatedIssue = {
        ...originalIssue,
        title: "Updated title",
        status: "Closed"
    };

    assert.equal(IssueService.updateIssue(updatedIssue), true);
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), [{
        id: "issue-1",
        title: "Updated title",
        description: "",
        category: "General",
        priority: "Medium",
        status: "Closed",
        reportedBy: "",
        dateReported: "2026-08-03T12:00:00.000Z",
        location: ""
    }]);
});

test("updateIssue returns false and does not write when the issue is missing", () => {
    const existingIssues = [{ id: "issue-1", title: "Existing issue" }];
    const serializedIssues = JSON.stringify(existingIssues);
    storage.setItem(STORAGE_KEY, serializedIssues);

    assert.equal(IssueService.updateIssue({ id: "missing", title: "Missing issue" }), false);
    assert.equal(storage.getItem(STORAGE_KEY), serializedIssues);
});

test("deleteIssue deletes an existing issue and returns true", () => {
    const remainingIssue = { id: "issue-2", title: "Keep this issue" };
    storage.setItem(STORAGE_KEY, JSON.stringify([
        { id: "issue-1", title: "Delete this issue" },
        remainingIssue
    ]));

    assert.equal(IssueService.deleteIssue("issue-1"), true);
    assert.deepEqual(JSON.parse(storage.getItem(STORAGE_KEY)), [remainingIssue]);
});

test("deleteIssue returns false and does not write when the issue is missing", () => {
    const serializedIssues = JSON.stringify([
        { id: "issue-1", title: "Keep this issue" }
    ]);
    storage.setItem(STORAGE_KEY, serializedIssues);

    assert.equal(IssueService.deleteIssue("missing"), false);
    assert.equal(storage.getItem(STORAGE_KEY), serializedIssues);
});

test("clearIssues removes stored issues and returns true", () => {
    storage.setItem(STORAGE_KEY, JSON.stringify([{ id: "issue-1" }]));

    assert.equal(IssueService.clearIssues(), true);
    assert.equal(storage.getItem(STORAGE_KEY), null);
});

test("clearIssues surfaces storage removal failures", () => {
    console.error = () => {};
    const storageFailure = new Error("Storage removal failed");
    storage.removeError = storageFailure;

    assert.throws(
        () => IssueService.clearIssues(),
        error => {
            assert.equal(error.message, "CityVUE could not clear the stored issues.");
            assert.equal(error.cause, storageFailure);
            return true;
        }
    );
});

test("storage write failures are surfaced instead of reported as success", () => {
    console.error = () => {};
    const storageFailure = new Error("Storage quota exceeded");
    storage.setError = storageFailure;

    assert.throws(
        () => IssueService.saveIssue({ id: "issue-1", title: "Cannot save" }),
        error => {
            assert.equal(error.message, "CityVUE could not save the issue data.");
            assert.equal(error.cause, storageFailure);
            return true;
        }
    );
});
