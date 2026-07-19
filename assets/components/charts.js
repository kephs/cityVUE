// ======================================================
// Chart Instances
// ======================================================

let statusChartInstance = null;

let priorityChartInstance = null;

let categoryChartInstance = null;

// ======================================================
// Status Doughnut Chart
// ======================================================

export function renderStatusChart(statusCounts) {

    const canvas = document.querySelector("#statusChart");

    if (!canvas) return;

    if (statusChartInstance) {

        statusChartInstance.destroy();

    }

    statusChartInstance = new Chart(canvas, {

        type: "doughnut",

        data: {

            labels: [

                "Open",

                "In Progress",

                "Closed"

            ],

            datasets: [{

                data: [

                    statusCounts.open,

                    statusCounts.inProgress,

                    statusCounts.closed

                ],

                backgroundColor: [

                    "#198754",

                    "#ffc107",

                    "#6c757d"

                ]

            }]

        },

        options: {

            responsive: true,

            plugins: {

                legend: {

                    position: "bottom"

                }

            }

        }

    });

}

// ======================================================
// Priority Pie Chart
// ======================================================

export function renderPriorityChart(priorityCounts) {

    const canvas = document.querySelector("#priorityChart");

    if (!canvas) return;

    if (priorityChartInstance) {

        priorityChartInstance.destroy();

    }

    priorityChartInstance = new Chart(canvas, {

        type: "pie",

        data: {

            labels: [

                "High",

                "Medium",

                "Low"

            ],

            datasets: [{

                data: [

                    priorityCounts.high,

                    priorityCounts.medium,

                    priorityCounts.low

                ],

                backgroundColor: [

                    "#dc3545",

                    "#ffc107",

                    "#198754"

                ]

            }]

        },

        options: {

            responsive: true,

            plugins: {

                legend: {

                    position: "bottom"

                }

            }

        }

    });

}

// ======================================================
// Category Bar Chart
// ======================================================

export function renderCategoryChart(categoryCounts) {

    const canvas = document.querySelector("#categoryChart");

    if (!canvas) return;

    if (categoryChartInstance) {

        categoryChartInstance.destroy();

    }

    categoryChartInstance = new Chart(canvas, {

        type: "bar",

        data: {

            labels: Object.keys(categoryCounts),

            datasets: [{

                label: "Issues",

                data: Object.values(categoryCounts)

            }]

        },

        options: {

            responsive: true,

            plugins: {

                legend: {

                    display: false

                }

            },

            scales: {

                y: {

                    beginAtZero: true,

                    ticks: {

                        precision: 0

                    }

                }

            }

        }

    });

}