targetScope = 'resourceGroup'

// Deliberate source-level gate: this foundation cannot provision via main.
// Enabling requires a separate reviewed change after all documented gates.
var deploymentEnabled = false

@description('Approved Azure region identifier; no production default.')
@minLength(1)
param location string

@description('Approved client-neutral naming prefix, valid for all resource names.')
@minLength(3)
@maxLength(20)
param namingPrefix string

@description('Approved nonoverlapping VNet address space.')
param vnetAddressPrefix string
@description('Approved subnet CIDR delegated to Microsoft.App/environments.')
param infrastructureSubnetPrefix string
@description('Approved distinct nondelegated private endpoint subnet CIDR.')
param privateEndpointSubnetPrefix string

@description('Approved workload profile name; capacity is an explicit deployment decision.')
param workloadProfileName string
param workloadProfileType string
@minValue(0)
param workloadProfileMinimumCount int
@minValue(0)
param workloadProfileMaximumCount int

@description('Approved container CPU quantity as a JSON number string; validated before deployment.')
@minLength(1)
param frontendCpu string
@description('Approved ACA memory quantity; must be compatible with CPU and workload profile.')
@minLength(1)
param frontendMemory string

@description('REQUIRED: published Reqro runtime image <approved-registry>/<reqro-image>@sha256:<64 lowercase hex>. No floating tag or upstream NGINX base. Registry, SBOM, vulnerability review and verified immutable publication must precede supplying this value.')
@minLength(74)
param frontendImageReference string

module network './modules/network.bicep' = if (deploymentEnabled) {
  name: 'frontend-network'
  params: {
    location: location
    namingPrefix: namingPrefix
    vnetAddressPrefix: vnetAddressPrefix
    infrastructureSubnetPrefix: infrastructureSubnetPrefix
    privateEndpointSubnetPrefix: privateEndpointSubnetPrefix
  }
}

module origin './modules/static-origin.bicep' = if (deploymentEnabled) {
  name: 'frontend-origin'
  params: {
    location: location
    namingPrefix: namingPrefix
    infrastructureSubnetId: network.?outputs.infrastructureSubnetId ?? ''
    workloadProfileName: workloadProfileName
    workloadProfileType: workloadProfileType
    workloadProfileMinimumCount: workloadProfileMinimumCount
    workloadProfileMaximumCount: workloadProfileMaximumCount
    frontendCpu: frontendCpu
    frontendMemory: frontendMemory
    frontendImageReference: frontendImageReference
  }
}

module connectivity './modules/private-connectivity.bicep' = if (deploymentEnabled) {
  name: 'frontend-private-connectivity'
  params: {
    location: location
    namingPrefix: namingPrefix
    vnetId: network.?outputs.vnetId ?? ''
    privateEndpointSubnetId: network.?outputs.privateEndpointSubnetId ?? ''
    environmentId: origin.?outputs.environmentId ?? ''
  }
}

module edge './modules/front-door.bicep' = if (deploymentEnabled) {
  name: 'frontend-edge'
  params: {
    location: location
    namingPrefix: namingPrefix
    environmentId: origin.?outputs.environmentId ?? ''
    frontendFqdn: origin.?outputs.frontendFqdn ?? ''
  }
}

// No resource references are evaluated in outputs while provisioning is disabled.
output foundationStatus string = 'Deployment disabled; review all feature-document gates before enabling.'
