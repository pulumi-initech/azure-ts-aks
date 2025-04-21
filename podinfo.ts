import * as k8s from "@pulumi/kubernetes";
import * as pulumi from "@pulumi/pulumi";
import { kubeconfig, clusterIdentifier } from "./index";
import { getResource } from "./helpers";

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
  "podinfo"
) as k8s.core.v1.Service;

export const url = pulumi.interpolate`http://${svc.status.loadBalancer.ingress[0].hostname}:9898`;
