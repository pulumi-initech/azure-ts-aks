import * as pulumi from "@pulumi/pulumi";

export const getResource = (
  resources: pulumi.Output<any[]>,
  kind: string,
  name: string,
  namespace: string
) => {
  const lookupTable = resources.apply((resources) => {
    return resources.reduce((table, r) => {
      const ident = pulumi.interpolate`${r.apiVersion}/${r.kind}/${r.id}`;
      return pulumi.all([table, ident, r]).apply(([tbl, id, r]) => {
        tbl[id] = r as pulumi.Resource;
        return tbl;
      });
    }, {});
  });

  // now we can look up the desired resource by ident
  return lookupTable.apply((table) => {
    return table[`${kind}/${namespace}/${name}`];
  }) as unknown;
};
