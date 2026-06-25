#!/usr/bin/env tsx
/**
 * Generate a large benchmark graph (~1MB) with realistic structure.
 *
 * Produces a graph with multiple tiers:
 *   - Entry points (CDNs, gateways)
 *   - Microservices (RPC, HTTP, workers)
 *   - Databases (caches, relational, search, time-series)
 *   - Infrastructure (message queues, storage, monitoring)
 *   - External services
 *
 * Usage: npx tsx scripts/generate-bench-graph.ts [output-path]
 */

import { writeFileSync } from 'fs';
import { resolve } from 'path';

// ── Config ───────────────────────────────────────────────────────────────────

const NUM_TENANTS = 22;
const SERVICES_PER_TENANT = 16;
const DBS_PER_TENANT = 6;
const WORKERS_PER_TENANT = 9;
const EXTERNAL_SERVICES = 15;
const SHARED_INFRA = 25;

const SERVICE_TYPES = ['RPC', 'HTTP', 'GraphQL', 'gRPC', 'REST', 'WebSocket'] as const;
const DB_TYPES = ['Cache', 'Relational', 'Search', 'TimeSeries', 'Document', 'Graph', 'KeyVal'] as const;
const WORKER_TYPES = ['Worker', 'Batch', 'Scheduler', 'StreamProcessor', 'ETL'] as const;
const REL_TYPES = ['RPC', 'HTTP', 'TCP', 'HTTPS', 'gRPC', 'WebSocket', 'Metrics', 'LogStream', 'Trace', 'Sidecar', 'Hosts', 'Replication', 'Backup', 'Manages', 'Triggers', 'Pushes', 'Pulls'] as const;
const REGIONS = ['us-east-1', 'us-west-2', 'eu-west-1', 'ap-southeast-1'] as const;
const TIERS = ['frontend', 'backend', 'data', 'infra', 'external'] as const;

// ── Helpers ──────────────────────────────────────────────────────────────────

function pick<T>(arr: readonly T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

function range(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i);
}

// ── Generate nodes ───────────────────────────────────────────────────────────

const nodes: Array<{ key: string; attributes: Record<string, unknown> }> = [];
const edges: Array<{ key: string; source: string; target: string; attributes: Record<string, unknown> }> = [];

const allNodeKeys = new Set<string>();

function addNode(key: string, attrs: Record<string, unknown>) {
  if (allNodeKeys.has(key)) return;
  allNodeKeys.add(key);
  nodes.push({ key, attributes: attrs });
}

function addEdge(source: string, target: string, type: string, extra?: Record<string, unknown>) {
  const key = `${source}-${target}-${type}`;
  if (edges.some(e => e.source === source && e.target === target && e.attributes.type === type)) return;
  edges.push({
    key,
    source,
    target,
    attributes: { type, ...extra },
  });
}

// ── Shared infrastructure ────────────────────────────────────────────────────

// Central monitoring stack
addNode('prometheus', { label: 'Monitoring', name: 'Prometheus', type: 'Metrics', region: 'us-east-1', port: 9090 });
addNode('grafana', { label: 'Monitoring', name: 'Grafana', type: 'Dashboard', region: 'us-east-1', port: 3000 });
addNode('loki', { label: 'Monitoring', name: 'Loki', type: 'LogAggregator', region: 'us-east-1', port: 3100 });
addNode('jaeger', { label: 'Monitoring', name: 'Jaeger', type: 'Tracing', region: 'us-east-1', port: 16686 });
addEdge('prometheus', 'grafana', 'HTTP');
addEdge('loki', 's3-logs', 'LogArchive');

// Central storage
addNode('s3-logs', { label: 'Storage', name: 'S3 Logs', type: 'ObjectStorage', region: 'us-east-1' });
addNode('s3-backups', { label: 'Storage', name: 'S3 Backups', type: 'ObjectStorage', region: 'us-east-1' });
addNode('s3-assets', { label: 'Storage', name: 'S3 Assets', type: 'ObjectStorage', region: 'us-east-1' });
addNode('s3-data', { label: 'Storage', name: 'S3 Data', type: 'ObjectStorage', region: 'us-east-1' });

// Central infra
addNode('vault', { label: 'Security', name: 'Vault', type: 'SecretsManager', region: 'us-east-1', port: 8200 });
addNode('consul', { label: 'Infrastructure', name: 'Consul', type: 'ServiceDiscovery', region: 'us-east-1', port: 8500 });
addNode('envoy-mesh', { label: 'Infrastructure', name: 'Envoy Mesh', type: 'ServiceMesh', region: 'us-east-1', port: 8080 });
addNode('consul', 'envoy-mesh', 'HTTP');

// CI/CD
addNode('github-repo', { label: 'External', name: 'GitHub Repo', type: 'SourceControl', region: 'external' });
addNode('github-runner', { label: 'Infrastructure', name: 'GitHub Runner', type: 'CI', region: 'us-east-1' });
addNode('docker-registry', { label: 'Infrastructure', name: 'ECR Registry', type: 'ContainerRegistry', region: 'us-east-1' });
addNode('github-repo', 'github-runner', 'Triggers');
addEdge('github-runner', 'docker-registry', 'Pushes');

// Entry points
addNode('cdn', { label: 'Service', name: 'CloudFront CDN', type: 'CDN', region: 'global' });
addNode('waf', { label: 'Service', name: 'WAF', type: 'Firewall', region: 'global' });
addNode('load-balancer', { label: 'Infrastructure', name: 'ALB', type: 'LoadBalancer', region: 'us-east-1' });
addEdge('cdn', 'waf', 'HTTPS');
addEdge('waf', 'load-balancer', 'HTTPS');

// Message brokers
addNode('kafka', { label: 'Infrastructure', name: 'Kafka Cluster', type: 'MessageQueue', region: 'us-east-1', partitions: 24 });
addNode('rabbitmq', { label: 'Infrastructure', name: 'RabbitMQ', type: 'MessageQueue', region: 'us-east-1', partitions: 12 });

// ── Generate per-tenant resources ────────────────────────────────────────────

for (const t of range(NUM_TENANTS)) {
  const tenant = `tenant-${t}`;
  const region = pick(REGIONS);

  // K8s cluster per tenant
  const k8sKey = `${tenant}-k8s`;
  addNode(k8sKey, { label: 'Infrastructure', name: `EKS ${tenant}`, type: 'Orchestrator', region });
  addEdge('docker-registry', k8sKey, 'Pulls');
  addEdge('terraform', k8sKey, 'Manages');

  // API Gateway
  const gatewayKey = `${tenant}-gateway`;
  addNode(gatewayKey, { label: 'Service', name: `API Gateway ${tenant}`, type: 'HTTP', region, port: 443 });
  addEdge('load-balancer', gatewayKey, 'HTTPS');

  // Services
  const serviceKeys: string[] = [];
  for (const s of range(SERVICES_PER_TENANT)) {
    const key = `${tenant}-svc-${s}`;
    const svcType = pick(SERVICE_TYPES);
    addNode(key, {
      label: 'Service',
      name: `Service ${s} (${tenant})`,
      type: svcType,
      region,
      port: 9000 + s,
      version: `${Math.floor(Math.random() * 10)}.${Math.floor(Math.random() * 20)}`,
      replicas: Math.floor(Math.random() * 8) + 1,
      cpu: `${Math.floor(Math.random() * 4)}00m`,
      memory: `${Math.floor(Math.random() * 8) + 1}Gi`,
    });
    serviceKeys.push(key);

    // Gateway -> services (first few)
    if (s < 5) {
      addEdge(gatewayKey, key, 'RPC');
    }

    // K8s hosts services
    addEdge(k8sKey, key, 'Hosts');

    // Envoy sidecar
    addEdge(key, 'envoy-mesh', 'Sidecar');

    // Monitoring
    addEdge(key, 'prometheus', 'Metrics');
    addEdge(key, 'loki', 'LogStream');
    if (Math.random() > 0.3) {
      addEdge(key, 'jaeger', 'Trace');
    }

    // Vault
    if (Math.random() > 0.5) {
      addEdge(key, 'vault', 'HTTPS');
    }

    // Inter-service edges (random connections to other services in same tenant)
    for (const otherKey of serviceKeys.slice(0, s)) {
      if (Math.random() > 0.6) {
        addEdge(key, otherKey, pick(['RPC', 'HTTP', 'gRPC']));
      }
    }
  }

  // Databases
  const dbKeys: string[] = [];
  for (const d of range(DBS_PER_TENANT)) {
    const dbType = DB_TYPES[d % DB_TYPES.length]!;
    const key = `${tenant}-db-${dbType.toLowerCase()}`;
    addNode(key, {
      label: 'Database',
      name: `${dbType} ${tenant}`,
      type: dbType,
      region,
      port: 5000 + d,
      size: `${Math.floor(Math.random() * 500) + 10}GB`,
      iops: Math.floor(Math.random() * 10000) + 1000,
    });
    dbKeys.push(key);

    // Services -> databases
    for (const svcKey of serviceKeys.slice(0, Math.min(4, serviceKeys.length))) {
      if (Math.random() > 0.3) {
        addEdge(svcKey, key, pick(['TCP', 'HTTP']));
      }
    }

    // Backup
    addEdge(key, 's3-backups', 'Backup');

    // Replication (primary -> replica)
    const replicaKey = `${key}-replica`;
    addNode(replicaKey, {
      label: 'Database',
      name: `${dbType} Replica ${tenant}`,
      type: dbType,
      region: REGIONS.find(r => r !== region) || 'us-west-2',
      port: 5000 + d,
      size: `${Math.floor(Math.random() * 500) + 10}GB`,
      iops: Math.floor(Math.random() * 10000) + 1000,
    });
    addEdge(key, replicaKey, 'Replication');
  }

  // Workers
  const workerKeys: string[] = [];
  for (const w of range(WORKERS_PER_TENANT)) {
    const workerType = pick(WORKER_TYPES);
    const key = `${tenant}-worker-${w}`;
    addNode(key, {
      label: 'Service',
      name: `Worker ${w} (${tenant})`,
      type: workerType,
      region,
      port: 10000 + w,
      concurrency: Math.floor(Math.random() * 20) + 1,
    });
    workerKeys.push(key);

    // K8s hosts workers
    addEdge(k8sKey, key, 'Hosts');

    // Monitoring
    addEdge(key, 'prometheus', 'Metrics');
    addEdge(key, 'loki', 'LogStream');

    // Workers consume from queues
    if (Math.random() > 0.5) {
      addEdge(key, 'kafka', 'TCP');
    } else {
      addEdge(key, 'rabbitmq', 'TCP');
    }

    // Workers produce to queues
    for (const svcKey of serviceKeys.slice(0, 3)) {
      if (Math.random() > 0.7) {
        addEdge(svcKey, 'kafka', 'TCP');
      }
    }

    // Workers -> databases
    for (const dbKey of dbKeys.slice(0, 2)) {
      if (Math.random() > 0.4) {
        addEdge(key, dbKey, 'TCP');
      }
    }

    // Workers -> storage
    if (Math.random() > 0.5) {
      addEdge(key, 's3-data', 'HTTPS');
    }
  }
}

// ── External services ────────────────────────────────────────────────────────

const externalNames = [
  { name: 'Stripe API', type: 'PaymentGateway' },
  { name: 'SendGrid API', type: 'EmailGateway' },
  { name: 'Twilio API', type: 'SMSGateway' },
  { name: 'Firebase FCM', type: 'PushGateway' },
  { name: 'AWS SNS', type: 'PushGateway' },
  { name: 'Slack Webhook', type: 'ChatGateway' },
  { name: 'Datadog API', type: 'MonitoringAPI' },
  { name: 'PagerDuty API', type: 'AlertingAPI' },
  { name: 'Auth0', type: 'IdentityProvider' },
  { name: 'Okta', type: 'IdentityProvider' },
  { name: 'Cloudflare API', type: 'CDNAPI' },
  { name: 'GitHub API', type: 'SourceControlAPI' },
  { name: 'Jira API', type: 'IssueTracker' },
  { name: 'Confluence API', type: 'WikiAPI' },
  { name: 'Snowflake API', type: 'DataWarehouse' },
];

const externalKeys: string[] = [];
for (const ext of externalNames) {
  const key = `ext-${ext.name.toLowerCase().replace(/\s+/g, '-')}`;
  addNode(key, {
    label: 'External',
    name: ext.name,
    type: ext.type,
    region: 'external',
    sla: `${(99 + Math.random() * 0.99).toFixed(2)}%`,
  });
  externalKeys.push(key);
}

// Connect some services to external APIs (random cross-tenant)
for (const extKey of externalKeys) {
  const numConnections = Math.floor(Math.random() * 5) + 1;
  for (const t of range(Math.min(numConnections, NUM_TENANTS))) {
    const svcIdx = Math.floor(Math.random() * SERVICES_PER_TENANT);
    const svcKey = `tenant-${t}-svc-${svcIdx}`;
    if (allNodeKeys.has(svcKey)) {
      addEdge(svcKey, extKey, 'HTTPS');
    }
  }
}

// ── Terraform state ──────────────────────────────────────────────────────────

addNode('terraform', { label: 'Storage', name: 'Terraform State', type: 'ObjectStorage', region: 'us-east-1' });
addNode('terraform-state-bucket', { label: 'Storage', name: 'Terraform S3 Bucket', type: 'ObjectStorage', region: 'us-east-1' });
addEdge('terraform', 'terraform-state-bucket', 'Hosts');

// Terraform manages infra
for (const k of ['kafka', 'rabbitmq', 'vault', 'consul', 'envoy-mesh', 'load-balancer', 'waf', 'cdn']) {
  addEdge('terraform', k, 'Manages');
}

// ── Cross-tenant edges (some services talk across tenants) ───────────────────

for (let i = 0; i < NUM_TENANTS; i++) {
  const nextTenant = (i + 1) % NUM_TENANTS;
  const svcKey = `tenant-${i}-svc-0`;
  const nextSvcKey = `tenant-${nextTenant}-svc-0`;
  if (allNodeKeys.has(svcKey) && allNodeKeys.has(nextSvcKey)) {
    addEdge(svcKey, nextSvcKey, 'RPC');
  }
}

// ── Write output ─────────────────────────────────────────────────────────────

const graph = {
  options: {
    type: 'directed' as const,
    allowSelfLoops: false,
    multi: false,
  },
  attributes: {
    name: 'Benchmark Graph',
    description: `Large generated graph with ${nodes.length} nodes and ${edges.length} edges for performance benchmarking`,
    tenants: NUM_TENANTS,
    generated: new Date().toISOString(),
  },
  nodes,
  edges,
};

const outputPath = process.argv[2] || resolve('examples/bench-graph.json');
const json = JSON.stringify(graph, null, 2);
writeFileSync(outputPath, json, 'utf-8');

const sizeKB = Math.round(json.length / 1024);
console.log(`Generated: ${nodes.length} nodes, ${edges.length} edges`);
console.log(`Size: ${sizeKB}KB (${(sizeKB / 1024).toFixed(2)}MB)`);
console.log(`Output: ${outputPath}`);
