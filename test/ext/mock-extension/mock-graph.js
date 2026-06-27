// Mock graph-input extension for testing
// Converts mock format to GraphInput

export default {
  async convert(ctx) {
    const content = typeof ctx.content === 'string' ? ctx.content : ctx.content.toString();
    // Simple mock: parse a simple text format
    // Format: "nodes: A,B,C edges: A->B,B->C"
    const nodesMatch = content.match(/nodes:\s*([\w,]+)/i);
    const edgesMatch = content.match(/edges:\s*([\w->,]+)/i);

    const nodes = [];
    if (nodesMatch) {
      for (const key of nodesMatch[1].split(',').map(s => s.trim())) {
        if (key) {
          nodes.push({ key, attributes: { label: 'Node', name: key } });
        }
      }
    }

    const edges = [];
    if (edgesMatch) {
      for (const edge of edgesMatch[1].split(',').map(s => s.trim())) {
        if (edge) {
          const [source, target] = edge.split('->').map(s => s.trim());
          if (source && target) {
            edges.push({ source, target, attributes: { type: 'LINK' } });
          }
        }
      }
    }

    return { nodes, edges };
  },
};
