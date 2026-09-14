export const navigationGroups = [
    ['Main', ['Dashboard']],
    ['Content Management', ['Resident Alerts', 'News & Announcements', 'Service Catalog', 'Departments', 'Issue Management']],
    ['User Management', ['Users & Roles', 'Entra ID Sync', 'Access Logs']],
    ['AI Management', ['AI Configuration', 'Model Management', 'Usage & Analytics', 'Content Filters', 'Prompt Templates']],
    ['System', ['Settings', 'Audit Logs', 'Monitoring', 'Backup & Restore', 'About']]
];
export const metrics = [
    { label: 'Total Issues', value: '1,842', icon: 'clipboard-data', tone: 'primary' },
    { label: 'Resolved', value: '1,564', icon: 'check-circle', tone: 'success' },
    { label: 'Open', value: '278', icon: 'folder2-open', tone: 'warning' },
    { label: 'Active Alerts', value: '3', icon: 'megaphone', tone: 'info' }
];
export const activities = [
    ['Sep 13, 2026 · 10:45 AM', 'Alert Update', 'Sample road maintenance notice revised', 'Administrator (Demo)'],
    ['Sep 13, 2026 · 10:20 AM', 'User Added', 'Sample reviewer account added', 'Administrator (Demo)'],
    ['Sep 12, 2026 · 3:15 PM', 'Service Update', 'Sample service description updated', 'Content Editor (Demo)'],
    ['Sep 12, 2026 · 2:30 PM', 'AI Setting', 'Sample configuration review recorded', 'Administrator (Demo)'],
    ['Sep 12, 2026 · 11:00 AM', 'Department', 'Sample department contact updated', 'Content Editor (Demo)']
];
export const departments = ['Public Works', 'Parks & Recreation', 'Community Recreation', 'Planning & Development', 'Other'];
export const departmentPeriods = {
    'Last 30 days (sample)': [180, 95, 62, 48, 32],
    'Last 7 days (sample)': [42, 23, 16, 12, 8]
};
export const systemStatuses = [
    ['Web Application', 'Operational'], ['Database', 'Operational'], ['Email Service', 'Operational'],
    ['Entra ID Authentication', 'Operational'], ['AI Services', 'Not Connected'], ['Backup Service', 'Operational']
];
export const quickActions = ['Create Resident Alert', 'Publish News Update', 'Manage Service Catalog', 'Add New User', 'Configure AI Settings', 'View System Logs'];
