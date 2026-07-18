export default class Issue {
    constructor({
        id = crypto.randomUUID(),
        title = "",
        description = "",
        category = "General",
        priority = "Medium",
        status = "Open",
        reportedBy = "",
        dateReported = new Date().toISOString(),
        location = ""
    } = {}) {

        this.id = id;
        this.title = title;
        this.description = description;
        this.category = category;
        this.priority = priority;
        this.status = status;
        this.reportedBy = reportedBy;
        this.dateReported = dateReported;
        this.location = location;
    }
}