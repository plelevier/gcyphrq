# Query Examples for cloud-infra.json

Detailed query examples organized by use case. All queries target `examples/cloud-infra.json`.

## Service Discovery

### List all services by type

```bash
# All RPC services
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {type: "RPC"}) RETURN s'

# All workers
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {type: "Worker"}) RETURN s'

# All batch jobs
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {type: "Batch"}) RETURN s'
```

### List all infrastructure components

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (i:Infrastructure) RETURN i'
```

### List all databases

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (d:Database) RETURN d'
```

### List all external dependencies

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (e:External) RETURN e'
```

## Dependency Analysis

### Services connected to a specific database

```bash
# Direct TCP connections to PostgreSQL primary
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:TCP]->(db:Database {name: "PostgreSQL Primary"}) RETURN s'

# Services connected to Redis
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:TCP]->(db:Database {name: "Redis Primary"}) RETURN s'
```

### Full request path from edge to storage

```bash
# CDN → databases (2-4 hops, shows intermediate edges)
gcyphrq -g examples/cloud-infra.json -e 'MATCH (cdn:Service {name: "CloudFront CDN"})-[r*2..4]->(db:Database) RETURN cdn, r, db'

# CDN → storage (up to 6 hops)
gcyphrq -g examples/cloud-infra.json -e 'MATCH (cdn:Service {name: "CloudFront CDN"})-[r*1..6]->(leaf:Storage) RETURN cdn, r, leaf'
```

### Services that talk to Vault for secrets

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:HTTPS]->(v:Security {name: "Vault"}) RETURN s'
```

## Blast Radius / Impact Analysis

### Direct impact of a service failure

```bash
# Everything connected to Kafka (1 hop, undirected)
gcyphrq -g examples/cloud-infra.json -e 'MATCH (kafka:Infrastructure {name: "Kafka Cluster"})-[r*1..1]-(affected) RETURN kafka, r, affected'

# Everything connected to Kafka (2 hops)
gcyphrq -g examples/cloud-infra.json -e 'MATCH (kafka:Infrastructure {name: "Kafka Cluster"})-[r*1..2]-(affected) RETURN kafka, r, affected'

# Everything connected to PostgreSQL primary (2 hops)
gcyphrq -g examples/cloud-infra.json -e 'MATCH (pg:Database {name: "PostgreSQL Primary"})-[r*1..2]-(affected) RETURN pg, r, affected'
```

### Downstream impact (outbound only)

```bash
# What does Kafka feed into (outbound, 2 hops)
gcyphrq -g examples/cloud-infra.json -e 'MATCH (kafka:Infrastructure {name: "Kafka Cluster"})-[r*1..2]->(downstream) RETURN kafka, r, downstream'
```

## Message Queue Analysis

### Consumers per message queue

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (mq:Infrastructure {type: "MessageQueue"})-[:TCP]->(w:Service) WITH mq, count(w) AS consumerCount RETURN mq, consumerCount'
```

### Producers per message queue (services that write to queues)

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:TCP]->(mq:Infrastructure {type: "MessageQueue"}) WITH mq, count(s) AS producerCount RETURN mq, producerCount'
```

## External Dependencies

### Which RPC services reach external APIs (up to 3 hops)

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {type: "RPC"})-[r*1..3]->(ext:External) RETURN s, ext'
```

### Services that call Stripe

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[r*1..3]->(stripe:External {name: "Stripe API"}) RETURN s, stripe'
```

## Replication and Failover

### Replication topology

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (primary:Database)-[r:Replication]->(replica:Database) RETURN primary, r, replica'
```

### Backup destinations

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (source)-[r:Backup]->(target) RETURN source, r, target'
```

## Monitoring Coverage

### Services emitting metrics to Prometheus

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:Metrics]->(p:Monitoring {name: "Prometheus"}) RETURN s'
```

### Services emitting traces to Jaeger

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:Trace]->(j:Monitoring {name: "Jaeger"}) RETURN s'
```

### Services streaming logs to Loki

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:LogStream]->(l:Monitoring {name: "Loki"}) RETURN s'
```

## Hosting / Orchestration

### Services hosted on primary EKS cluster

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (eks:Infrastructure {name: "EKS Cluster"})-[:Hosts]->(s:Service) RETURN s'
```

### Services hosted on west region cluster

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (eks:Infrastructure {name: "EKS Cluster (West)"})-[:Hosts]->(s) RETURN s'
```

### CI/CD pipeline

```bash
# GitHub → Runner → Registry → Clusters
gcyphrq -g examples/cloud-infra.json -e 'MATCH (gh:External {name: "GitHub Repo"})-[r*1..3]->(k8s:Infrastructure {type: "Orchestrator"}) RETURN gh, r, k8s'
```

## Degree Analysis

### Outgoing connections per service (with threshold)

```bash
# Services with more than 2 outgoing connections
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[]->(target) WITH s, count(target) AS outDegree WHERE outDegree > 2 RETURN s, outDegree'
```

### Incoming connections per service

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (source)-[]->(s:Service) WITH s, count(source) AS inDegree WHERE inDegree > 2 RETURN s, inDegree'
```

### Most connected infrastructure components

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (i:Infrastructure)-[]->(target) WITH i, count(target) AS connections WHERE connections > 3 RETURN i, connections'
```

## Service Mesh

### Services using Envoy sidecars

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:Sidecar]->(envoy:Infrastructure {name: "Envoy Sidecar"}) RETURN s'
```

### Service discovery connections

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (envoy:Infrastructure {name: "Envoy Sidecar"})-[:HTTP]->(consul:Infrastructure {name: "Consul"}) RETURN envoy, consul'
```

## Storage Analysis

### All S3 buckets

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Storage {type: "ObjectStorage"}) RETURN s'
```

### Services writing to S3 data bucket

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:HTTPS]->(bucket:Storage {name: "S3 Data Bucket"}) RETURN s'
```

### Terraform-managed resources

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (tf:Storage {name: "Terraform State"})-[:Manages]->(resource) RETURN tf, resource'
```

## Mutations (in-memory only)

### Add a new service

```bash
gcyphrq -g examples/cloud-infra.json -e 'CREATE (s:Service {name: "New Service", type: "RPC", region: "us-east-1"}) RETURN s'
```

### Update a service property

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {name: "Auth Service"}) SET s.region = "us-west-2" RETURN s'
```

### Remove a service

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {name: "Auth Service"}) DELETE s'
```

> **Note:** Mutations are in-memory only. They do not modify the source JSON file.

## Composing Queries with jq

Pipe output to `jq` for further processing:

```bash
# Get just service names
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {type: "RPC"}) RETURN s' | jq '[.[].s.name]'

# Count results
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s' | jq 'length'

# Filter by region
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s' | jq '[.[].s | select(.region == "us-east-1")]'
```
