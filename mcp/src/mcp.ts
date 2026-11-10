// Small MCP server. Tools are registered with server.tool so Mend can see them.
export type ToolResult = {
  content: { type: "text"; text: string }[];
  isError?: boolean;
};

type ToolHandler = (args: Record<string, unknown>) => Promise<ToolResult>;

export class McpServer {
  readonly tools = new Map<
    string,
    { schema: unknown; handler: ToolHandler }
  >();

  tool(
    name: string,
    schema: unknown,
    handler: (args: Record<string, string>) => Promise<ToolResult>
  ): void {
    this.tools.set(name, {
      schema,
      handler: handler as ToolHandler,
    });
  }

  registerTool(
    name: string,
    config: { description?: string; inputSchema?: unknown },
    handler: (args: Record<string, string>) => Promise<ToolResult>
  ): void {
    this.tools.set(name, {
      schema: config.inputSchema ?? { type: "object", properties: {} },
      handler: handler as ToolHandler,
    });
  }
}
