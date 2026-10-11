param location string
param namingPrefix string
param vnetId string
param privateEndpointSubnetId string
param environmentId string

// Customer-managed endpoint only. AFD creates its own separate managed endpoint.
resource customerEndpoint 'Microsoft.Network/privateEndpoints@2025-01-01' = {
  name: '${namingPrefix}-frontend-pe'
  location: location
  properties: {
    subnet: {
      id: privateEndpointSubnetId
    }
    privateLinkServiceConnections: [
      {
        name: 'aca-environment'
        properties: {
          privateLinkServiceId: environmentId
          groupIds: [
            'managedEnvironments'
          ]
        }
      }
    ]
  }
}

resource privateDns 'Microsoft.Network/privateDnsZones@2024-06-01' = {
  name: 'privatelink.${location}.azurecontainerapps.io'
  location: 'global'
}

resource vnetLink 'Microsoft.Network/privateDnsZones/virtualNetworkLinks@2024-06-01' = {
  parent: privateDns
  name: '${namingPrefix}-frontend-vnet-link'
  location: 'global'
  properties: {
    registrationEnabled: false
    virtualNetwork: {
      id: vnetId
    }
  }
}

resource zoneGroup 'Microsoft.Network/privateEndpoints/privateDnsZoneGroups@2025-01-01' = {
  parent: customerEndpoint
  name: 'aca-private-dns'
  properties: {
    privateDnsZoneConfigs: [
      {
        name: 'aca'
        properties: {
          privateDnsZoneId: privateDns.id
        }
      }
    ]
  }
}
