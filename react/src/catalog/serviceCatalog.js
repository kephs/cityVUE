export const serviceCatalog = {
    fixtureNotice: "Demonstration catalog for the CityVUE intake prototype; not official City service definitions.",
    departments: [
        { id: "public-works", name: "Public Works", status: "active" },
        { id: "environment", name: "Environmental Services", status: "active" },
        { id: "community-services", name: "Community Services", status: "active" }
    ],
    categories: [
        { id: "roads", departmentId: "public-works", name: "Roads & Streets", description: "Road surfaces, signs, and street conditions.", icon: "bi-signpost-split", accent: "blue", legacyCategory: "Road", displayOrder: 1, status: "active" },
        { id: "lighting", departmentId: "public-works", name: "Streetlights", description: "Public streetlight outages and damage.", icon: "bi-lightbulb", accent: "amber", legacyCategory: "Lighting", displayOrder: 2, status: "active" },
        { id: "water", departmentId: "public-works", name: "Water & Drainage", description: "Leaks, drainage, and standing water concerns.", icon: "bi-droplet", accent: "cyan", legacyCategory: "Water", displayOrder: 3, status: "active" },
        { id: "waste", departmentId: "environment", name: "Trash & Recycling", description: "Collection, containers, and public litter.", icon: "bi-recycle", accent: "green", legacyCategory: "Garbage", displayOrder: 4, status: "active" },
        { id: "nature", departmentId: "community-services", name: "Trees & Landscaping", description: "Public trees and maintained landscape areas.", icon: "bi-tree", accent: "emerald", legacyCategory: "Parks", displayOrder: 5, status: "active" },
        { id: "inactive-demo", departmentId: "community-services", name: "Archived Demonstration", legacyCategory: "Other", displayOrder: 99, status: "inactive" }
    ],
    services: [
        {
            id: "pothole", departmentId: "public-works", categoryId: "roads", name: "Pothole", icon: "bi-cone-striped", citizenDescription: "Report a hole or broken pavement in a public roadway.",
            keywords: ["pavement damage", "street damage", "broken asphalt"], aliases: ["hole in road", "road hole", "crater"], defaultPriority: "Medium", anonymousPolicy: "allowed", locationRequirement: "required", status: "active",
            defaultGroup: "Street Maintenance", defaultRole: "Road Maintenance Supervisor",
            questions: [
                { id: "approximateSize", label: "Approximate size in feet", helpText: "An estimate is fine.", type: "number", required: false, displayOrder: 1 },
                { id: "roadBlocked", label: "Is the roadway blocked?", type: "yes-no", required: true, displayOrder: 2 },
                { id: "blockageDetails", label: "Describe how the roadway is blocked", type: "long-text", required: true, displayOrder: 3, visibilityRule: { field: "roadBlocked", equals: "yes" } }
            ]
        },
        {
            id: "damaged-sign", departmentId: "public-works", categoryId: "roads", name: "Damaged Street Sign", icon: "bi-signpost-split", citizenDescription: "Report a damaged, missing, or unreadable public street sign.",
            keywords: ["traffic sign", "missing sign"], aliases: ["bent sign", "sign down"], defaultPriority: "Medium", anonymousPolicy: "allowed", locationRequirement: "required", status: "active",
            questions: [{ id: "signCondition", label: "What is wrong with the sign?", type: "single-select", required: true, displayOrder: 1, options: [{ value: "damaged", label: "Damaged" }, { value: "missing", label: "Missing" }, { value: "unreadable", label: "Unreadable" }] }]
        },
        {
            id: "streetlight-out", departmentId: "public-works", categoryId: "lighting", name: "Streetlight Out", icon: "bi-lightbulb", citizenDescription: "Report a public streetlight that is dark or malfunctioning.",
            keywords: ["lamp", "lighting", "dark street"], aliases: ["light out", "broken lamp", "flickering light"], defaultPriority: "Medium", anonymousPolicy: "allowed", locationRequirement: "required", status: "active",
            questions: [{ id: "poleNumber", label: "Pole or asset number", helpText: "If visible on the pole.", type: "short-text", required: false, displayOrder: 1 }, { id: "lightBehavior", label: "What is the light doing?", type: "single-select", required: true, displayOrder: 2, options: [{ value: "out", label: "Completely out" }, { value: "flickering", label: "Flickering" }, { value: "daytime", label: "On during daylight" }] }]
        },
        {
            id: "drainage", departmentId: "public-works", categoryId: "water", name: "Drainage Concern", icon: "bi-water", citizenDescription: "Report standing water or a blocked public drain.",
            keywords: ["flooding", "storm drain", "standing water"], aliases: ["clogged drain", "water pooling"], defaultPriority: "High", anonymousPolicy: "allowed", locationRequirement: "required", status: "active",
            questions: [{ id: "drainageDetails", label: "Describe the water or drainage condition", type: "long-text", required: true, displayOrder: 1 }]
        },
        {
            id: "missed-collection", departmentId: "environment", categoryId: "waste", name: "Missed Collection", icon: "bi-trash3", citizenDescription: "Report eligible trash or recycling that was not collected.",
            keywords: ["garbage", "recycling", "pickup"], aliases: ["trash not picked up", "missed pickup"], defaultPriority: "Low", anonymousPolicy: "not-allowed", locationRequirement: "required", status: "active",
            questions: [{ id: "collectionType", label: "Which collection was missed?", type: "single-select", required: true, displayOrder: 1, options: [{ value: "trash", label: "Trash" }, { value: "recycling", label: "Recycling" }, { value: "yard", label: "Yard materials" }] }, { id: "containerCount", label: "Number of containers", type: "number", required: true, displayOrder: 2 }]
        },
        {
            id: "fallen-tree", departmentId: "community-services", categoryId: "nature", name: "Fallen Tree or Branch", icon: "bi-tree", citizenDescription: "Report a fallen public tree or branch in a public area.",
            keywords: ["tree damage", "branch", "limb"], aliases: ["tree down", "fallen limb"], defaultPriority: "High", anonymousPolicy: "allowed", locationRequirement: "required", status: "active",
            questions: [{ id: "publicAccessBlocked", label: "Is public access blocked?", type: "yes-no", required: true, displayOrder: 1 }, { id: "affectedArea", label: "Which area is affected?", type: "single-select", required: true, displayOrder: 2, options: [{ value: "sidewalk", label: "Sidewalk" }, { value: "road", label: "Roadway" }, { value: "park", label: "Park or trail" }, { value: "other", label: "Other public area" }] }]
        }
    ]
};
