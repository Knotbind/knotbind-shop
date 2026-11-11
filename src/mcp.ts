// A small MCP tool registry, in the shape the official SDK registers tools:
// `server.tool(name, schema, handler)` and
// `server.registerTool(name, { description, inputSchema, outputSchema }, handler)`.
// The advertised outputSchema is what lets Knotbind watch a response field,
// because a plain text answer hides the field name behind a string.
export type ToolResult = {
  content: { type: "text"; text: string }[];
  structuredContent?: unknown;
  isError?: boolean;
};

export type RegisteredTool = {
  description?: string;
  inputSchema: Record<string, unknown>;
  outputSchema?: Record<string, unknown>;
  handler: (args: Record<string, string>) => Promise<ToolResult>;
};

export class McpServer {
  readonly tools = new Map<string, RegisteredTool>();

  tool(
    name: string,
    inputSchema: Record<string, unknown>,
    handler: RegisteredTool["handler"],
    description?: string
  ): void {
    this.tools.set(name, {
      inputSchema,
      handler,
      ...(description ? { description } : {}),
    });
  }

  registerTool(
    name: string,
    config: {
      description?: string;
      inputSchema?: Record<string, unknown>;
      outputSchema?: Record<string, unknown>;
    },
    handler: RegisteredTool["handler"]
  ): void {
    this.tools.set(name, {
      inputSchema: config.inputSchema ?? { type: "object", properties: {} },
      handler,
      ...(config.description ? { description: config.description } : {}),
      ...(config.outputSchema ? { outputSchema: config.outputSchema } : {}),
    });
  }
}
