// Copyright 2016-2020, Pulumi Corporation.  All rights reserved.

import * as azuread from "@pulumi/azuread";
import * as tls from "@pulumi/tls";
import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import * as containerservice from "@pulumi/azure-native/containerservice";
import * as resources from "@pulumi/azure-native/resources";
import { getResource } from "./helpers";

const config = new pulumi.Config();

// Create an Azure Resource Group
const resourceGroup = new resources.ResourceGroup(`azure-ts-aks-${pulumi.getStack()}`, {});

// Create an AD service principal
const adApp = new azuread.Application("aks", {
  displayName: "aks",
});

const adSp = new azuread.ServicePrincipal("aksSp", {
  applicationId: adApp.applicationId,
  appRoleAssignmentRequired: false,
});

// Create the Service Principal Password
const adSpPassword = new azuread.ServicePrincipalPassword("aksSpPassword", {
  servicePrincipalId: adSp.id,
  endDate: "2099-01-01T00:00:00Z",
});

// Generate an SSH key
const sshKey = new tls.PrivateKey("ssh-key", {
  algorithm: "RSA",
  rsaBits: 4096,
});

const managedClusterName = config.get("managedClusterName") || "azure-aks";
const cluster = new containerservice.ManagedCluster(
  managedClusterName,
  {
    resourceGroupName: resourceGroup.name,
    agentPoolProfiles: [
      {
        count: 2,
        maxPods: 110,
        mode: "System",
        name: "agentpool",
        nodeLabels: {},
        osDiskSizeGB: 30,
        osType: "Linux",
        type: "VirtualMachineScaleSets",
        vmSize: "Standard_DS2_v2",
      },
    ],
    dnsPrefix: resourceGroup.name,
    enableRBAC: true,
    kubernetesVersion: config.get("kubernetesVersion") || "1.32.0",
    linuxProfile: {
      adminUsername: "testuser",
      ssh: {
        publicKeys: [
          {
            keyData: sshKey.publicKeyOpenssh,
          },
        ],
      },
    },
    nodeResourceGroup: `MC_azure-ts-aks_${managedClusterName}`,
    servicePrincipalProfile: {
      clientId: adApp.applicationId,
      secret: adSpPassword.value,
    },
  },
  { dependsOn: [adSp, adSpPassword] }
);

const creds = containerservice.listManagedClusterUserCredentialsOutput({
  resourceGroupName: resourceGroup.name,
  resourceName: cluster.name,
});

const encoded = creds.kubeconfigs[0].value;

export const fqdn = cluster.fqdn;
export const clusterIdentifier = cluster.id;
export const azEksGetCredentials = pulumi
  .all([cluster.name, resourceGroup.name])
  .apply(([name, rg]) => {
    return `az aks get-credentials --name ${name} --resource-group ${rg} --overwrite-existing --admin`;
  });
export const kubeconfig = pulumi.secret(
  encoded.apply((enc) => Buffer.from(enc, "base64").toString())
);

const provider = new k8s.Provider("k8s", {
  kubeconfig,
  clusterIdentifier,
});

const ns = new k8s.core.v1.Namespace(
  "podinfo-ns",
  {
    metadata: {
      name: `podinfo-${pulumi.runtime.getStack()}`,
      annotations: {
        "pulumi.com/patchForce": "true",
      },
    },
  },
  { provider }
);

const podInfo = new k8s.helm.v4.Chart(
  "podinfo",
  {
    chart: "podinfo",
    version: "6.7.0",
    namespace: ns.metadata.name,
    repositoryOpts: {
      repo: "https://stefanprodan.github.io/podinfo",
    },
    values: {
      service: {
        type: "LoadBalancer",
      },
    },
  },
  { provider }
);

const svc = getResource(
  podInfo.resources,
  "v1/Service",
  "podinfo",
  `podinfo-${pulumi.runtime.getStack()}`,
) as k8s.core.v1.Service;

export const url = pulumi.interpolate`http://${svc.status.loadBalancer.ingress[0].ip}:9898`;
