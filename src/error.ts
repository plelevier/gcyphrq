/**
 * Thrown when graph data validation fails or a query cannot be executed.
 */
export class GraphError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'GraphError';
  }
}
