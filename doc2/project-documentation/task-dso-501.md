# The four concepts, using PostureSec

- **Repeatability:** Running a deployment process with the same inputs should produce the same result. For PostureSec, that means using the same manifests, configuration, and application images. Pinning images by digest makes the image input more precise than relying on a tag alone.

- **Idempotency:** Repeating the same declarative operation should leave the system in the same desired state, rather than creating duplicates or accumulating changes. For example, applying the PostureSec manifests repeatedly should keep the declared Deployments, Services, and NetworkPolicies aligned with those manifests.

- **Least privilege:** Give each component only the permissions and access it needs. In this repo, the application pods disable automatic service-account-token mounting; the backend and frontend drop Linux capabilities; and NetworkPolicies limit which PostureSec pods may reach the backend and database. The database’s `runAsNonRoot: false` is an explicit exception in the manifest, so least privilege is something to evaluate per container—not assume is complete.

- **Drift:** A difference between the declared configuration and what is actually running. For example, manually scaling the backend in the cluster without changing its manifest creates drift. Reapplying the desired configuration or using a reconciler such as GitOps can bring it back in line.

**Repeatability is about getting consistent outcomes from consistent inputs; idempotency is about safely repeating an operation.**