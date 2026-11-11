// Starts the MCP server. Kept apart from the module so tests can import it
// without opening a port.
import { createShopServer } from "./server.ts";

const port = Number(process.env.PORT || 8081);
createShopServer().listen(port, "0.0.0.0");
