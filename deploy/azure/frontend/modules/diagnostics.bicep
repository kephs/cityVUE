param location string
@description('Approved naming prefix unique to one client deployment and environment.')
param namingPrefix string

@description('Policy-approved workspace SKU; no default. Validate SKU/retention compatibility before deployment.')
param logAnalyticsSku string
@description('Policy-approved workspace retention; no duration is selected by this foundation.')
param logRetentionInDays int
@description('Required reviewed query-network decision. Disabled requires a separately approved working private query path; none is created here.')
@allowed([
  'Enabled'
  'Disabled'
])
param logQueryPublicNetworkAccess string

resource workspace 'Microsoft.OperationalInsights/workspaces@2026-03-01' = {
  name: '${namingPrefix}-frontend-logs'
  location: location
  properties: {
    sku: {
      name: logAnalyticsSku
    }
    retentionInDays: logRetentionInDays
    publicNetworkAccessForIngestion: 'Disabled'
    publicNetworkAccessForQuery: logQueryPublicNetworkAccess
  }
}

output workspaceId string = workspace.id
