# Example Graphs

This directory contains example graph files you can use with `gcyphrq`.

Each file uses a simple JSON format:

```json
{
  "nodes": [
    { "id": "<node-id>", "label": "<label>", "<property>": "<value>", ... }
  ],
  "edges": [
    { "source": "<source-id>", "target": "<target-id>", "type": "<edge-type>", ... }
  ]
}
```

## Available examples

| File | Description |
|---|---|
| `social-graph.json` | A small social network with three users connected by `FRIEND` relationships |
| `cloud-infra.json` | A full startup cloud infrastructure — 52 nodes, 110 edges — with RPC services, message queues, databases, workers, monitoring, and external APIs |

## Usage

```bash
# Load a graph from file
gcyphrq -g examples/social-graph.json -e 'MATCH (u:User) RETURN u'

# Pipe a graph from stdin
cat examples/social-graph.json | gcyphrq -g - -e 'MATCH (u:User) RETURN u'
```

---

## `cloud-infra.json` — Query Examples

This graph models an entire startup's cloud service infrastructure. Use it to explore real-world queries like impact analysis, dependency chains, and service topology.

### 1. List all RPC services

Find every service of type `RPC` running in the infrastructure:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {type: "RPC"}) RETURN s'
```

### 2. Trace the full request path from the public API to databases

Follow the call chain from the API Gateway, 2–4 hops deep, to see which databases a request can reach:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (api:Service {name: "API Gateway"})-[r*2..4]->(db:Database) RETURN api, r, db'
```

### 3. Find all services that depend on a specific database

Discover every service that has a direct connection to the PostgreSQL primary:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:TCP]->(db:Database {name: "PostgreSQL Primary"}) RETURN s'
```

### 4. Count how many services each message queue feeds into

Group by message queue and count the downstream consumers:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (mq:Infrastructure {type: "MessageQueue"})-[:TCP]->(w:Service) WITH mq, count(w) AS consumerCount RETURN mq, consumerCount'
```

### 5. Find the blast radius of a service failure

If the Kafka cluster goes down, which services are directly or indirectly affected (up to 2 hops)?

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (kafka:Infrastructure {name: "Kafka Cluster"})-[r*1..2]-(affected) RETURN kafka, r, affected'
```

### 6. List all external dependencies per service

For each RPC service, find which external APIs it calls (directly or through intermediaries, up to 3 hops):

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service {type: "RPC"})-[r*1..3]->(ext:External) RETURN s, ext'
```

### 7. Find which services call Stripe

Trace from any service through up to 3 hops to find which ones reach the Stripe API:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[r*1..3]->(stripe:External {name: "Stripe API"}) RETURN s, stripe'
```

### 8. Map the replication topology

Find all replication relationships between databases:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (primary:Database)-[r:Replication]->(replica:Database) RETURN primary, r, replica'
```

### 9. Find the longest dependency chain

Trace paths from the CDN (edge) down through the infrastructure to storage or databases (up to 6 hops):

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (cdn:Service {name: "CloudFront CDN"})-[r*1..6]->(leaf:Database) RETURN cdn, r, leaf'
```

### 10. List all services hosted on the primary EKS cluster

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (eks:Infrastructure {name: "EKS Cluster"})-[:Hosts]->(s:Service) RETURN s'
```

### 11. Find which services talk to Vault for secrets

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[:HTTPS]->(v:Security {name: "Vault"}) RETURN s'
```

### 12. Count outgoing connections per service

Rank services by how many direct dependencies they have:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[]->(target) WITH s, count(target) AS outDegree WHERE outDegree > 2 RETURN s, outDegree'
```

### 13. Sort services by name (ORDER BY)

Return all services sorted alphabetically by name:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s.name ORDER BY s.name ASC'
```

### 14. Top-N services by connection count (ORDER BY + LIMIT)

Find the 3 services with the most outgoing connections:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service)-[]->(target) WITH s, count(target) AS outDegree ORDER BY outDegree DESC LIMIT 3 RETURN s.name, outDegree'
```

### 15. Limit results to first N (LIMIT)

Return only the first 5 databases in the infrastructure:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (d:Database) RETURN d.name LIMIT 5'
```

### 16. Sort by multiple columns

Sort services first by type (ascending), then by name (descending):

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s.type, s.name ORDER BY s.type ASC, s.name DESC'
```

### 17. Skip first N results (SKIP)

Skip the first 5 services when listing all services:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s.name SKIP 5'
```

### 18. Pagination with ORDER BY + SKIP + LIMIT

Get page 2 of services sorted by name (10 per page):

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) RETURN s.name ORDER BY s.name ASC SKIP 10 LIMIT 10'
```

### 19. Filter with WHERE on MATCH

Filter nodes directly during matching (no WITH needed):

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) WHERE s.type = "RPC" RETURN s.name'
```

### 20. WHERE with AND (multiple conditions)

Combine conditions — both must be true:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) WHERE s.name CONTAINS "Service" AND s.region = "us-east-1" RETURN s.name'
```

### 21. WHERE with OR (either condition)

Either condition can be true:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) WHERE s.type = "RPC" OR s.type = "Worker" RETURN s.name'
```

### 22. WHERE with NOT (negation)

Exclude nodes matching a condition:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) WHERE NOT s.type = "Batch" RETURN s.name'
```

### 23. WHERE with <> (not-equals)

Filter out nodes with a specific value:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) WHERE s.region <> "us-east-1" RETURN s.name'
```

### 24. WHERE with CONTAINS (substring match)

Find nodes where a property contains a substring:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) WHERE s.name CONTAINS "Service" RETURN s.name'
```

### 25. Average, min, max aggregations

Compute average, minimum, and maximum across all users:

```bash
gcyphrq -g examples/social-graph.json -e 'MATCH (u:User) RETURN avg(u.age) AS avgAge, min(u.age) AS minAge, max(u.age) AS maxAge'
```

### 26. Filter with IS NULL (null check)

Find nodes where a property is null or missing:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) WHERE s.status IS NULL RETURN s.name'
```

### 27. Filter with IS NOT NULL (not-null check)

Find nodes where a property has a value:

```bash
gcyphrq -g examples/cloud-infra.json -e 'MATCH (s:Service) WHERE s.status IS NOT NULL RETURN s.name'
```
