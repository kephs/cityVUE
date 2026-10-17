param location string
param namingPrefix string

@description('Approved globally unique ACR name, alphanumeric only; no deployment default.')
@minLength(5)
@maxLength(50)
param registryName string
param vnetId string
param acrPrivateEndpointSubnetId string

resource registry 'Microsoft.ContainerRegistry/registries@2025-11-01' = {
  name: registryName
  location: location
  sku: {
    name: 'Premium'
  }
  properties: {
    roleAssignmentMode: 'AbacRepositoryPermissions'
    adminUserEnabled: false
    anonymousPullEnabled: false
    publicNetworkAccess: 'Disabled'
    networkRuleSet: {
      defaultAction: 'Deny'
      ipRules: []
    }
    // Approved Defender purpose; Azure applies this to its wider trusted-service set.
    // No Defender plan or unrelated service permission is created here.
    networkRuleBypassOptions: 'AzureServices'
    networkRuleBypassAllowedForTasks: false
    dataEndpointEnabled: true
    policies: {
      azureADAuthenticationAsArmPolicy: {
        status: 'enabled'
      }
    }
  }
}

resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2024-11-30' = {
  name: '${namingPrefix}-frontend-pull'
  location: location
}

// Reader grants only content/read and metadata/read; the condition restricts BOTH.
// Changing this role or adding an action requires a fresh condition/security review.
var readerRoleId = subscriptionResourceId('Microsoft.Authorization/roleDefinitions', 'b93aa761-3e63-49ed-ac28-beffa264f7ac')
resource pullReader 'Microsoft.Authorization/roleAssignments@2022-04-01' = {
  name: guid(registry.id, pullIdentity.id, readerRoleId)
  scope: registry
  properties: {
    roleDefinitionId: readerRoleId
    principalId: pullIdentity.properties.principalId
    principalType: 'ServicePrincipal'
    conditionVersion: '2.0'
    condition: '''
(
  (
    !(ActionMatches{'Microsoft.ContainerRegistry/registries/repositories/content/read'})
    AND
    !(ActionMatches{'Microsoft.ContainerRegistry/registries/repositories/metadata/read'})
  )
  OR
  (
    @Request[Microsoft.ContainerRegistry/registries/repositories:name] StringEqualsIgnoreCase 'reqro/frontend'
  )
)
'''
  }
}

resource acrEndpoint 'Microsoft.Network/privateEndpoints@2025-01-01' = {
  name: '${namingPrefix}-acr-pe'
  location: location
  properties: {
    subnet: {
      id: acrPrivateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'acr-registry'
        properties: {
          privateLinkServiceId: registry.id
          groupIds: [
            'registry'
          ]
        }
      }
    ]
  }
}

resource acrDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.azurecr.io'
  location: 'global'
}

resource acrVnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: acrDns
  name: '${namingPrefix}-acr-vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnetId
    }
  }
}

// Azure manages login AND regional data endpoint records from endpoint configuration.
// Never hardcode their IPs or hand-author a login-only A record.
resource acrZoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2025-01-01' = {
  parent: acrEndpoint
  name: 'acr-private-dns'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'acr'
        properties: {
          privateDnsZoneId: acrDns.id
        }
      }
    ]
  }
}

output loginServer string = registry.properties.loginServer
output pullIdentityId string = pullIdentity.id
